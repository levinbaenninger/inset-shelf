import type { DrawingImage, DrawingView } from "@shared/contracts";
import { useEffect, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { drawingBridge } from "@/shared/bridge";
import { useLocalKeys } from "@/shared/keys";
import { PinMarker } from "@/shared/pin-marker";
import { usePushedView } from "@/shared/use-pushed-view";
import { WindowHeader, WindowTitle } from "@/shared/window-header";

import { Page } from "./page";
import type { PageImage } from "./page";
import { exportAnnotated, exportPng } from "./render";
import {
  addMark,
  canRedo,
  canUndo,
  clearMarks,
  emptyHistory,
  redo,
  undo,
} from "./sketch";
import type { Color, History, Mark, Stroke, Tool } from "./sketch";
import { Toolbar } from "./toolbar";
import { useDark, useDrawingKeys } from "./use-drawing-keys";

const api = drawingBridge();

const load = async (): Promise<DrawingView> => await api.getView();

const subscribe = (listener: (view: DrawingView | null) => void) =>
  api.on("view", listener);

/** The marks drawn into the open image, or onto a fresh page; null when there is nothing to save. */
const exportMarks = async (
  marks: readonly Mark[],
  image: DrawingImage | null,
  dark: boolean
): Promise<Uint8Array<ArrayBuffer> | null> => {
  if (image === null) {
    return await exportPng(marks, dark);
  }

  const png = await api.getImage();

  if (png === null) {
    throw new Error("The image is no longer on the shelf.");
  }

  return await exportAnnotated(marks, {
    heightPx: image.heightPx,
    pixelsPerDip: image.pixelsPerDip,
    png: new Uint8Array(png),
    widthPx: image.widthPx,
  });
};

/** Resolves to a problem to show, or null once main has the drawing. */
const saveDrawing = async (
  copy: boolean,
  marks: readonly Mark[],
  image: DrawingImage | null,
  dark: boolean
): Promise<string | null> => {
  try {
    const png = await exportMarks(marks, image, dark);

    if (png === null) {
      return null;
    }

    const result = await api.save({ copy, png });

    return result.ok ? null : result.message;
  } catch {
    return "The drawing could not be saved.";
  }
};

const percent = (value: number, total: number): string =>
  `${(value / total) * 100}%`;

/** The outer diameter of the ring drawn into exports (src/main/pin-mark.ts). */
const PIN_DIAMETER_DIP = 28;

/** The image under the marks, with its pin as the shelf shows it. */
const ImageUnderlay = ({ image }: { readonly image: DrawingImage }) => (
  <div className="relative size-full">
    <img
      alt=""
      className="block size-full select-none"
      draggable={false}
      src={image.url}
    />
    {image.pin === null ? null : (
      <PinMarker
        left={percent(image.pin.x, image.widthPx)}
        top={percent(image.pin.y, image.heightPx)}
        width={percent(PIN_DIAMETER_DIP * image.pixelsPerDip, image.widthPx)}
      />
    )}
    <div className="ring-foreground/15 pointer-events-none absolute inset-0 ring-1" />
  </div>
);

const pageImage = (image: DrawingImage | null): PageImage | null =>
  image === null
    ? null
    : {
        height: image.heightPx / image.pixelsPerDip,
        underlay: <ImageUnderlay image={image} />,
        width: image.widthPx / image.pixelsPerDip,
      };

/** One drawing, on a blank page or over an image; the app remounts it for every opening. */
const Editor = ({ image }: { readonly image: DrawingImage | null }) => {
  const [history, setHistory] = useState<History>(emptyHistory);
  const [tool, setTool] = useState<Tool>("pen");
  // Marks on a picture stand out in red; a blank page starts in ink.
  const [color, setColor] = useState<Color>(image === null ? "ink" : "red");
  const [stroke, setStroke] = useState<Stroke>("thin");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  // On an image the marks keep the colours they are saved in, whatever the theme.
  const dark = useDark() && image === null;
  const marks = history.present;
  const empty = marks.length === 0;

  // Takes the marks to save, so ⌘↩ in the text field can include the text it just added.
  const save = async (
    copy: boolean,
    toSave: readonly Mark[]
  ): Promise<void> => {
    if (saving || toSave.length === 0) {
      return;
    }

    setSaving(true);
    setProblem(null);
    setProblem(await saveDrawing(copy, toSave, image, dark));
    setSaving(false);
  };

  const add = (mark: Mark): History => {
    const next = addMark(history, mark);

    setHistory(next);

    return next;
  };

  useLocalKeys({
    // Only an empty page closes on Esc, so a stray key never throws a drawing away.
    onEscape: () => {
      if (empty) {
        api.cancel();
      }
    },
    onSave: () => {
      void save(false, marks);
    },
  });

  useEffect(() => {
    api.setDirty(!empty);
  }, [empty]);

  // Closing the window with marks asks here, in the page's own dialog.
  useEffect(
    () =>
      api.on("confirmClose", () => {
        setConfirming(true);
      }),
    []
  );

  // The menu bar's Undo and Redo arrive here instead of as keys.
  useEffect(
    () =>
      api.on("edit", (kind) => {
        setHistory((current) =>
          kind === "undo" ? undo(current) : redo(current)
        );
      }),
    []
  );

  useDrawingKeys({
    pickTool: setTool,
    redo: () => {
      setHistory(redo(history));
    },
    undo: () => {
      setHistory(undo(history));
    },
  });

  return (
    <main className="bg-background flex h-svh flex-col overflow-hidden select-none">
      {/* A problem saving takes the title's place; saving itself is in the toolbar. */}
      <WindowHeader>
        {problem === null ? (
          <WindowTitle>
            {image === null ? "New Drawing" : "Annotate"}
          </WindowTitle>
        ) : (
          <p
            className="text-destructive mr-auto min-w-0 truncate text-xs"
            role="alert"
          >
            {problem}
          </p>
        )}
      </WindowHeader>
      <div className="relative min-h-0 flex-1">
        <Page
          color={color}
          dark={dark}
          image={pageImage(image)}
          marks={marks}
          onAdd={(mark) => {
            add(mark);
          }}
          onSubmit={(mark) => {
            const next = mark === null ? history : add(mark);

            void save(false, next.present);
          }}
          stroke={stroke}
          tool={tool}
        />
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
          <Toolbar
            canClear={!empty}
            canRedo={canRedo(history)}
            canSave={!empty && !saving}
            canUndo={canUndo(history)}
            color={color}
            dark={dark}
            onClear={() => {
              setHistory(clearMarks(history));
            }}
            onColor={setColor}
            onCopyAndSave={() => {
              void save(true, marks);
            }}
            onRedo={() => {
              setHistory(redo(history));
            }}
            onSave={() => {
              void save(false, marks);
            }}
            onStroke={setStroke}
            onTool={setTool}
            onUndo={() => {
              setHistory(undo(history));
            }}
            stroke={stroke}
            tool={tool}
          />
        </div>
      </div>
      <AlertDialog onOpenChange={setConfirming} open={confirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {image === null
                ? "Discard this drawing?"
                : "Discard what you drew on this image?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {image === null
                ? "It is not on the shelf yet."
                : "The image on the shelf stays as it was."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Drawing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                api.cancel();
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
};

/** Every opening pushes a new view, which starts over with no history: a blank page or the image. */
export const DrawingApp = () => {
  const view = usePushedView<DrawingView | null>(load, subscribe, null);

  return view === null ? null : <Editor image={view.image} key={view.seq} />;
};

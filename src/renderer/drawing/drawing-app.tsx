import type { DrawingImage, DrawingView } from "@shared/contracts";
import type { Pin } from "@shared/shelf";
import { useEffect, useMemo, useRef, useState } from "react";

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
import { usePushedView } from "@/shared/use-pushed-view";
import { WindowHeader, WindowTitle } from "@/shared/window-header";

import { Page } from "./page";
import type { PageImage } from "./page";
import { nudgePin, movePin, pinsOf, removePin } from "./pins";
import { exportAnnotated, exportPng, measureText } from "./render";
import {
  addMark,
  canRedo,
  canUndo,
  clearMarks,
  commit,
  EXPORT_SCALE,
  exportFrame,
  redo,
  undo,
} from "./sketch";
import type { Color, History, Mark, Point, Stroke, Tool } from "./sketch";
import { Toolbar } from "./toolbar";
import { useDark, useDrawingKeys } from "./use-drawing-keys";

const api = drawingBridge();

const load = async (): Promise<DrawingView> => await api.getView();

const subscribe = (listener: (view: DrawingView | null) => void) =>
  api.on("view", listener);

/** The pins, in the saved image's pixels, labels kept. */
const pinsInPixels = (
  marks: readonly Mark[],
  toPixels: (point: Point) => Point
): Pin[] =>
  pinsOf(marks).map((pin) => {
    const at = toPixels(pin.at);

    const point = {
      x: Math.max(0, Math.round(at.x)),
      y: Math.max(0, Math.round(at.y)),
    };

    return pin.label === undefined ? point : { ...point, label: pin.label };
  });

interface Saved {
  readonly png: Uint8Array<ArrayBuffer> | null;
  readonly pins: Pin[];
}

/**
 * What a save sends: on an image, the marks drawn into it (none when only
 * the pins changed) and the pins in its pixels; on a blank page, the
 * drawing trimmed to everything on it and the pins in that picture.
 */
const exportMarks = async (
  marks: readonly Mark[],
  image: DrawingImage | null,
  dark: boolean
): Promise<Saved | null> => {
  const strokes = marks.filter((mark) => mark.kind !== "pin");

  if (image === null) {
    const frame = exportFrame(marks, measureText);
    const png = await exportPng(marks, dark);

    return png === null || frame === null
      ? null
      : {
          pins: pinsInPixels(marks, (point) => ({
            x: (point.x - frame.origin.x) * EXPORT_SCALE,
            y: (point.y - frame.origin.y) * EXPORT_SCALE,
          })),
          png,
        };
  }

  const pins = pinsInPixels(marks, (point) => ({
    x: Math.min(point.x * image.pixelsPerDip, image.widthPx - 1),
    y: Math.min(point.y * image.pixelsPerDip, image.heightPx - 1),
  }));

  if (strokes.length === 0) {
    return { pins, png: null };
  }

  const png = await api.getImage();

  if (png === null) {
    throw new Error("The image is no longer on the shelf.");
  }

  return {
    pins,
    png: await exportAnnotated(strokes, {
      heightPx: image.heightPx,
      pixelsPerDip: image.pixelsPerDip,
      png: new Uint8Array(png),
      widthPx: image.widthPx,
    }),
  };
};

/** Resolves to a problem to show, or null once main has the drawing. */
const saveDrawing = async (
  copy: boolean,
  marks: readonly Mark[],
  image: DrawingImage | null,
  dark: boolean
): Promise<string | null> => {
  try {
    const saved = await exportMarks(marks, image, dark);

    if (saved === null) {
      return null;
    }

    const result = await api.save({ copy, pins: saved.pins, png: saved.png });

    return result.ok ? null : result.message;
  } catch {
    return "The drawing could not be saved.";
  }
};

/** The image under the marks; its pins are drawn by the page, where they can be moved. */
const ImageUnderlay = ({ image }: { readonly image: DrawingImage }) => (
  <div className="relative size-full">
    <img
      alt=""
      className="block size-full select-none"
      draggable={false}
      src={image.url}
    />
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

/** The image's pins as marks, in its DIP, so the page can show and move them. */
const startingMarks = (image: DrawingImage | null): readonly Mark[] =>
  image === null
    ? []
    : image.pins.map((pin): Mark => {
        const at = {
          x: pin.x / image.pixelsPerDip,
          y: pin.y / image.pixelsPerDip,
        };

        return pin.label === undefined
          ? { at, kind: "pin" }
          : { at, kind: "pin", label: pin.label };
      });

/** One drawing, on a blank page or over an image; the app remounts it for every opening. */
const Editor = ({ image }: { readonly image: DrawingImage | null }) => {
  const initial = useMemo(() => startingMarks(image), [image]);

  const [history, setHistory] = useState<History>(() => ({
    future: [],
    past: [],
    present: initial,
  }));

  // Add Pins… and Move pins in details open with the Pin tool; anything else starts with the pen.
  const [tool, setTool] = useState<Tool>(
    image?.pinMode === true ? "pin" : "pen"
  );

  const [lastTool, setLastTool] = useState<Tool>("pen");
  const [selectedPin, setSelectedPin] = useState<number | null>(null);
  const pointerRef = useRef<Point | null>(null);
  // Marks on a picture stand out in red; a blank page starts in ink.
  const [color, setColor] = useState<Color>(image === null ? "ink" : "red");
  const [stroke, setStroke] = useState<Stroke>("thin");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  // On an image the marks keep the colours they are saved in, whatever the theme.
  const dark = useDark() && image === null;
  const marks = history.present;
  const pins = pinsOf(marks);
  const empty = marks.every((mark) => mark.kind === "pin");
  const pinsChanged = JSON.stringify(pins) !== JSON.stringify(pinsOf(initial));
  // Something to save: new marks, or pins added, moved or removed.
  const dirty = !empty || pinsChanged;

  const bounds =
    image === null
      ? undefined
      : {
          height: image.heightPx / image.pixelsPerDip,
          width: image.widthPx / image.pixelsPerDip,
        };

  const change = (next: readonly Mark[]): void => {
    setHistory(commit(history, next));
  };

  /** P toggles the Pin tool; any other key picks its tool. */
  const pickTool = (next: Tool): void => {
    if (next === "pin" && tool === "pin") {
      setTool(lastTool);
    } else {
      if (next === "pin") {
        setLastTool(tool);
      }

      setTool(next);
    }

    if (next !== "pin") {
      setSelectedPin(null);
    }
  };

  // Takes the marks to save, so ⌘↩ in the text field can include the text it just added.
  const save = async (
    copy: boolean,
    toSave: readonly Mark[]
  ): Promise<void> => {
    if (saving || (toSave.length === 0 && !pinsChanged)) {
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
    // Esc lets go of a selected pin first; only an untouched page closes on it, so a stray key never throws work away.
    onEscape: () => {
      if (selectedPin !== null) {
        setSelectedPin(null);
      } else if (!dirty) {
        api.cancel();
      }
    },
    onSave: () => {
      void save(false, marks);
    },
  });

  useEffect(() => {
    api.setDirty(dirty);
  }, [dirty]);

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
    dropPin: () => {
      const center =
        bounds === undefined
          ? { x: window.innerWidth / 2, y: window.innerHeight / 2 }
          : { x: bounds.width / 2, y: bounds.height / 2 };

      change([...marks, { at: pointerRef.current ?? center, kind: "pin" }]);
      setSelectedPin(pins.length);
    },
    nudgePin: (dx, dy) => {
      if (selectedPin === null) {
        return false;
      }

      change(nudgePin(marks, selectedPin, { x: dx, y: dy }, bounds));

      return true;
    },
    pickTool,
    redo: () => {
      setHistory(redo(history));
    },
    removePin: () => {
      if (selectedPin === null) {
        return false;
      }

      change(removePin(marks, selectedPin));
      setSelectedPin(null);

      return true;
    },
    selectPin: (index) => {
      if (index < pins.length) {
        setSelectedPin(index);
      }
    },
    undo: () => {
      setHistory(undo(history));
      setSelectedPin(null);
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
          onMovePin={(index, to) => {
            change(movePin(marks, index, to, bounds));
          }}
          onSelectPin={setSelectedPin}
          onSubmit={(mark) => {
            const next = mark === null ? history : add(mark);

            void save(false, next.present);
          }}
          pointerRef={pointerRef}
          selectedPin={selectedPin}
          stroke={stroke}
          tool={tool}
        />
        {tool === "pin" ? (
          <p className="bg-foreground/85 text-background pointer-events-none absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full px-3 py-1 text-xs whitespace-nowrap shadow-sm">
            {selectedPin === null
              ? `Click to place pin ${pins.length + 1}`
              : `Pin ${selectedPin + 1}: drag or use the arrow keys to move, ⌫ removes it`}
          </p>
        ) : null}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
          <Toolbar
            canClear={marks.length > 0}
            canRedo={canRedo(history)}
            canSave={dirty && !saving}
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
            onTool={pickTool}
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

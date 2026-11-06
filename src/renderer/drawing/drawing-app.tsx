import type { DrawingImage, DrawingView } from "@shared/contracts";
import type { Pin } from "@shared/shelf";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

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
import type { DragMark, PageImage } from "./page";
import { nudgePin, nudgeStep, movePin, pinsOf, removePin } from "./pins";
import { exportAnnotated, exportPng, measureText } from "./render";
import {
  addMark,
  amend,
  canRedo,
  canUndo,
  clearMarks,
  commit,
  EXPORT_SCALE,
  exportFrame,
  isVisible,
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
  forQuit: boolean,
  marks: readonly Mark[],
  image: DrawingImage | null,
  dark: boolean
): Promise<string | null> => {
  try {
    const saved = await exportMarks(marks, image, dark);

    if (saved === null) {
      return null;
    }

    const result = await api.save({
      copy,
      forQuit,
      pins: saved.pins,
      png: saved.png,
    });

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

/** Something to save: new marks, words still being typed, or pins added, moved or removed. */
const hasChanges = (
  marks: readonly Mark[],
  draft: Mark | null,
  initial: readonly Mark[]
): boolean =>
  marks.some((mark) => mark.kind !== "pin") ||
  draft !== null ||
  JSON.stringify(pinsOf(marks)) !== JSON.stringify(pinsOf(initial));

/** A stroke still being drawn, once it shows: it counts and is saved before it is let go (red-team round 8). */
const shownStroke = (drag: DragMark | null): DragMark | null =>
  drag !== null && isVisible(drag) ? drag : null;

/** Letting go of a stroke, or a lock ending it: one that shows becomes a mark. */
const endStroke = (history: History, drag: DragMark): History =>
  isVisible(drag) ? addMark(history, drag) : history;

/** The pill over the page: why it is locked during a quit, otherwise the Pin tool's hint. */
const pagePill = (
  quitting: boolean,
  selectedPin: number | null,
  pinCount: number
): string => {
  if (quitting) {
    return "Locked while Inset asks about quitting";
  }

  return selectedPin === null
    ? `Click to place pin ${pinCount + 1}`
    : `Pin ${selectedPin + 1}: drag or use the arrow keys to move, ⌫ removes it`;
};

/** One drawing, on a blank page or over an image; the app remounts it for every opening. */
const Editor = ({
  image,
  quitting,
}: {
  readonly image: DrawingImage | null;
  /** A quit is under way: the marks wait, untouched, until it is answered. */
  readonly quitting: boolean;
}) => {
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
  // The image and its pins: a selected pin brings focus here, and focus leaving lets go of it.
  const pinsRef = useRef<HTMLElement>(null);
  // The step a held arrow key last made, so its repeats move the pin within that step.
  const nudged = useRef<History | null>(null);

  const selectPin = (index: number | null): void => {
    setSelectedPin(index);

    if (index !== null) {
      pinsRef.current?.focus({ preventScroll: true });
    }
  };

  // Focus leaving the image, or the window, lets go of the pin, so digits and ⌫ typed elsewhere never touch it.
  useEffect(() => {
    const area = pinsRef.current;

    const letGo = (): void => {
      setSelectedPin(null);
    };

    const onFocusOut = (event: FocusEvent): void => {
      const to = event.relatedTarget;

      if (!(to instanceof Node && area?.contains(to) === true)) {
        letGo();
      }
    };

    window.addEventListener("blur", letGo);
    area?.addEventListener("focusout", onFocusOut);

    return () => {
      window.removeEventListener("blur", letGo);
      area?.removeEventListener("focusout", onFocusOut);
    };
  }, [pinsRef]);
  // Marks on a picture stand out in red; a blank page starts in ink.
  const [color, setColor] = useState<Color>(image === null ? "ink" : "red");
  const [stroke, setStroke] = useState<Stroke>("thin");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  // Words in the open text field, not yet a mark in the history.
  const [draft, setDraft] = useState<Mark | null>(null);
  // A pen, line or shape still being drawn, not yet a mark in the history.
  const [drag, setDrag] = useState<DragMark | null>(null);
  // On an image the marks keep the colours they are saved in, whatever the theme.
  const dark = useDark() && image === null;
  const marks = history.present;
  const pins = pinsOf(marks);
  const pinsChanged = JSON.stringify(pins) !== JSON.stringify(pinsOf(initial));
  const drawn = shownStroke(drag);
  const stroking = drawn !== null;
  const dirty = hasChanges(marks, draft, initial) || stroking;
  // What a save sends: the marks, the words still being typed and a stroke still being drawn.
  const toSave = [...marks, ...[draft, drawn].filter((mark) => mark !== null)];
  // While its save, a quit or the Discard confirm is under way nothing changes the marks, so none is made that main would not get or that the prompt doesn't show (Round 8).
  const locked = saving || quitting || confirming;

  // A lock ends a stroke where it is, as letting go would: the marks then stay as they are until it lifts.
  if (locked && drag !== null) {
    setDrag(null);
    setHistory(endStroke(history, drag));
  }

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
    list: readonly Mark[],
    forQuit = false
  ): Promise<void> => {
    if (saving || (list.length === 0 && !pinsChanged)) {
      return;
    }

    setSaving(true);
    setProblem(null);
    setProblem(await saveDrawing(copy, forQuit, list, image, dark));
    setSaving(false);
  };

  const add = (mark: Mark): History => {
    const next = addMark(history, mark);

    setHistory(next);

    return next;
  };

  useLocalKeys(
    locked
      ? {}
      : {
          // Esc lets go of a selected pin first; only an untouched page closes on it, so a stray key never throws work away.
          onEscape: () => {
            if (selectedPin !== null) {
              setSelectedPin(null);
            } else if (!dirty) {
              api.cancel();
            }
          },
          onSave: () => {
            void save(false, toSave);
          },
        }
  );

  // Every change, not only the first: main then knows the marks a held quit put on the shelf have changed since.
  useEffect(() => {
    api.setDirty(hasChanges(history.present, draft, initial) || stroking);
  }, [history.present, draft, initial, stroking]);

  // Retry in a held quit saves the marks to the shelf, as Save does; a save already running finishes on its own.
  const saveForQuit = useEffectEvent(() => {
    void save(false, toSave, true);
  });

  useEffect(
    () =>
      api.on("saveForQuit", () => {
        saveForQuit();
      }),
    []
  );

  // Closing the window with marks asks here, in the page's own dialog; not while a quit or a save is under way.
  const confirmClose = useEffectEvent(() => {
    if (!locked) {
      setConfirming(true);
    }
  });

  useEffect(
    () =>
      api.on("confirmClose", () => {
        confirmClose();
      }),
    []
  );

  // The menu bar's Undo and Redo arrive here instead of as keys.
  const menuEdit = useEffectEvent((kind: "undo" | "redo") => {
    if (!locked) {
      setHistory((current) =>
        kind === "undo" ? undo(current) : redo(current)
      );
    }
  });

  useEffect(
    () =>
      api.on("edit", (kind) => {
        menuEdit(kind);
      }),
    []
  );

  useDrawingKeys({
    enabled: !locked,
    dropPin: () => {
      const center =
        bounds === undefined
          ? { x: window.innerWidth / 2, y: window.innerHeight / 2 }
          : { x: bounds.width / 2, y: bounds.height / 2 };

      change([...marks, { at: pointerRef.current ?? center, kind: "pin" }]);
      selectPin(pins.length);
    },
    nudgePin: (dx, dy, held) => {
      if (selectedPin === null) {
        return false;
      }

      // dx and dy are pixels of the saved image, whatever the screen's scale.
      const scale = image?.pixelsPerDip ?? EXPORT_SCALE;

      const moved = nudgePin(
        marks,
        selectedPin,
        { x: nudgeStep(dx, scale), y: nudgeStep(dy, scale) },
        bounds
      );

      // One Undo puts the pin back where the held key started it.
      const next =
        held && nudged.current === history
          ? amend(history, moved)
          : commit(history, moved);

      nudged.current = next;
      setHistory(next);

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
        selectPin(index);
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
        <section
          aria-label="Pins"
          className="absolute inset-0 outline-none"
          ref={pinsRef}
          tabIndex={-1}
        >
          <Page
            color={color}
            dark={dark}
            drag={drag}
            image={pageImage(image)}
            locked={locked}
            marks={marks}
            onAdd={(mark) => {
              add(mark);
            }}
            onDraft={setDraft}
            onMovePin={(index, to) => {
              change(movePin(marks, index, to, bounds));
            }}
            onDrag={setDrag}
            onSelectPin={selectPin}
            onSubmit={(mark) => {
              const next = mark === null ? history : add(mark);

              void save(false, next.present);
            }}
            pointerRef={pointerRef}
            selectedPin={selectedPin}
            stroke={stroke}
            tool={tool}
          />
        </section>
        {quitting || tool === "pin" ? (
          <p
            className="bg-foreground/85 text-background pointer-events-none absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full px-3 py-1 text-xs whitespace-nowrap shadow-sm"
            role={quitting ? "status" : undefined}
          >
            {pagePill(quitting, selectedPin, pins.length)}
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
            locked={locked}
            onClear={() => {
              setHistory(clearMarks(history));
            }}
            onColor={setColor}
            onCopyAndSave={() => {
              void save(true, toSave);
            }}
            onRedo={() => {
              setHistory(redo(history));
            }}
            onSave={() => {
              void save(false, toSave);
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
  // The opening as it first arrived: a later push of it (a quit locking the page) brings a new copy of the same image, which must not count as a change.
  const [opened, setOpened] = useState<DrawingView | null>(null);

  if (view !== null && view.seq !== opened?.seq) {
    setOpened(view);
  }

  return view === null || opened?.seq !== view.seq ? null : (
    <Editor image={opened.image} key={opened.seq} quitting={view.quitting} />
  );
};

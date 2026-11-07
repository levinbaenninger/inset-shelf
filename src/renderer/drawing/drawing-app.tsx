import type {
  DrawingImage,
  DrawingOnShelf,
  DrawingView,
} from "@shared/contracts";
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
import { useExpiringState } from "@/shared/use-expiring-state";
import { usePushedView } from "@/shared/use-pushed-view";
import { WindowHeader, WindowTitle } from "@/shared/window-header";

import { Page } from "./page";
import type { PageImage } from "./page";
import { nudgeStep, pinIndexOf, pinMarkIndex, pinsOf } from "./pins";
import { exportAnnotated, exportPng, measureText } from "./render";
import {
  draftEdit,
  duplicateMarks,
  gestureMarks,
  gestureSelection,
  moveMarks,
  NOTHING,
  onlySelected,
  releaseGesture,
  removeMarks,
  restyle,
  shownStyle,
  withDraft,
  withText,
} from "./selection";
import type { Gesture, Selection, Style, TextDraft } from "./selection";
import {
  amend,
  canRedo,
  canUndo,
  clearMarks,
  commit,
  EXPORT_SCALE,
  redo,
  TEXT_SIZE,
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
    // The frame comes with the picture, measured once the font has loaded, so the pins land where the text pushed the edges.
    const exported = await exportPng(marks, dark);

    return exported === null
      ? null
      : {
          pins: pinsInPixels(marks, (point) => ({
            x: (point.x - exported.frame.origin.x) * EXPORT_SCALE,
            y: (point.y - exported.frame.origin.y) * EXPORT_SCALE,
          })),
          png: exported.png,
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

/** Something to save: marks (words still being typed among them), or pins added, moved or removed. */
const hasChanges = (
  marks: readonly Mark[],
  initial: readonly Mark[]
): boolean =>
  marks.some((mark) => mark.kind !== "pin") ||
  JSON.stringify(pinsOf(marks)) !== JSON.stringify(pinsOf(initial));

/** How long the page says why New Drawing or Annotate brought it forward instead. */
const REFUSED_MS = 4000;

/** What the page announces over everything else: why it is locked during a quit, or why another drawing didn't open. */
const pageNotice = (quitting: boolean, refused: boolean): string | null => {
  if (quitting) {
    return "Locked while Inset asks about quitting";
  }

  return refused ? "Save or discard this drawing to open another" : null;
};

const pinHint = (selectedPin: number | null, pinCount: number): string =>
  selectedPin === null
    ? `Click to place pin ${pinCount + 1}`
    : `Pin ${selectedPin + 1}: drag or use the arrow keys to move, ⌫ removes it`;

/** The pill over the page: the page's notice, otherwise the Pin tool's hint. */
const PagePill = ({
  hint,
  notice,
}: {
  readonly hint: string | null;
  readonly notice: string | null;
}) => {
  const text = notice ?? hint;

  return text === null ? null : (
    <p
      className="bg-foreground/85 text-background pointer-events-none absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full px-3 py-1 text-xs whitespace-nowrap shadow-sm"
      role={notice === null ? undefined : "status"}
    >
      {text}
    </p>
  );
};

/** What closing a new drawing keeps, from what the shelf holds of it. */
const BLANK_CLOSING: Readonly<Record<DrawingOnShelf, string>> = {
  asIs: "It is already on the shelf.",
  earlier: "The shelf keeps it without your latest changes.",
  none: "It is not on the shelf yet.",
};

/** What the close confirm says closing keeps or loses. */
const closingText = (
  image: DrawingImage | null,
  onShelf: DrawingOnShelf
): string => {
  if (image === null) {
    return BLANK_CLOSING[onShelf];
  }

  return onShelf === "asIs"
    ? "The image on the shelf already has these marks."
    : "The image on the shelf stays as it was.";
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
  // What Select or the pin keys picked, pins included, by place among the marks.
  const [selection, setSelection] = useState<Selection>(NOTHING);
  const pointerRef = useRef<Point | null>(null);
  // The page, image and pins: a selection brings focus here, and focus leaving lets go of it.
  const pageRef = useRef<HTMLElement>(null);
  // The step a held arrow key last made, so its repeats move the selection within that step.
  const nudged = useRef<History | null>(null);
  // Removing a focused field can also blur it; its words must only be added once.
  const textOpen = useRef(false);

  /** Picks marks; a selection takes focus to the page, so its keys reach it. */
  const select = (next: Selection): void => {
    setSelection(next);

    if (next.size > 0) {
      pageRef.current?.focus({ preventScroll: true });
    }
  };

  // Focus leaving the page, or the window, lets go of the selection, so digits and ⌫ typed elsewhere never touch it.
  useEffect(() => {
    const area = pageRef.current;

    const letGo = (): void => {
      setSelection(NOTHING);
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
  }, [pageRef]);
  // Marks on a picture stand out in red; a blank page starts in ink.
  const [color, setColor] = useState<Color>(image === null ? "ink" : "red");
  const [stroke, setStroke] = useState<Stroke>("thin");
  // Screen pixels per drawing unit, as the page shows it: restyled marks get the size new ones would.
  const [scale, setScale] = useState(1);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [closing, setClosing] = useState<DrawingOnShelf>("none");
  // Each time New Drawing or Annotate brought this drawing forward instead: the pill says why for a while.
  const [refused, setRefused] = useExpiringState<number>(REFUSED_MS);
  // Words in the open text field, not yet a mark in the history.
  const [text, setText] = useState<TextDraft | null>(null);
  // A stroke being drawn or a selection being moved, resized or picked, not yet a step in the history.
  const [gesture, setGesture] = useState<Gesture | null>(null);
  // On an image the marks keep the colours they are saved in, whatever the theme.
  const dark = useDark() && image === null;
  const marks = history.present;
  const pins = pinsOf(marks);
  const pinsChanged = JSON.stringify(pins) !== JSON.stringify(pinsOf(initial));

  const bounds =
    image === null
      ? undefined
      : {
          height: image.heightPx / image.pixelsPerDip,
          width: image.widthPx / image.pixelsPerDip,
        };

  // The marks and the selection as the gesture shows them; a gesture that shows counts and is saved before it is let go (red-team round 8).
  const shown = gestureMarks(marks, selection, gesture, bounds);

  const shownSelection = gestureSelection(
    marks,
    selection,
    gesture,
    measureText
  );

  const moving = shown !== marks;
  // Kept between renders, so the page reports a change of the words, not every render while they are open.
  const typed = useMemo(() => withDraft(marks, text), [marks, text]);
  const dirty = hasChanges(typed, initial) || moving;
  // What a save sends: the marks, the words still being typed and a gesture still under way.
  const toSave = withDraft(shown, text);
  // While its save, a quit or the Discard confirm is under way nothing changes the marks, so none is made that main would not get or that the prompt doesn't show (Round 8).
  const locked = saving || quitting || confirming;

  /** One step of the history, when the marks changed. */
  const change = (next: readonly Mark[]): void => {
    if (next !== marks) {
      setHistory(commit(history, next));
    }
  };

  // A lock ends a gesture where it is, as letting go would: the marks then stay as they are until it lifts.
  if (locked && gesture !== null) {
    setGesture(null);
    change(shown);
  }

  /** P toggles the Pin tool; any other key picks its tool. Only Select and Pin keep what is selected. */
  const pickTool = (next: Tool): void => {
    const picked = next === "pin" && tool === "pin" ? lastTool : next;

    if (picked === "pin") {
      setLastTool(tool);
    }

    setTool(picked);

    if (picked !== "select" && picked !== "pin") {
      setSelection(NOTHING);
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

  const addPin = (at: Point): void => {
    change([...marks, { at, kind: "pin" }]);
    select(new Set([marks.length]));
  };

  /**
   * Letting go of `last`, the gesture as the page last had it: it becomes
   * one step, and a shape just drawn is selected with Select picked, as in
   * Excalidraw. A gesture a lock already ended is over.
   */
  const release = (last: Gesture): void => {
    if (gesture === null || locked) {
      return;
    }

    const result = releaseGesture(marks, selection, last, measureText, bounds);

    setGesture(null);
    change(result.marks);
    select(result.selection);

    if (
      last.kind === "draw" &&
      last.mark.kind !== "pen" &&
      result.marks !== marks
    ) {
      setTool("select");
    }
  };

  const openText = (draft: TextDraft): void => {
    textOpen.current = true;
    setSelection(NOTHING);
    setText(draft);
  };

  /**
   * Closes the text field: kept, the words become one step and are
   * selected, with Select picked; dropped, an edited text stays as it was.
   * The page takes focus back, unless focus left for something else.
   */
  const closeText = (keep: boolean, blurred = false): History => {
    if (text === null || !textOpen.current) {
      return history;
    }

    textOpen.current = false;
    setText(null);

    if (tool === "text") {
      setTool("select");
    }

    const edit = draftEdit(text);
    const next = keep ? withText(marks, edit) : marks;
    const after = next === marks ? history : commit(history, next);
    let { index } = edit;

    if (keep && edit.mark === null) {
      index = null;
    } else if (keep && edit.index === null) {
      index = next.length - 1;
    }

    setHistory(after);

    if (blurred) {
      return after;
    }

    if (index === null) {
      pageRef.current?.focus({ preventScroll: true });
    } else {
      select(new Set([index]));
    }

    return after;
  };

  /** An ink or a stroke picked: the words being typed or the selection take it, and so does the next mark. */
  const applyStyle = (style: Style): void => {
    if (text === null) {
      change(restyle(marks, selection, style, scale));
    } else {
      setText({
        ...text,
        color: style.color ?? text.color,
        size:
          style.stroke === undefined
            ? text.size
            : TEXT_SIZE[style.stroke] / scale,
      });
    }
  };

  const style = shownStyle(shown, shownSelection, text, scale, {
    color,
    stroke,
  });

  const duplicate = (): void => {
    if (selection.size === 0) {
      return;
    }

    const copies = duplicateMarks(marks, selection, bounds);

    change(copies.marks);
    select(copies.selection);
  };

  const undoStep = (): void => {
    setHistory(undo(history));
    setSelection(NOTHING);
  };

  const redoStep = (): void => {
    setHistory(redo(history));
    setSelection(NOTHING);
  };

  useLocalKeys(
    locked
      ? {}
      : {
          // Esc lets go of the selection first; only an untouched page closes on it, so a stray key never throws work away.
          onEscape: () => {
            if (selection.size > 0) {
              setSelection(NOTHING);
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
    api.setDirty(hasChanges(typed, initial) || moving);
  }, [typed, initial, moving]);

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
  const confirmClose = useEffectEvent((onShelf: DrawingOnShelf) => {
    if (!locked) {
      setClosing(onShelf);
      setConfirming(true);
    }
  });

  useEffect(
    () =>
      api.on("confirmClose", (onShelf) => {
        confirmClose(onShelf);
      }),
    []
  );

  useEffect(
    () =>
      api.on("openRefused", () => {
        setRefused((count) => (count ?? 0) + 1);
      }),
    [setRefused]
  );

  // The menu bar's Undo, Redo and Duplicate (⌘D, which the menu takes for Description) arrive here instead of as keys.
  const menuEdit = useEffectEvent((kind: "undo" | "redo" | "duplicate") => {
    if (locked) {
      return;
    }

    if (kind === "duplicate") {
      duplicate();
    } else {
      setHistory((current) =>
        kind === "undo" ? undo(current) : redo(current)
      );
      setSelection(NOTHING);
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
    dropPin: () => {
      const center =
        bounds === undefined
          ? { x: window.innerWidth / 2, y: window.innerHeight / 2 }
          : { x: bounds.width / 2, y: bounds.height / 2 };

      addPin(pointerRef.current ?? center);
    },
    duplicate,
    enabled: !locked,
    nudge: (dx, dy, held) => {
      if (selection.size === 0) {
        return false;
      }

      // Pins move in pixels of the saved image, whatever the screen's scale; marks in the drawing's own units.
      const onlyPins = [...selection].every(
        (index) => marks[index]?.kind === "pin"
      );

      const step = onlyPins
        ? nudgeStep(1, image?.pixelsPerDip ?? EXPORT_SCALE)
        : 1;

      const moved = moveMarks(
        marks,
        selection,
        { x: dx * step, y: dy * step },
        bounds
      );

      if (moved === marks) {
        return true;
      }

      // One Undo puts the selection back where the held key started it.
      const next =
        held && nudged.current === history
          ? amend(history, moved)
          : commit(history, moved);

      nudged.current = next;
      setHistory(next);

      return true;
    },
    pickTool,
    redo: redoStep,
    remove: () => {
      if (selection.size === 0) {
        return false;
      }

      change(removeMarks(marks, selection));
      setSelection(NOTHING);

      return true;
    },
    selectPin: (index) => {
      const at = pinMarkIndex(marks, index);

      if (at !== null) {
        select(new Set([at]));
      }
    },
    undo: undoStep,
  });

  const selectedPin = pinIndexOf(marks, onlySelected(selection));

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
          ref={pageRef}
          tabIndex={-1}
        >
          <Page
            color={color}
            dark={dark}
            gesture={gesture}
            image={pageImage(image)}
            locked={locked}
            marks={shown}
            onAddPin={addPin}
            onCloseText={(keep, blurred) => {
              closeText(keep, blurred);
            }}
            onGesture={setGesture}
            onOpenText={openText}
            onRelease={release}
            onScale={setScale}
            onSelect={select}
            onSubmitText={() => {
              void save(false, closeText(true).present);
            }}
            onTypeText={(value) => {
              if (text !== null) {
                setText({ ...text, value });
              }
            }}
            pointerRef={pointerRef}
            selection={shownSelection}
            stroke={stroke}
            text={text}
            tool={tool}
          />
        </section>
        <PagePill
          hint={tool === "pin" ? pinHint(selectedPin, pins.length) : null}
          notice={pageNotice(quitting, refused !== null)}
        />
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
          <Toolbar
            canClear={marks.length > 0}
            canRedo={canRedo(history)}
            canSave={dirty && !saving}
            canUndo={canUndo(history)}
            color={style.color}
            dark={dark}
            locked={locked}
            onClear={() => {
              setHistory(clearMarks(history));
              setSelection(NOTHING);
            }}
            onColor={(next) => {
              setColor(next);
              applyStyle({ color: next });
            }}
            onCopyAndSave={() => {
              void save(true, toSave);
            }}
            onRedo={redoStep}
            onSave={() => {
              void save(false, toSave);
            }}
            onStroke={(next) => {
              setStroke(next);
              applyStyle({ stroke: next });
            }}
            onTool={pickTool}
            onUndo={undoStep}
            stroke={style.stroke}
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
              {closingText(image, closing)}
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

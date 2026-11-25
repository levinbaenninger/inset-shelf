import { viewerImageRect } from "@shared/geometry";
import { PIN_HEAD_RADIUS, PIN_HEAD_Y, PIN_HEIGHT } from "@shared/pin-shape";
import { useEffect, useRef, useState } from "react";
import type {
  Dispatch,
  KeyboardEvent,
  MouseEvent,
  PointerEvent,
  ReactNode,
  RefObject,
  SetStateAction,
} from "react";

import { PinMarker } from "@/shared/pin-marker";
import { isMac } from "@/shared/platform";

import { pinAt, pinMarkIndex } from "./pins";
import { inkColor, measureText, paletteFor, renderSketch } from "./render";
import {
  boxBetween,
  handleAt,
  handlesOf,
  insideSelection,
  markAt,
  NOTHING,
  onlySelected,
  selectionBounds,
} from "./selection";
import type {
  DragMark,
  Gesture,
  Handle,
  Reach,
  Selection,
  TextDraft,
} from "./selection";
import {
  fontFor,
  markBounds,
  PLAIN_VIEW,
  STROKE_WIDTH,
  TEXT_FONT,
  TEXT_LEADING,
  TEXT_SIZE,
  toDrawing,
  toPage,
} from "./sketch";
import type {
  Bounds,
  Color,
  Mark,
  PageView,
  Point,
  Stroke,
  Tool,
} from "./sketch";

/** An image under the page, in DIP; the marks are drawn over it, in its coordinates. */
export interface PageImage {
  readonly width: number;
  readonly height: number;
  /** The picture itself, laid out over the image's place on the page. */
  readonly underlay: ReactNode;
}

export interface PageProps {
  /** The marks as they show: a gesture's changes are in them. */
  readonly marks: readonly Mark[];
  /** What is selected as it shows: a marquee's picks are in it. */
  readonly selection: Selection;
  readonly tool: Tool;
  /** The ink and stroke the next mark gets. */
  readonly color: Color;
  readonly stroke: Stroke;
  readonly dark: boolean;
  readonly image: PageImage | null;
  /** Its save or a quit is under way: clicks, drags and typing change nothing (Round 8). */
  readonly locked: boolean;
  /** What a held pointer is doing. The editor holds it, so a save or a quit includes it and a lock ends it (Round 8). */
  readonly gesture: Gesture | null;
  readonly onGesture: Dispatch<SetStateAction<Gesture | null>>;
  /** The pointer let go of this gesture, as it last was: it becomes a step of the history. */
  readonly onRelease: (gesture: Gesture) => void;
  readonly onSelect: (selection: Selection) => void;
  /** A click with the Pin tool away from the pins. */
  readonly onAddPin: (at: Point) => void;
  /** The open text field; it counts as marks before it is closed. */
  readonly text: TextDraft | null;
  readonly onOpenText: (draft: TextDraft) => void;
  readonly onTypeText: (value: string) => void;
  /** Return, a click away or focus leaving keeps the words; Esc drops them. `blurred` when focus went elsewhere. */
  readonly onCloseText: (keep: boolean, blurred?: boolean) => void;
  /** ⌘↩ in the text field: keep the words and save. */
  readonly onSubmitText: () => void;
  /** How many screen pixels one drawing unit takes, so new and restyled marks get the size they show. */
  readonly onScale: (scale: number) => void;
  /** Where the pointer is over the drawing, for ⇧P; null when it is off the page. */
  readonly pointerRef: RefObject<Point | null>;
}

/** On screen a pin is as tall as in the export, scaled with the image, but never too small to grab. */
const pinHeight = (scale: number): number =>
  Math.min(Math.max(PIN_HEIGHT * scale, 16), PIN_HEIGHT);

/** How far past a stroke the pointer still picks it, in screen pixels. */
const HIT_SLOP = 6;

/** The gap between a selected mark and its outline, where a box's handles sit, in screen pixels. */
const OUTLINE_GAP = 6;

const HANDLE_SIZE = 9;

/** How far from a handle's middle, each way, the pointer grabs it, in screen pixels: a 24 px square, however small it looks. */
const HANDLE_REACH = 12;

interface CanvasSize {
  readonly width: number;
  readonly height: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), high);

/** Clamped to the page, so a drag that leaves the window cannot make a huge export. */
const pagePoint = (
  event: { readonly clientX: number; readonly clientY: number },
  box: DOMRect
): Point => ({
  x: clamp(event.clientX - box.left, 0, box.width),
  y: clamp(event.clientY - box.top, 0, box.height),
});

/** Follows the canvas's size in CSS and device pixels, which also changes when the window moves to another display. */
const useCanvasSize = (
  ref: RefObject<HTMLCanvasElement | null>
): CanvasSize | null => {
  const [size, setSize] = useState<CanvasSize | null>(null);

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const device = entry?.devicePixelContentBoxSize[0];

      if (entry === undefined || device === undefined) {
        return;
      }

      setSize({
        height: entry.contentRect.height,
        pixelHeight: device.blockSize,
        pixelWidth: device.inlineSize,
        width: entry.contentRect.width,
      });
    });

    if (ref.current !== null) {
      observer.observe(ref.current, { box: "device-pixel-content-box" });
    }

    return () => {
      observer.disconnect();
    };
  }, [ref]);

  return size;
};

/**
 * Counts the fonts loaded: 0 until the hand-drawn face is in, so text never
 * shows in a fallback face, and once more whenever another of its files
 * (Cyrillic, Greek…) arrives for words just typed, so the page repaints.
 */
const useFontsLoaded = (): number => {
  const [loaded, setLoaded] = useState(0);

  useEffect(() => {
    const more = (): void => {
      setLoaded((count) => count + 1);
    };

    const load = async (): Promise<void> => {
      await Promise.all([
        document.fonts.load(fontFor(TEXT_SIZE.thin), "Aa"),
        document.fonts.load(fontFor(TEXT_SIZE.thick), "Aa"),
      ]);
      more();
    };

    void load();
    document.fonts.addEventListener("loadingdone", more);

    return () => {
      document.fonts.removeEventListener("loadingdone", more);
    };
  }, []);

  return loaded;
};

const startDrag = (
  tool: Exclude<Tool, "select" | "text" | "pin">,
  at: Point,
  color: Color,
  width: number
): DragMark =>
  tool === "pen"
    ? { color, kind: "pen", points: [at], width }
    : { color, from: at, kind: tool, to: at, width };

const extendDrag = (drag: DragMark, points: readonly Point[]): DragMark => {
  const last = points.at(-1);

  if (last === undefined) {
    return drag;
  }

  return drag.kind === "pen"
    ? { ...drag, points: [...drag.points, ...points] }
    : { ...drag, to: last };
};

const TOOL_CURSOR: Readonly<Record<Tool, string>> = {
  arrow: "crosshair",
  ellipse: "crosshair",
  line: "crosshair",
  pen: "crosshair",
  pin: "copy",
  rect: "crosshair",
  select: "default",
  text: "text",
};

const handleCursor = (handle: Handle): string => {
  if (handle.kind === "end") {
    return "pointer";
  }

  if (handle.x === 0) {
    return "ns-resize";
  }

  if (handle.y === 0) {
    return "ew-resize";
  }

  return handle.x === handle.y ? "nwse-resize" : "nesw-resize";
};

const gestureCursor = (gesture: Gesture, tool: Tool): string => {
  if (gesture.kind === "move") {
    return "move";
  }

  return gesture.kind === "resize"
    ? handleCursor(gesture.handle)
    : TOOL_CURSOR[tool];
};

const TextField = ({
  dark,
  draft,
  locked,
  onCancel,
  onChange,
  onCommit,
  onSubmit,
  view,
}: {
  readonly draft: TextDraft;
  readonly dark: boolean;
  readonly locked: boolean;
  readonly view: PageView;
  readonly onChange: (value: string) => void;
  readonly onCommit: (blurred: boolean) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
}) => {
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) {
      return;
    }

    // Locked, the words stay as they are, open, and are saved with the marks.
    if (locked) {
      if (event.key === "Escape" || event.key === "Enter") {
        event.preventDefault();
      }

      return;
    }

    // Handled here, so the window's Escape and ⌘↩ do not also run.
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    } else if (event.key === "Enter") {
      event.preventDefault();

      if (isMac ? event.metaKey : event.ctrlKey) {
        onSubmit();
      } else {
        onCommit(false);
      }
    }
  };

  const at = toPage(view, draft.at);

  return (
    <input
      aria-label="Text"
      className="absolute top-(--y) left-(--x) field-sizing-content min-w-4 bg-transparent p-0 font-(family-name:--font) text-(length:--size) leading-tight font-normal text-(color:--ink) outline-none"
      onBlur={() => {
        onCommit(true);
      }}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      onKeyDown={onKeyDown}
      readOnly={locked}
      ref={(node) => {
        node?.focus();
      }}
      spellCheck={false}
      style={{
        "--font": TEXT_FONT,
        "--ink": inkColor(draft.color, dark),
        "--size": `${draft.size * view.scale}px`,
        "--x": `${at.x}px`,
        "--y": `${at.y}px`,
      }}
      value={draft.value}
    />
  );
};

/** A box of the drawing as page pixels, grown by `gap` screen pixels. */
const onPage = (view: PageView, box: Bounds, gap = 0) => {
  const corner = toPage(view, { x: box.x, y: box.y });

  return {
    height: box.height * view.scale + 2 * gap,
    width: box.width * view.scale + 2 * gap,
    x: corner.x - gap,
    y: corner.y - gap,
  };
};

/**
 * What Select shows over the page, never in exports: an outline around
 * each selected mark (and around them all when there are several), the
 * one selected shape's handles, and the marquee being dragged.
 */
const SelectionLayer = ({
  gesture,
  marks,
  selection,
  view,
}: {
  readonly marks: readonly Mark[];
  readonly selection: Selection;
  readonly gesture: Gesture | null;
  readonly view: PageView;
}) => {
  const picked = [...selection].filter((index) => {
    const mark = marks[index];

    return mark !== undefined && mark.kind !== "pin";
  });

  const single = onlySelected(selection);
  const singleMark = single === null ? undefined : marks[single];
  const showsEnds = singleMark?.kind === "line" || singleMark?.kind === "arrow";

  const handles =
    singleMark === undefined
      ? []
      : handlesOf(singleMark, OUTLINE_GAP / view.scale);

  const group =
    picked.length > 1 ? selectionBounds(marks, selection, measureText) : null;

  const marquee =
    gesture?.kind === "marquee" ? boxBetween(gesture.from, gesture.to) : null;

  const outlines = showsEnds
    ? []
    : picked.flatMap((index) => {
        const mark = marks[index];
        const box = mark === undefined ? null : markBounds(mark, measureText);

        return box === null
          ? []
          : [{ box: onPage(view, box, OUTLINE_GAP), index }];
      });

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 size-full overflow-visible"
    >
      {outlines.map(({ box, index }) => (
        <rect
          className="stroke-pin fill-none"
          data-selected-mark={index}
          height={box.height}
          key={index}
          rx={3}
          strokeDasharray={picked.length > 1 ? "4 3" : undefined}
          strokeWidth={1}
          width={box.width}
          x={box.x}
          y={box.y}
        />
      ))}
      {group === null ? null : (
        <rect
          className="stroke-pin fill-none"
          data-selection-group=""
          {...onPage(view, group, OUTLINE_GAP * 2)}
          rx={4}
          strokeWidth={1}
        />
      )}
      {handles.map(({ at, handle }) => {
        const point = toPage(view, at);

        const key =
          handle.kind === "end" ? handle.end : `${handle.x},${handle.y}`;

        return handle.kind === "end" ? (
          <circle
            className="stroke-pin fill-white"
            cx={point.x}
            cy={point.y}
            data-handle={key}
            key={key}
            r={HANDLE_SIZE / 2}
            strokeWidth={1.5}
          />
        ) : (
          <rect
            className="stroke-pin fill-white"
            data-handle={key}
            height={HANDLE_SIZE}
            key={key}
            rx={2}
            strokeWidth={1.5}
            width={HANDLE_SIZE}
            x={point.x - HANDLE_SIZE / 2}
            y={point.y - HANDLE_SIZE / 2}
          />
        );
      })}
      {marquee === null ? null : (
        <rect
          className="fill-pin/10 stroke-pin"
          data-marquee=""
          {...onPage(view, marquee)}
          strokeWidth={1}
        />
      )}
    </svg>
  );
};

/**
 * The drawing surface. Select picks, moves and resizes marks; the drawing
 * tools draw with a drag; Text opens a field where it is clicked (or edits
 * the text clicked); Pin places and moves the numbered pins.
 */
export const Page = ({
  color,
  dark,
  gesture,
  image,
  locked,
  marks,
  onAddPin,
  onCloseText,
  onGesture,
  onOpenText,
  onRelease,
  onScale,
  onSelect,
  onSubmitText,
  onTypeText,
  pointerRef,
  selection,
  stroke,
  text,
  tool,
}: PageProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = useCanvasSize(canvasRef);
  const fontsLoaded = useFontsLoaded();
  // On a selection, where the cursor shows a move or a resize; null elsewhere.
  const [hover, setHover] = useState<string | null>(null);

  const placed =
    image === null || size === null ? null : viewerImageRect(size, image);

  const view: PageView =
    placed === null
      ? PLAIN_VIEW
      : { origin: { x: placed.x, y: placed.y }, scale: placed.scale };

  useEffect(() => {
    onScale(view.scale);
  }, [onScale, view.scale]);

  /** A pointer position as a point of the drawing; on an image, kept on the image. */
  const drawingPoint = (
    event: { readonly clientX: number; readonly clientY: number },
    box: DOMRect
  ): Point => {
    const point = toDrawing(view, pagePoint(event, box));

    return image === null
      ? point
      : {
          x: clamp(point.x, 0, image.width),
          y: clamp(point.y, 0, image.height),
        };
  };

  // The text being edited shows in its field, not on the canvas.
  const painted =
    text === null || text.index === null
      ? marks
      : marks.toSpliced(text.index, 1);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (
      canvas === null ||
      context === null ||
      context === undefined ||
      size === null ||
      fontsLoaded === 0
    ) {
      return;
    }

    if (canvas.width !== size.pixelWidth) {
      canvas.width = size.pixelWidth;
    }

    if (canvas.height !== size.pixelHeight) {
      canvas.height = size.pixelHeight;
    }

    const deviceScale = size.width > 0 ? size.pixelWidth / size.width : 1;

    renderSketch(context, painted, deviceScale * view.scale, {
      origin: {
        x: -view.origin.x / view.scale,
        y: -view.origin.y / view.scale,
      },
      palette: paletteFor(dark),
    });
  }, [
    dark,
    fontsLoaded,
    painted,
    size,
    view.origin.x,
    view.origin.y,
    view.scale,
  ]);

  const height = pinHeight(view.scale);
  const pinScale = height / PIN_HEIGHT;

  const reach: Reach = {
    pinHeadY: (PIN_HEAD_Y * pinScale) / view.scale,
    pinRadius: (PIN_HEAD_RADIUS * pinScale + 3) / view.scale,
    tolerance: HIT_SLOP / view.scale,
  };

  const gap = OUTLINE_GAP / view.scale;
  const single = onlySelected(selection);
  const singleMark = single === null ? undefined : marks[single];

  const handleUnder = (at: Point): Handle | null =>
    singleMark === undefined
      ? null
      : handleAt(singleMark, at, HANDLE_REACH / view.scale, gap);

  /** Opens a field for new words, centred on the click, in the size a thin or thick stroke gives text. */
  const openNewText = (at: Point): void => {
    // Sizes are in the drawing's units, so text looks the same size however large the image shows.
    const textSize = TEXT_SIZE[stroke] / view.scale;

    onOpenText({
      at: { x: at.x, y: at.y - (textSize * TEXT_LEADING) / 2 },
      color,
      index: null,
      size: textSize,
      value: "",
    });
  };

  /** Opens the text mark at `index` in a field, or new words at `at` when it is none. */
  const editTextAt = (at: Point): void => {
    const hit = markAt(marks, at, reach, measureText);
    const mark = hit === null ? undefined : marks[hit];

    if (hit !== null && mark?.kind === "text") {
      onOpenText({
        at: mark.at,
        color: mark.color,
        index: hit,
        size: mark.size,
        value: mark.text,
      });
    } else if (hit === null) {
      openNewText(at);
    }
  };

  // The gesture as of the last pointer event, ahead of the render that shows it, so letting go ends exactly that one, once.
  const live = useRef<Gesture | null>(null);

  const follow = (next: Gesture): void => {
    live.current = next;
    onGesture(next);
  };

  const begin = (
    event: PointerEvent<HTMLCanvasElement>,
    next: Gesture
  ): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    follow(next);
  };

  /** Pointer up, or capture lost (a cancel): whichever comes first ends the gesture. */
  const letGo = (): void => {
    const last = live.current;

    live.current = null;

    if (last !== null) {
      onRelease(last);
    }
  };

  /** Pin mode: a click on a pin's head grabs it, anywhere else places the next pin. */
  const pinPointerDown = (
    event: PointerEvent<HTMLCanvasElement>,
    at: Point
  ): void => {
    const hit = pinAt(marks, at, reach.pinRadius, reach.pinHeadY);
    const index = hit === null ? null : pinMarkIndex(marks, hit);

    if (index === null) {
      onAddPin(at);
    } else {
      onSelect(new Set([index]));
      begin(event, { from: at, kind: "move", narrow: null, to: at });
    }
  };

  /**
   * Select, as in Excalidraw: a handle of the one selected shape resizes it;
   * a mark picks it (Shift adds or takes it out) and drags what is
   * selected; inside the selection's box drags it too; anywhere else starts
   * a marquee.
   */
  const selectPointerDown = (
    event: PointerEvent<HTMLCanvasElement>,
    at: Point
  ): void => {
    const handle = handleUnder(at);

    if (handle !== null && single !== null) {
      begin(event, { from: at, handle, index: single, kind: "resize", to: at });

      return;
    }

    const hit = markAt(marks, at, reach, measureText);
    const move: Gesture = { from: at, kind: "move", narrow: null, to: at };

    if (event.shiftKey) {
      if (hit === null) {
        begin(event, { base: selection, from: at, kind: "marquee", to: at });

        return;
      }

      const next = new Set(selection);

      if (next.has(hit)) {
        next.delete(hit);
      } else {
        next.add(hit);
        begin(event, move);
      }

      onSelect(next);

      return;
    }

    if (hit === null) {
      if (insideSelection(marks, selection, at, gap, measureText)) {
        begin(event, move);
      } else {
        onSelect(NOTHING);
        begin(event, { base: NOTHING, from: at, kind: "marquee", to: at });
      }

      return;
    }

    if (selection.has(hit)) {
      begin(event, { ...move, narrow: selection.size > 1 ? hit : null });
    } else {
      onSelect(new Set([hit]));
      begin(event, move);
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>): void => {
    if (event.button !== 0) {
      return;
    }

    const at = drawingPoint(event, event.currentTarget.getBoundingClientRect());

    // A click away from open text finishes it, and that is all it does: the marks it picks from change with the words.
    if (text !== null) {
      onCloseText(true);

      return;
    }

    if (tool === "pin") {
      pinPointerDown(event, at);
    } else if (tool === "text") {
      editTextAt(at);
    } else if (tool === "select") {
      selectPointerDown(event, at);
    } else {
      // The page never takes focus, so a toolbar button clicked earlier would otherwise answer Space and Enter.
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }

      begin(event, {
        kind: "draw",
        mark: startDrag(tool, at, color, STROKE_WIDTH[stroke] / view.scale),
      });
    }
  };

  /** Double-click with Select edits the text under it, or opens new text on empty space. */
  const onDoubleClick = (event: MouseEvent<HTMLCanvasElement>): void => {
    if (locked || tool !== "select") {
      return;
    }

    onSelect(NOTHING);
    editTextAt(
      drawingPoint(event, event.currentTarget.getBoundingClientRect())
    );
  };

  const hoverAt = (at: Point): string | null => {
    const handle = handleUnder(at);

    if (handle !== null) {
      return handleCursor(handle);
    }

    return markAt(marks, at, reach, measureText) !== null ||
      insideSelection(marks, selection, at, gap, measureText)
      ? "move"
      : null;
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>): void => {
    const box = event.currentTarget.getBoundingClientRect();
    const here = drawingPoint(event, box);

    // A lock ends a gesture without the pointer letting go; once it lifts, that gesture is over.
    if (gesture === null) {
      live.current = null;
    }

    const { current } = live;

    pointerRef.current = here;

    if (current === null) {
      setHover(tool === "select" ? hoverAt(here) : null);

      return;
    }

    if (current.kind !== "draw") {
      follow({ ...current, to: here });

      return;
    }

    const samples = event.nativeEvent.getCoalescedEvents();

    const points = (samples.length > 0 ? samples : [event]).map((sample) =>
      drawingPoint(sample, box)
    );

    follow({ ...current, mark: extendDrag(current.mark, points) });
  };

  let cursor = TOOL_CURSOR[tool];

  if (locked) {
    cursor = "default";
  } else if (gesture !== null) {
    cursor = gestureCursor(gesture, tool);
  } else if (tool === "select") {
    cursor = hover ?? "default";
  }

  const pins = [...marks.entries()].flatMap(([index, mark]) =>
    mark.kind === "pin" ? [{ at: mark.at, index }] : []
  );

  return (
    <div className="absolute inset-0">
      {placed === null || image === null ? null : (
        <div
          className="absolute top-(--y) left-(--x) h-(--h) w-(--w)"
          style={{
            "--h": `${placed.height}px`,
            "--w": `${placed.width}px`,
            "--x": `${placed.x}px`,
            "--y": `${placed.y}px`,
          }}
        >
          {image.underlay}
        </div>
      )}
      <canvas
        aria-disabled={locked}
        aria-label="Drawing"
        className="absolute inset-0 size-full cursor-(--cursor) touch-none"
        data-tool={tool}
        onDoubleClick={onDoubleClick}
        // Every gesture captures the pointer, so this ends it on a cancel too.
        onLostPointerCapture={letGo}
        // Stops a click from moving focus, which would blur a text field the click just opened.
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onPointerDown={locked ? undefined : onPointerDown}
        onPointerLeave={() => {
          pointerRef.current = null;
        }}
        onPointerMove={locked ? undefined : onPointerMove}
        // A discrete event, so the page has caught up with the gesture's end before the next click.
        onPointerUp={letGo}
        ref={canvasRef}
        style={{ "--cursor": cursor }}
      />
      {fontsLoaded === 0 ? null : (
        <SelectionLayer
          gesture={gesture}
          marks={marks}
          selection={selection}
          view={view}
        />
      )}
      {pins.map((pin, number) => {
        const at = toPage(view, pin.at);

        return (
          <PinMarker
            height={height}
            // oxlint-disable-next-line react/no-array-index-key -- a pin's place is its number.
            key={number}
            left={`${at.x}px`}
            number={number + 1}
            selected={selection.has(pin.index)}
            top={`${at.y}px`}
          />
        );
      })}
      {text === null ? null : (
        <TextField
          dark={dark}
          draft={text}
          locked={locked}
          onCancel={() => {
            onCloseText(false);
          }}
          onChange={onTypeText}
          onCommit={(blurred) => {
            onCloseText(true, blurred);
          }}
          onSubmit={onSubmitText}
          view={view}
        />
      )}
    </div>
  );
};

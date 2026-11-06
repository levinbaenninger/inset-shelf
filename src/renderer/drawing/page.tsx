import { viewerImageRect } from "@shared/geometry";
import { PIN_HEAD_RADIUS, PIN_HEAD_Y, PIN_HEIGHT } from "@shared/pin-shape";
import { useEffect, useRef, useState } from "react";
import type {
  Dispatch,
  KeyboardEvent,
  PointerEvent,
  ReactNode,
  RefObject,
  SetStateAction,
} from "react";

import { PinMarker } from "@/shared/pin-marker";
import { isMac } from "@/shared/platform";

import { draggedTo, pinAt, pinsOf } from "./pins";
import type { PinGrab } from "./pins";
import { inkColor, paletteFor, renderSketch } from "./render";
import {
  fontFor,
  isVisible,
  PLAIN_VIEW,
  STROKE_WIDTH,
  TEXT_LEADING,
  TEXT_SIZE,
  toDrawing,
  toPage,
} from "./sketch";
import type {
  Color,
  Mark,
  PageView,
  PenMark,
  Point,
  SegmentMark,
  Stroke,
  TextMark,
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
  readonly marks: readonly Mark[];
  readonly tool: Tool;
  readonly color: Color;
  readonly stroke: Stroke;
  readonly dark: boolean;
  readonly image: PageImage | null;
  /** Its save or a quit is under way: clicks, drags and typing change nothing (Round 8). */
  readonly locked: boolean;
  readonly onAdd: (mark: Mark) => void;
  /** ⌘↩ in the text field: keep the text, if any, and save. */
  readonly onSubmit: (mark: Mark | null) => void;
  /** The words in the open text field as a mark, or null when there are none: they count as marks before they are committed. */
  readonly onDraft: (mark: TextMark | null) => void;
  /** A pen, line or shape still being drawn. The editor holds it, so a save or a quit includes it and a lock ends it (Round 8). */
  readonly drag: DragMark | null;
  readonly onDrag: Dispatch<SetStateAction<DragMark | null>>;
  /** The selected pin (0-based), which ⌫ removes and the arrow keys nudge. */
  readonly selectedPin: number | null;
  readonly onSelectPin: (index: number | null) => void;
  /** A pin dragged to a new place, once it is let go. */
  readonly onMovePin: (index: number, to: Point) => void;
  /** Where the pointer is over the drawing, for ⇧P; null when it is off the page. */
  readonly pointerRef: RefObject<Point | null>;
}

/** On screen a pin is as tall as in the export, scaled with the image, but never too small to grab. */
const pinHeight = (scale: number): number =>
  Math.min(Math.max(PIN_HEIGHT * scale, 16), PIN_HEIGHT);

interface CanvasSize {
  readonly width: number;
  readonly height: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
}

/** The text being typed; it becomes a mark when it is committed. */
interface TextDraft {
  readonly at: Point;
  readonly value: string;
  readonly color: Color;
  readonly size: number;
}

export type DragMark = PenMark | SegmentMark;

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

/** The page paints once Inter has loaded, so text never shows in a fallback face. */
const useFontsLoaded = (): boolean => {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const load = async (): Promise<void> => {
      await Promise.all([
        document.fonts.load(fontFor(TEXT_SIZE.thin)),
        document.fonts.load(fontFor(TEXT_SIZE.thick)),
      ]);
      setLoaded(true);
    };

    void load();
  }, []);

  return loaded;
};

const startDrag = (
  tool: Exclude<Tool, "text" | "pin">,
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

const textMark = (draft: TextDraft): TextMark => ({
  at: draft.at,
  color: draft.color,
  kind: "text",
  size: draft.size,
  text: draft.value,
});

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
  readonly onCommit: () => void;
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
        onCommit();
      }
    }
  };

  const at = toPage(view, draft.at);

  return (
    <input
      aria-label="Text"
      className="absolute top-(--y) left-(--x) field-sizing-content min-w-4 bg-transparent p-0 text-(length:--size) leading-tight font-medium text-(color:--ink) outline-none"
      onBlur={onCommit}
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
        "--ink": inkColor(draft.color, dark),
        "--size": `${draft.size * view.scale}px`,
        "--x": `${at.x}px`,
        "--y": `${at.y}px`,
      }}
      value={draft.value}
    />
  );
};

/** The drawing surface: drags draw with the current tool, and a click with Text opens a field there. */
export const Page = ({
  color,
  dark,
  drag,
  image,
  locked,
  marks,
  onAdd,
  onDraft,
  onMovePin,
  onSelectPin,
  onDrag: setDrag,
  onSubmit,
  pointerRef,
  selectedPin,
  stroke,
  tool,
}: PageProps) => {
  // A pin being dragged: which one and where it is now, committed on release.
  const [pinDrag, setPinDrag] = useState<{
    readonly index: number;
    readonly at: Point;
    readonly grab: PinGrab;
    readonly moved: boolean;
  } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = useCanvasSize(canvasRef);
  const fontsLoaded = useFontsLoaded();
  const [text, setText] = useState<TextDraft | null>(null);
  // Removing a focused field can also blur it; the text must only be added once.
  const textClosed = useRef(false);

  // The editor hears of the open text with every change, so a save or a quit includes it.
  const showText = (next: TextDraft | null): void => {
    setText(next);

    const mark = next === null ? null : textMark(next);

    onDraft(mark !== null && isVisible(mark) ? mark : null);
  };

  const placed =
    image === null || size === null ? null : viewerImageRect(size, image);

  const view: PageView =
    placed === null
      ? PLAIN_VIEW
      : { origin: { x: placed.x, y: placed.y }, scale: placed.scale };

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

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (
      canvas === null ||
      context === null ||
      context === undefined ||
      size === null ||
      !fontsLoaded
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

    renderSketch(
      context,
      drag === null ? marks : [...marks, drag],
      deviceScale * view.scale,
      {
        origin: {
          x: -view.origin.x / view.scale,
          y: -view.origin.y / view.scale,
        },
        palette: paletteFor(dark),
      }
    );
  }, [
    dark,
    drag,
    fontsLoaded,
    marks,
    size,
    view.origin.x,
    view.origin.y,
    view.scale,
  ]);

  const closeText = (): TextMark | null => {
    if (text === null || textClosed.current) {
      return null;
    }

    textClosed.current = true;
    showText(null);

    const mark = textMark(text);

    return isVisible(mark) ? mark : null;
  };

  const commitText = (): void => {
    const mark = closeText();

    if (mark !== null) {
      onAdd(mark);
    }
  };

  const finishDrag = (): void => {
    if (pinDrag !== null) {
      // Let go on a locked page, the pin stays where the marks have it.
      if (pinDrag.moved && !locked) {
        onMovePin(pinDrag.index, pinDrag.at);
      }

      setPinDrag(null);

      return;
    }

    if (drag !== null && isVisible(drag)) {
      onAdd(drag);
    }

    setDrag(null);
  };

  const height = pinHeight(view.scale);
  const pinScale = height / PIN_HEIGHT;

  /** Pin mode: a click on a pin's head grabs it, anywhere else places the next pin. */
  const pinPointerDown = (
    event: PointerEvent<HTMLCanvasElement>,
    at: Point
  ): void => {
    const hit = pinAt(
      marks,
      at,
      (PIN_HEAD_RADIUS * pinScale + 3) / view.scale,
      (PIN_HEAD_Y * pinScale) / view.scale
    );

    event.currentTarget.setPointerCapture(event.pointerId);

    if (hit === null) {
      onAdd({ at, kind: "pin" });
      onSelectPin(pinsOf(marks).length);
    } else {
      const pin = pinsOf(marks)[hit]?.at ?? at;

      onSelectPin(hit);
      setPinDrag({
        at: pin,
        grab: { pin, pointer: at },
        index: hit,
        moved: false,
      });
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>): void => {
    if (event.button !== 0) {
      return;
    }

    const at = drawingPoint(event, event.currentTarget.getBoundingClientRect());

    // A click away from open text finishes it; with the Text tool that is all it does.
    if (text !== null) {
      commitText();

      if (tool === "text") {
        return;
      }
    }

    if (tool === "pin") {
      pinPointerDown(event, at);

      return;
    }

    if (tool === "text") {
      // Sizes are in the drawing's units, so text looks the same size however large the image shows.
      const textSize = TEXT_SIZE[stroke] / view.scale;

      textClosed.current = false;
      showText({
        at: { x: at.x, y: at.y - (textSize * TEXT_LEADING) / 2 },
        color,
        size: textSize,
        value: "",
      });

      return;
    }

    // The page never takes focus, so a toolbar button clicked earlier would otherwise answer Space and Enter.
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag(startDrag(tool, at, color, STROKE_WIDTH[stroke] / view.scale));
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>): void => {
    const box = event.currentTarget.getBoundingClientRect();
    const here = drawingPoint(event, box);

    pointerRef.current = here;

    if (pinDrag !== null) {
      setPinDrag({
        ...pinDrag,
        at: draggedTo(pinDrag.grab, here),
        moved: true,
      });

      return;
    }

    if (drag === null) {
      return;
    }

    const samples = event.nativeEvent.getCoalescedEvents();

    const points = (samples.length > 0 ? samples : [event]).map((sample) =>
      drawingPoint(sample, box)
    );

    // Several moves can arrive before a render, so each one extends the latest drag.
    setDrag((current) =>
      current === null ? null : extendDrag(current, points)
    );
  };

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
        className="absolute inset-0 size-full cursor-crosshair touch-none aria-disabled:cursor-default data-[tool=pin]:cursor-copy data-[tool=text]:cursor-text"
        data-tool={tool}
        // Every drag captures the pointer, so this ends it once: on release, cancel, or capture lost.
        onLostPointerCapture={finishDrag}
        // Stops a click from moving focus, which would blur a text field the click just opened.
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onPointerDown={locked ? undefined : onPointerDown}
        onPointerLeave={() => {
          pointerRef.current = null;
        }}
        onPointerMove={locked ? undefined : onPointerMove}
        ref={canvasRef}
      />
      {pinsOf(marks).map((pin, index) => {
        const at = toPage(view, pinDrag?.index === index ? pinDrag.at : pin.at);

        return (
          <PinMarker
            height={height}
            // oxlint-disable-next-line react/no-array-index-key -- a pin's place is its number.
            key={index}
            left={`${at.x}px`}
            number={index + 1}
            selected={selectedPin === index}
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
            textClosed.current = true;
            showText(null);
          }}
          onChange={(value) => {
            showText({ ...text, value });
          }}
          onCommit={commitText}
          onSubmit={() => {
            onSubmit(closeText());
          }}
          view={view}
        />
      )}
    </div>
  );
};

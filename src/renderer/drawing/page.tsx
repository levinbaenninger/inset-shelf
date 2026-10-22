import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, RefObject } from "react";

import { isMac } from "@/shared/platform";

import { inkColor, paletteFor, renderSketch } from "./render";
import {
  fontFor,
  isVisible,
  STROKE_WIDTH,
  TEXT_LEADING,
  TEXT_SIZE,
} from "./sketch";
import type {
  Color,
  Mark,
  PenMark,
  Point,
  SegmentMark,
  Stroke,
  TextMark,
  Tool,
} from "./sketch";

export interface PageProps {
  readonly marks: readonly Mark[];
  readonly tool: Tool;
  readonly color: Color;
  readonly stroke: Stroke;
  readonly dark: boolean;
  readonly onAdd: (mark: Mark) => void;
  /** ⌘↩ in the text field: keep the text, if any, and save. */
  readonly onSubmit: (mark: Mark | null) => void;
}

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

type DragMark = PenMark | SegmentMark;

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
  tool: Exclude<Tool, "text">,
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
  onCancel,
  onChange,
  onCommit,
  onSubmit,
}: {
  readonly draft: TextDraft;
  readonly dark: boolean;
  readonly onChange: (value: string) => void;
  readonly onCommit: () => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
}) => {
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) {
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

  return (
    <input
      aria-label="Text"
      className="absolute top-(--y) left-(--x) field-sizing-content min-w-4 bg-transparent p-0 text-(length:--size) leading-tight font-medium text-(color:--ink) outline-none"
      onBlur={onCommit}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      onKeyDown={onKeyDown}
      ref={(node) => {
        node?.focus();
      }}
      spellCheck={false}
      style={{
        "--ink": inkColor(draft.color, dark),
        "--size": `${draft.size}px`,
        "--x": `${draft.at.x}px`,
        "--y": `${draft.at.y}px`,
      }}
      value={draft.value}
    />
  );
};

/** The drawing surface: drags draw with the current tool, and a click with Text opens a field there. */
export const Page = ({
  color,
  dark,
  marks,
  onAdd,
  onSubmit,
  stroke,
  tool,
}: PageProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = useCanvasSize(canvasRef);
  const fontsLoaded = useFontsLoaded();
  const [drag, setDrag] = useState<DragMark | null>(null);
  const [text, setText] = useState<TextDraft | null>(null);
  // Removing a focused field can also blur it; the text must only be added once.
  const textClosed = useRef(false);

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

    const scale = size.width > 0 ? size.pixelWidth / size.width : 1;

    renderSketch(context, drag === null ? marks : [...marks, drag], scale, {
      palette: paletteFor(dark),
    });
  }, [dark, drag, fontsLoaded, marks, size]);

  const closeText = (): TextMark | null => {
    if (text === null || textClosed.current) {
      return null;
    }

    textClosed.current = true;
    setText(null);

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
    if (drag !== null && isVisible(drag)) {
      onAdd(drag);
    }

    setDrag(null);
  };

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>): void => {
    if (event.button !== 0) {
      return;
    }

    const at = pagePoint(event, event.currentTarget.getBoundingClientRect());

    // A click away from open text finishes it; with the Text tool that is all it does.
    if (text !== null) {
      commitText();

      if (tool === "text") {
        return;
      }
    }

    if (tool === "text") {
      const textSize = TEXT_SIZE[stroke];

      textClosed.current = false;
      setText({
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
    setDrag(startDrag(tool, at, color, STROKE_WIDTH[stroke]));
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>): void => {
    if (drag === null) {
      return;
    }

    const box = event.currentTarget.getBoundingClientRect();
    const samples = event.nativeEvent.getCoalescedEvents();

    const points = (samples.length > 0 ? samples : [event]).map((sample) =>
      pagePoint(sample, box)
    );

    // Several moves can arrive before a render, so each one extends the latest drag.
    setDrag((current) =>
      current === null ? null : extendDrag(current, points)
    );
  };

  return (
    <div className="absolute inset-0">
      <canvas
        aria-label="Drawing"
        className="absolute inset-0 size-full cursor-crosshair touch-none data-[tool=text]:cursor-text"
        data-tool={tool}
        // Every drag captures the pointer, so this ends it once: on release, cancel, or capture lost.
        onLostPointerCapture={finishDrag}
        // Stops a click from moving focus, which would blur a text field the click just opened.
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        ref={canvasRef}
      />
      {text === null ? null : (
        <TextField
          dark={dark}
          draft={text}
          onCancel={() => {
            textClosed.current = true;
            setText(null);
          }}
          onChange={(value) => {
            setText({ ...text, value });
          }}
          onCommit={commitText}
          onSubmit={() => {
            onSubmit(closeText());
          }}
        />
      )}
    </div>
  );
};

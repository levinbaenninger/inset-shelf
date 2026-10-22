/** The drawing as data: marks (pen strokes, lines, arrows, boxes, ellipses, text) in page coordinates, with undo history. */

/** A point on the drawing page, in CSS pixels from its top-left corner. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const COLORS = ["ink", "red", "blue", "green", "orange"] as const;

export type Color = (typeof COLORS)[number];

export type Stroke = "thin" | "thick";

export interface PenMark {
  readonly kind: "pen";
  readonly points: readonly Point[];
  readonly color: Color;
  readonly width: number;
}

export interface SegmentMark {
  readonly kind: "line" | "arrow" | "rect" | "ellipse";
  readonly from: Point;
  readonly to: Point;
  readonly color: Color;
  readonly width: number;
}

export interface TextMark {
  readonly kind: "text";
  /** The top-left corner of the first line. */
  readonly at: Point;
  readonly text: string;
  readonly color: Color;
  readonly size: number;
}

export type Mark = PenMark | SegmentMark | TextMark;

export const TOOLS = [
  "pen",
  "line",
  "arrow",
  "rect",
  "ellipse",
  "text",
] as const;

export type Tool = (typeof TOOLS)[number];

export const STROKE_WIDTH: Readonly<Record<Stroke, number>> = {
  thick: 7,
  thin: 3,
};

export const TEXT_SIZE: Readonly<Record<Stroke, number>> = {
  thick: 30,
  thin: 20,
};

/** Line height as a multiple of the font size, shared by the canvas and the text field. */
export const TEXT_LEADING = 1.25;

export const TEXT_FONT = '"Inter Variable", sans-serif';

export const fontFor = (size: number): string => `500 ${size}px ${TEXT_FONT}`;

/** Drags shorter than this are clicks, which draw nothing with the drag tools. */
const MIN_DRAG = 2;

export const isVisible = (mark: Mark): boolean => {
  if (mark.kind === "pen") {
    return mark.points.length > 0;
  }

  if (mark.kind === "text") {
    return mark.text.trim() !== "";
  }

  return (
    Math.abs(mark.to.x - mark.from.x) >= MIN_DRAG ||
    Math.abs(mark.to.y - mark.from.y) >= MIN_DRAG
  );
};

// History

const HISTORY_LIMIT = 200;

export interface History {
  readonly past: readonly (readonly Mark[])[];
  readonly present: readonly Mark[];
  readonly future: readonly (readonly Mark[])[];
}

export const emptyHistory: History = { future: [], past: [], present: [] };

/** Records a new state; it drops whatever had been undone. */
export const commit = (
  history: History,
  present: readonly Mark[]
): History => ({
  future: [],
  past: [...history.past, history.present].slice(-HISTORY_LIMIT),
  present,
});

export const addMark = (history: History, mark: Mark): History =>
  commit(history, [...history.present, mark]);

/** Clearing is one more step, so it can be undone. */
export const clearMarks = (history: History): History =>
  history.present.length === 0 ? history : commit(history, []);

export const canUndo = (history: History): boolean => history.past.length > 0;

export const canRedo = (history: History): boolean => history.future.length > 0;

export const undo = (history: History): History => {
  const previous = history.past.at(-1);

  if (previous === undefined) {
    return history;
  }

  return {
    future: [history.present, ...history.future],
    past: history.past.slice(0, -1),
    present: previous,
  };
};

export const redo = (history: History): History => {
  const [next, ...rest] = history.future;

  if (next === undefined) {
    return history;
  }

  return {
    future: rest,
    past: [...history.past, history.present],
    present: next,
  };
};

// Geometry

export interface Arrowhead {
  readonly tip: Point;
  /** Where the shaft stops, so a thick line does not poke through the tip. */
  readonly base: Point;
  readonly left: Point;
  readonly right: Point;
}

/** A head about four line widths long, never longer than the arrow itself; null for a zero-length arrow. */
export const arrowhead = (
  from: Point,
  to: Point,
  width: number
): Arrowhead | null => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);

  if (length === 0) {
    return null;
  }

  const ux = dx / length;
  const uy = dy / length;
  const headLength = Math.min(length, Math.max(12, width * 4));
  const halfWidth = headLength * 0.6;
  const base = { x: to.x - ux * headLength, y: to.y - uy * headLength };

  return {
    base,
    left: { x: base.x - uy * halfWidth, y: base.y + ux * halfWidth },
    right: { x: base.x + uy * halfWidth, y: base.y - ux * halfWidth },
    tip: to,
  };
};

/** Width of a line of text in CSS pixels at a font size; the page measures with the canvas. */
export type MeasureText = (text: string, size: number) => number;

const boxAround = (points: readonly Point[], margin: number): Bounds | null => {
  if (points.length === 0) {
    return null;
  }

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs) - margin;
  const top = Math.min(...ys) - margin;

  return {
    height: Math.max(...ys) + margin - top,
    width: Math.max(...xs) + margin - left,
    x: left,
    y: top,
  };
};

const segmentPoints = (mark: SegmentMark): readonly Point[] => {
  const head =
    mark.kind === "arrow" ? arrowhead(mark.from, mark.to, mark.width) : null;

  return head === null
    ? [mark.from, mark.to]
    : [mark.from, mark.to, head.left, head.right];
};

/** The area a mark paints, including half its stroke. */
export const markBounds = (mark: Mark, measure: MeasureText): Bounds | null => {
  if (mark.kind === "text") {
    const lines = mark.text.split("\n");
    const widest = Math.max(...lines.map((line) => measure(line, mark.size)));

    return {
      height: lines.length * mark.size * TEXT_LEADING,
      width: widest,
      x: mark.at.x,
      y: mark.at.y,
    };
  }

  const points = mark.kind === "pen" ? mark.points : segmentPoints(mark);

  return boxAround(points, mark.width / 2);
};

const union = (a: Bounds, b: Bounds): Bounds => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);

  return {
    height: Math.max(a.y + a.height, b.y + b.height) - y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    x,
    y,
  };
};

export const sketchBounds = (
  marks: readonly Mark[],
  measure: MeasureText
): Bounds | null => {
  let total: Bounds | null = null;

  for (const mark of marks) {
    const box = markBounds(mark, measure);

    if (box !== null) {
      total = total === null ? box : union(total, box);
    }
  }

  return total;
};

export const EXPORT_PADDING = 24;

export const EXPORT_SCALE = 2;

/** The page area to export and the image's size in pixels. */
export interface ExportFrame {
  readonly origin: Point;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
}

/** Trims to every mark plus padding, rounded out to whole pixels at the export scale; null when nothing is drawn. */
export const exportFrame = (
  marks: readonly Mark[],
  measure: MeasureText
): ExportFrame | null => {
  const bounds = sketchBounds(marks, measure);

  if (bounds === null) {
    return null;
  }

  const left = Math.floor(bounds.x - EXPORT_PADDING);
  const top = Math.floor(bounds.y - EXPORT_PADDING);
  const right = Math.ceil(bounds.x + bounds.width + EXPORT_PADDING);
  const bottom = Math.ceil(bounds.y + bounds.height + EXPORT_PADDING);

  return {
    origin: { x: left, y: top },
    pixelHeight: (bottom - top) * EXPORT_SCALE,
    pixelWidth: (right - left) * EXPORT_SCALE,
  };
};

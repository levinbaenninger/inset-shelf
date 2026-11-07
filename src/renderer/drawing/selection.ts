/**
 * Picking marks and changing them, as Select does: what is under the
 * pointer, the handles of the one selected shape, the edits (move, resize,
 * duplicate, delete, restyle, text), and the pointer gestures that make them.
 * Every function returns new marks and leaves the old ones as they were, so
 * the editor can make each edit one step of the history.
 */
import {
  arrowhead,
  isVisible,
  markBounds,
  sketchBounds,
  STROKE_WIDTH,
  TEXT_SIZE,
} from "./sketch";
import type {
  Bounds,
  Color,
  Mark,
  MeasureText,
  PenMark,
  Point,
  SegmentMark,
  Stroke,
  TextMark,
} from "./sketch";

/** The marks picked, by their place among the marks; pins included. */
export type Selection = ReadonlySet<number>;

export const NOTHING: Selection = new Set();

/** How near the pointer must come, in drawing units. */
export interface Reach {
  /** Past a stroke's edge, so a thin line can still be picked. */
  readonly tolerance: number;
  /** A pin's head, a circle this wide, `pinHeadY` above its tip. */
  readonly pinRadius: number;
  readonly pinHeadY: number;
}

/** The area pins may sit in: the image under the drawing. Marks may go past it. */
export interface Area {
  readonly width: number;
  readonly height: number;
}

// Geometry

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), high);

const distanceToSegment = (point: Point, a: Point, b: Point): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;

  const t =
    lengthSquared === 0
      ? 0
      : clamp(
          ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared,
          0,
          1
        );

  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
};

const distanceToPath = (point: Point, path: readonly Point[]): number => {
  const [first, ...rest] = path;

  if (first === undefined) {
    return Number.POSITIVE_INFINITY;
  }

  let nearest = Math.hypot(point.x - first.x, point.y - first.y);
  let previous = first;

  for (const next of rest) {
    nearest = Math.min(nearest, distanceToSegment(point, previous, next));
    previous = next;
  }

  return nearest;
};

/** The box two corners span, whichever way they were dragged. */
export const boxBetween = (a: Point, b: Point): Bounds => ({
  height: Math.abs(b.y - a.y),
  width: Math.abs(b.x - a.x),
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
});

const contains = (box: Bounds, point: Point): boolean =>
  point.x >= box.x &&
  point.x <= box.x + box.width &&
  point.y >= box.y &&
  point.y <= box.y + box.height;

const within = (inner: Bounds, outer: Bounds): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

const grow = (box: Bounds, by: number): Bounds => ({
  height: box.height + 2 * by,
  width: box.width + 2 * by,
  x: box.x - by,
  y: box.y - by,
});

const ELLIPSE_STEPS = 72;

const ellipseOutline = (mark: SegmentMark): readonly Point[] => {
  const box = boxBetween(mark.from, mark.to);
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  return Array.from({ length: ELLIPSE_STEPS + 1 }, (_, step) => {
    const angle = (step / ELLIPSE_STEPS) * Math.PI * 2;

    return {
      x: center.x + (Math.cos(angle) * box.width) / 2,
      y: center.y + (Math.sin(angle) * box.height) / 2,
    };
  });
};

const boxOutline = (box: Bounds): readonly Point[] => {
  const right = box.x + box.width;
  const bottom = box.y + box.height;

  return [
    { x: box.x, y: box.y },
    { x: right, y: box.y },
    { x: right, y: bottom },
    { x: box.x, y: bottom },
    { x: box.x, y: box.y },
  ];
};

/** The lines a mark's ink follows, for hit-testing. */
const inkPaths = (
  mark: PenMark | SegmentMark
): readonly (readonly Point[])[] => {
  if (mark.kind === "pen") {
    return [mark.points];
  }

  if (mark.kind === "rect") {
    return [boxOutline(boxBetween(mark.from, mark.to))];
  }

  if (mark.kind === "ellipse") {
    return [ellipseOutline(mark)];
  }

  const head =
    mark.kind === "arrow" ? arrowhead(mark.from, mark.to, mark.width) : null;

  return head === null
    ? [[mark.from, mark.to]]
    : [
        [mark.from, mark.to],
        [head.left, head.tip, head.right, head.left],
      ];
};

const touches = (
  mark: Mark,
  point: Point,
  reach: Reach,
  measure: MeasureText
): boolean => {
  if (mark.kind === "pin") {
    return (
      Math.hypot(point.x - mark.at.x, point.y - (mark.at.y + reach.pinHeadY)) <=
      reach.pinRadius
    );
  }

  if (mark.kind === "text") {
    const box = markBounds(mark, measure);

    return box !== null && contains(grow(box, reach.tolerance), point);
  }

  const near = mark.width / 2 + reach.tolerance;

  return inkPaths(mark).some((path) => distanceToPath(point, path) <= near);
};

/**
 * The mark under a point, the topmost first: pins stand over everything
 * (the highest number on top), then the marks from the last drawn. Shapes
 * are picked by their outline, so a box drawn around something leaves what
 * is inside it to be picked.
 */
export const markAt = (
  marks: readonly Mark[],
  point: Point,
  reach: Reach,
  measure: MeasureText
): number | null => {
  const order = [...marks.keys()].toReversed();

  const hit =
    order.find((index) => {
      const mark = marks[index];

      return mark?.kind === "pin" && touches(mark, point, reach, measure);
    }) ??
    order.find((index) => {
      const mark = marks[index];

      return (
        mark !== undefined &&
        mark.kind !== "pin" &&
        touches(mark, point, reach, measure)
      );
    });

  return hit ?? null;
};

/** The marks a marquee holds entirely; a pin counts when its tip is inside. */
export const marksWithin = (
  marks: readonly Mark[],
  box: Bounds,
  measure: MeasureText
): Selection =>
  new Set(
    [...marks.entries()].flatMap(([index, mark]) => {
      if (mark.kind === "pin") {
        return contains(box, mark.at) ? [index] : [];
      }

      const bounds = markBounds(mark, measure);

      return bounds !== null && within(bounds, box) ? [index] : [];
    })
  );

/** The area the selected marks paint, pins left out: their markers show selection themselves. */
export const selectionBounds = (
  marks: readonly Mark[],
  selection: Selection,
  measure: MeasureText
): Bounds | null =>
  sketchBounds(
    marks.filter((mark, index) => selection.has(index) && mark.kind !== "pin"),
    measure
  );

/** Whether a point is inside the selection's box, padded: a drag from there moves the selection. */
export const insideSelection = (
  marks: readonly Mark[],
  selection: Selection,
  point: Point,
  padding: number,
  measure: MeasureText
): boolean => {
  const box = selectionBounds(marks, selection, measure);

  return box !== null && contains(grow(box, padding), point);
};

/** The one mark selected, or null when none or several are. */
export const onlySelected = (selection: Selection): number | null => {
  const [first, ...rest] = selection;

  return first !== undefined && rest.length === 0 ? first : null;
};

// Handles

/**
 * A grip on the one selected shape: a line's or an arrow's end, or a box's
 * or an ellipse's side or corner, -1 for the left or top edge, 1 for the
 * right or bottom, 0 for neither.
 */
export type Handle =
  | { readonly kind: "end"; readonly end: "from" | "to" }
  | { readonly kind: "side"; readonly x: -1 | 0 | 1; readonly y: -1 | 0 | 1 };

export interface PlacedHandle {
  readonly handle: Handle;
  readonly at: Point;
}

const SIDES: readonly (readonly [-1 | 0 | 1, -1 | 0 | 1])[] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/** Where a mark's handles are, corners before sides; `padding` keeps a box's off its outline. None for pens, text and pins. */
export const handlesOf = (
  mark: Mark,
  padding: number
): readonly PlacedHandle[] => {
  if (mark.kind === "line" || mark.kind === "arrow") {
    return [
      { at: mark.from, handle: { end: "from", kind: "end" } },
      { at: mark.to, handle: { end: "to", kind: "end" } },
    ];
  }

  if (mark.kind !== "rect" && mark.kind !== "ellipse") {
    return [];
  }

  const box = grow(boxBetween(mark.from, mark.to), padding);

  return SIDES.map(([x, y]) => ({
    at: {
      x: box.x + ((x + 1) / 2) * box.width,
      y: box.y + ((y + 1) / 2) * box.height,
    },
    handle: { kind: "side", x, y },
  }));
};

/** The handle whose square, `reach` from its middle each way, holds a point; corners win over the sides beside them. */
export const handleAt = (
  mark: Mark,
  point: Point,
  reach: number,
  padding: number
): Handle | null =>
  handlesOf(mark, padding).find(
    ({ at }) =>
      Math.abs(point.x - at.x) <= reach && Math.abs(point.y - at.y) <= reach
  )?.handle ?? null;

/** A shape with one handle dragged `by`: a line's end moves, or a box's sides follow. */
export const resize = (
  mark: SegmentMark,
  handle: Handle,
  by: Point
): SegmentMark => {
  if (handle.kind === "end") {
    const end = mark[handle.end];

    return { ...mark, [handle.end]: { x: end.x + by.x, y: end.y + by.y } };
  }

  const box = boxBetween(mark.from, mark.to);
  const left = box.x + (handle.x === -1 ? by.x : 0);
  const top = box.y + (handle.y === -1 ? by.y : 0);
  const right = box.x + box.width + (handle.x === 1 ? by.x : 0);
  const bottom = box.y + box.height + (handle.y === 1 ? by.y : 0);

  return { ...mark, from: { x: left, y: top }, to: { x: right, y: bottom } };
};

// Edits

const shift = (mark: Mark, by: Point, area: Area | undefined): Mark => {
  const moved = (point: Point): Point => ({
    x: point.x + by.x,
    y: point.y + by.y,
  });

  if (mark.kind === "pen") {
    return { ...mark, points: mark.points.map(moved) };
  }

  if (mark.kind === "text") {
    return { ...mark, at: moved(mark.at) };
  }

  // A pin stays on the image, whatever moves with it.
  if (mark.kind === "pin") {
    const at = moved(mark.at);

    return {
      ...mark,
      at:
        area === undefined
          ? at
          : { x: clamp(at.x, 0, area.width), y: clamp(at.y, 0, area.height) },
    };
  }

  return { ...mark, from: moved(mark.from), to: moved(mark.to) };
};

/** The selected marks moved `by`; pins stay inside `area`. The same marks when nothing moves, so no step is made. */
export const moveMarks = (
  marks: readonly Mark[],
  selection: Selection,
  by: Point,
  area?: Area
): readonly Mark[] => {
  let changed = false;

  const next = marks.map((mark, index) => {
    if (!selection.has(index)) {
      return mark;
    }

    const moved = shift(mark, by, area);

    const stuck =
      (by.x === 0 && by.y === 0) ||
      (mark.kind === "pin" &&
        moved.kind === "pin" &&
        moved.at.x === mark.at.x &&
        moved.at.y === mark.at.y);

    changed ||= !stuck;

    return stuck ? mark : moved;
  });

  return changed ? next : marks;
};

/** The marks without the selected ones; the pins after a removed pin move up one number. */
export const removeMarks = (
  marks: readonly Mark[],
  selection: Selection
): readonly Mark[] => marks.filter((_, index) => !selection.has(index));

/** How far a duplicate lands from its original, in drawing units, as in Excalidraw. */
export const DUPLICATE_OFFSET = 10;

/** Marks after an edit, and what is selected after it. */
export interface Edited {
  readonly marks: readonly Mark[];
  readonly selection: Selection;
}

/** Copies of the selected marks, offset and added last (so copied pins take the next numbers), and the copies selected. */
export const duplicateMarks = (
  marks: readonly Mark[],
  selection: Selection,
  area?: Area
): Edited => {
  const by = { x: DUPLICATE_OFFSET, y: DUPLICATE_OFFSET };

  const copies = [...marks.entries()].flatMap(([index, mark]) =>
    selection.has(index) ? [shift(mark, by, area)] : []
  );

  return {
    marks: [...marks, ...copies],
    selection: new Set(copies.map((_, offset) => marks.length + offset)),
  };
};

/** What restyling sets: an ink, a stroke, or both. */
export interface Style {
  readonly color?: Color;
  readonly stroke?: Stroke;
}

/**
 * The selected marks in another ink or stroke. Widths and text sizes are in
 * drawing units, so `scale` (screen pixels per unit) makes them the size a
 * new mark gets. Pins keep their own look. The same marks come back when
 * nothing changes, so a click on the current ink makes no step.
 */
export const restyle = (
  marks: readonly Mark[],
  selection: Selection,
  style: Style,
  scale: number
): readonly Mark[] => {
  let changed = false;

  const next = marks.map((mark, index) => {
    if (!selection.has(index) || mark.kind === "pin") {
      return mark;
    }

    const color = style.color ?? mark.color;

    const restyled: Mark =
      mark.kind === "text"
        ? {
            ...mark,
            color,
            size:
              style.stroke === undefined
                ? mark.size
                : TEXT_SIZE[style.stroke] / scale,
          }
        : {
            ...mark,
            color,
            width:
              style.stroke === undefined
                ? mark.width
                : STROKE_WIDTH[style.stroke] / scale,
          };

    const same =
      restyled.color === mark.color &&
      (restyled.kind === "text" && mark.kind === "text"
        ? restyled.size === mark.size
        : restyled.kind !== "text" &&
          mark.kind !== "text" &&
          restyled.width === mark.width);

    if (same) {
      return mark;
    }

    changed = true;

    return restyled;
  });

  return changed ? next : marks;
};

/** Thick or thin, as a mark shows at `scale`: nearer the thick width or size than the thin one. */
const strokeOf = (
  mark: Exclude<Mark, { kind: "pin" }>,
  scale: number
): Stroke => {
  const [shown, sizes] =
    mark.kind === "text"
      ? [mark.size * scale, TEXT_SIZE]
      : [mark.width * scale, STROKE_WIDTH];

  return shown * 2 > sizes.thick + sizes.thin ? "thick" : "thin";
};

/** The ink and stroke the marks share, for the toolbar to show; null where they differ, or when there are none to show. */
export const sharedStyle = (
  marks: readonly Mark[],
  scale: number
): { readonly color: Color | null; readonly stroke: Stroke | null } | null => {
  const styled = marks.filter((mark) => mark.kind !== "pin");
  const [first] = styled;

  if (first === undefined) {
    return null;
  }

  return {
    color: styled.every((mark) => mark.color === first.color)
      ? first.color
      : null,
    stroke: styled.every(
      (mark) => strokeOf(mark, scale) === strokeOf(first, scale)
    )
      ? strokeOf(first, scale)
      : null,
  };
};

// Text

/** Words being typed: a new text (`index` null) or the text mark at `index` edited in place; `mark` is null while they are blank. */
export interface TextEdit {
  readonly index: number | null;
  readonly mark: TextMark | null;
}

/** The words in the open text field: where, in which ink and size, and the text mark they edit (`index`), if any. */
export interface TextDraft {
  readonly index: number | null;
  readonly at: Point;
  readonly value: string;
  readonly color: Color;
  readonly size: number;
}

/** The draft as a text mark, blank or not. */
export const draftMark = (draft: TextDraft): TextMark => ({
  at: draft.at,
  color: draft.color,
  kind: "text",
  size: draft.size,
  text: draft.value,
});

export const draftEdit = (draft: TextDraft): TextEdit => {
  const mark = draftMark(draft);

  return { index: draft.index, mark: isVisible(mark) ? mark : null };
};

/** The ink and stroke the toolbar shows: those of the words being typed, or of what is selected, or else the next mark's. */
export const shownStyle = (
  marks: readonly Mark[],
  selection: Selection,
  text: TextDraft | null,
  scale: number,
  next: { readonly color: Color; readonly stroke: Stroke }
): { readonly color: Color | null; readonly stroke: Stroke | null } => {
  const styled =
    text === null
      ? marks.filter((_, index) => selection.has(index))
      : [draftMark(text)];

  return sharedStyle(styled, scale) ?? next;
};

/** The marks with the words in: added, put in place of the edited mark, or, left blank, the edited mark taken out. */
export const withText = (
  marks: readonly Mark[],
  edit: TextEdit
): readonly Mark[] => {
  if (edit.index === null) {
    return edit.mark === null ? marks : [...marks, edit.mark];
  }

  const old = marks[edit.index];

  if (edit.mark === null) {
    return marks.toSpliced(edit.index, 1);
  }

  return old?.kind === "text" &&
    old.text === edit.mark.text &&
    old.color === edit.mark.color &&
    old.size === edit.mark.size &&
    old.at.x === edit.mark.at.x &&
    old.at.y === edit.mark.at.y
    ? marks
    : marks.with(edit.index, edit.mark);
};

/** The marks with the words of an open text field in, when there is one. */
export const withDraft = (
  marks: readonly Mark[],
  text: TextDraft | null
): readonly Mark[] =>
  text === null ? marks : withText(marks, draftEdit(text));

// Gestures

/** A pen stroke, line or shape still being drawn. */
export type DragMark = PenMark | SegmentMark;

/**
 * What a held pointer is doing. Each shows its result while it lasts and
 * becomes one step of the history when it is let go.
 */
export type Gesture =
  | { readonly kind: "draw"; readonly mark: DragMark }
  /** Drags the selection; let go without moving, the selection narrows to `narrow`, the mark clicked in it. */
  | {
      readonly kind: "move";
      readonly from: Point;
      readonly to: Point;
      readonly narrow: number | null;
    }
  | {
      readonly kind: "resize";
      readonly index: number;
      readonly handle: Handle;
      readonly from: Point;
      readonly to: Point;
    }
  /** Picks what it spans, added to `base` (the selection when Shift began it). */
  | {
      readonly kind: "marquee";
      readonly from: Point;
      readonly to: Point;
      readonly base: Selection;
    };

const offset = (gesture: {
  readonly from: Point;
  readonly to: Point;
}): Point => ({
  x: gesture.to.x - gesture.from.x,
  y: gesture.to.y - gesture.from.y,
});

const isStill = (by: Point): boolean => by.x === 0 && by.y === 0;

/** The marks as the gesture shows them; the same marks when it changes nothing (yet). */
export const gestureMarks = (
  marks: readonly Mark[],
  selection: Selection,
  gesture: Gesture | null,
  area?: Area
): readonly Mark[] => {
  if (gesture === null || gesture.kind === "marquee") {
    return marks;
  }

  if (gesture.kind === "draw") {
    return isVisible(gesture.mark) ? [...marks, gesture.mark] : marks;
  }

  const by = offset(gesture);

  if (isStill(by)) {
    return marks;
  }

  if (gesture.kind === "move") {
    return moveMarks(marks, selection, by, area);
  }

  const mark = marks[gesture.index];

  return mark === undefined ||
    mark.kind === "pen" ||
    mark.kind === "text" ||
    mark.kind === "pin"
    ? marks
    : marks.with(gesture.index, resize(mark, gesture.handle, by));
};

/** The selection as the gesture shows it: a marquee picks what it spans. */
export const gestureSelection = (
  marks: readonly Mark[],
  selection: Selection,
  gesture: Gesture | null,
  measure: MeasureText
): Selection => {
  if (gesture?.kind === "marquee") {
    const inside = marksWithin(
      marks,
      boxBetween(gesture.from, gesture.to),
      measure
    );

    return new Set([...gesture.base, ...inside]);
  }

  return selection;
};

/** What letting go leaves: the marks (the same ones when nothing changed) and the selection. */
export const releaseGesture = (
  marks: readonly Mark[],
  selection: Selection,
  gesture: Gesture,
  measure: MeasureText,
  area?: Area
): Edited => {
  const next = gestureMarks(marks, selection, gesture, area);

  if (gesture.kind === "marquee") {
    return {
      marks,
      selection: gestureSelection(marks, selection, gesture, measure),
    };
  }

  // A shape drawn is selected, as in Excalidraw; a pen stroke is not, so the next one can follow.
  if (gesture.kind === "draw") {
    return {
      marks: next,
      selection:
        next !== marks && gesture.mark.kind !== "pen"
          ? new Set([next.length - 1])
          : selection,
    };
  }

  return {
    marks: next,
    selection:
      gesture.kind === "move" && next === marks && gesture.narrow !== null
        ? new Set([gesture.narrow])
        : selection,
  };
};

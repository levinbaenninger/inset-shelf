import type { Mark, PinMark, Point } from "./sketch";

/** The pins among the marks, in number order: pin 1 first. */
export const pinsOf = (marks: readonly Mark[]): readonly PinMark[] =>
  marks.filter((mark): mark is PinMark => mark.kind === "pin");

/** The marks with the next pin added, at the end: it gets the next number. */
export const addPin = (marks: readonly Mark[], at: Point): readonly Mark[] => [
  ...marks,
  { at, kind: "pin" },
];

/** Where pin `index` (0-based) sits among all the marks; -1 when there is none. */
const markIndex = (marks: readonly Mark[], index: number): number => {
  let seen = -1;

  return marks.findIndex((mark) => {
    if (mark.kind === "pin") {
      seen += 1;
    }

    return mark.kind === "pin" && seen === index;
  });
};

/** The marks without pin `index`; the pins after it move up one number. */
export const removePin = (
  marks: readonly Mark[],
  index: number
): readonly Mark[] => {
  const at = markIndex(marks, index);

  return at === -1 ? marks : marks.toSpliced(at, 1);
};

/** Pin `index` at a new point, kept inside `bounds` when given; its number stays. */
export const movePin = (
  marks: readonly Mark[],
  index: number,
  to: Point,
  bounds?: { readonly width: number; readonly height: number }
): readonly Mark[] => {
  const at = markIndex(marks, index);
  const pin = marks[at];

  if (pin?.kind !== "pin") {
    return marks;
  }

  const point =
    bounds === undefined
      ? to
      : {
          x: Math.min(Math.max(to.x, 0), bounds.width),
          y: Math.min(Math.max(to.y, 0), bounds.height),
        };

  return marks.with(at, { ...pin, at: point });
};

/** Moves pin `index` by an offset, as the arrow keys do. */
export const nudgePin = (
  marks: readonly Mark[],
  index: number,
  by: Point,
  bounds?: { readonly width: number; readonly height: number }
): readonly Mark[] => {
  const pin = pinsOf(marks)[index];

  return pin === undefined
    ? marks
    : movePin(marks, index, { x: pin.at.x + by.x, y: pin.at.y + by.y }, bounds);
};

/**
 * The pin under a point, the topmost (highest number) first: the head is a
 * circle `radius` across, centred `headY` above the tip.
 */
export const pinAt = (
  marks: readonly Mark[],
  point: Point,
  radius: number,
  headY: number
): number | null => {
  const pins = pinsOf(marks);

  for (let index = pins.length - 1; index >= 0; index -= 1) {
    const pin = pins[index];

    if (
      pin !== undefined &&
      Math.hypot(point.x - pin.at.x, point.y - (pin.at.y + headY)) <= radius
    ) {
      return index;
    }
  }

  return null;
};

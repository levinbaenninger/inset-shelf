import type { Mark, PinMark, Point } from "./sketch";

/** The pins among the marks, in number order: pin 1 first. */
export const pinsOf = (marks: readonly Mark[]): readonly PinMark[] =>
  marks.filter((mark): mark is PinMark => mark.kind === "pin");

/** Where pin `index` (0-based) sits among all the marks; null when there is none. */
export const pinMarkIndex = (
  marks: readonly Mark[],
  index: number
): number | null => {
  let seen = -1;

  const at = marks.findIndex((mark) => {
    if (mark.kind === "pin") {
      seen += 1;
    }

    return mark.kind === "pin" && seen === index;
  });

  return at === -1 ? null : at;
};

/** The pin's number less one, for the mark at `markIndex`; null when that mark is no pin, or there is none. */
export const pinIndexOf = (
  marks: readonly Mark[],
  markIndex: number | null
): number | null =>
  markIndex !== null && marks[markIndex]?.kind === "pin"
    ? pinsOf(marks.slice(0, markIndex)).length
    : null;

/**
 * An arrow key's step in the drawing's units: `pixels` of the saved image
 * (1, or 10 with Shift), however many image pixels make one drawing unit.
 */
export const nudgeStep = (pixels: number, pixelsPerDip: number): number =>
  pixels / pixelsPerDip;

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

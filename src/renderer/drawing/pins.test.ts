import { describe, expect, it } from "vitest";

import { nudgeStep, pinAt, pinIndexOf, pinMarkIndex, pinsOf } from "./pins";
import { moveMarks } from "./selection";
import type { Mark } from "./sketch";

const line: Mark = {
  color: "red",
  from: { x: 0, y: 0 },
  kind: "line",
  to: { x: 10, y: 10 },
  width: 3,
};

const three = (): readonly Mark[] => [
  { at: { x: 10, y: 10 }, kind: "pin" },
  line,
  { at: { x: 20, y: 20 }, kind: "pin" },
  { at: { x: 30, y: 30 }, kind: "pin" },
];

describe(pinsOf, () => {
  it("numbers pins by order and leaves the strokes out", () => {
    expect(pinsOf(three()).map((pin) => pin.at.x)).toStrictEqual([10, 20, 30]);
  });

  it("starts with no pin", () => {
    expect(pinsOf([line])).toStrictEqual([]);
  });
});

describe(pinMarkIndex, () => {
  it("finds pin 2 among the marks, past the line before it", () => {
    expect([pinMarkIndex(three(), 0), pinMarkIndex(three(), 1)]).toStrictEqual([
      0, 2,
    ]);
    expect(pinMarkIndex(three(), 3)).toBeNull();
  });
});

describe(pinIndexOf, () => {
  it("gives the pin's place among the pins, and null for a stroke", () => {
    expect([pinIndexOf(three(), 3), pinIndexOf(three(), 1)]).toStrictEqual([
      2,
      null,
    ]);
  });
});

describe(pinAt, () => {
  it("finds the pin whose head is under the point, topmost first", () => {
    const marks: readonly Mark[] = [
      ...three(),
      { at: { x: 30, y: 31 }, kind: "pin" },
    ];

    expect(pinAt(marks, { x: 30, y: 30 - 13 }, 9, -13)).toBe(3);
    expect(pinAt(marks, { x: 10, y: 10 - 13 }, 9, -13)).toBe(0);
    expect(pinAt(marks, { x: 100, y: 100 }, 9, -13)).toBeNull();
  });
});

/** Where pin 1, at x 100 in the saved image, ends up after one arrow step of `pixels`. */
const savedX = (pixelsPerDip: number, pixels: number): number => {
  const marks: readonly Mark[] = [
    { at: { x: 100 / pixelsPerDip, y: 0 }, kind: "pin" },
  ];

  const step = nudgeStep(pixels, pixelsPerDip);
  const moved = moveMarks(marks, new Set([0]), { x: step, y: 0 });

  return (pinsOf(moved)[0]?.at.x ?? 0) * pixelsPerDip;
};

describe(nudgeStep, () => {
  it("moves a pin 1 image pixel, or 10 with Shift, on a 1× capture", () => {
    expect([savedX(1, 1), savedX(1, 10)]).toStrictEqual([101, 110]);
  });

  it("moves a pin 1 image pixel, or 10 with Shift, on a 2× capture", () => {
    expect([savedX(2, 1), savedX(2, 10)]).toStrictEqual([101, 110]);
  });
});

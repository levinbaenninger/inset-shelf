import { describe, expect, it } from "vitest";

import { addPin, movePin, nudgePin, pinAt, pinsOf, removePin } from "./pins";
import type { Mark } from "./sketch";

const line: Mark = {
  color: "red",
  from: { x: 0, y: 0 },
  kind: "line",
  to: { x: 10, y: 10 },
  width: 3,
};

const three = (): readonly Mark[] =>
  addPin(addPin(addPin([line], { x: 10, y: 10 }), { x: 20, y: 20 }), {
    x: 30,
    y: 30,
  });

describe(pinsOf, () => {
  it("numbers pins by order and leaves the strokes out", () => {
    expect(pinsOf(three()).map((pin) => pin.at.x)).toStrictEqual([10, 20, 30]);
  });

  it("starts with no pin", () => {
    expect(pinsOf([line])).toStrictEqual([]);
  });
});

describe(removePin, () => {
  it("renumbers the pins after the one removed", () => {
    const left = removePin(three(), 0);

    expect(pinsOf(left).map((pin) => pin.at.x)).toStrictEqual([20, 30]);
    expect(left[0]).toBe(line);
  });

  it("ignores a pin that isn't there", () => {
    const marks = three();

    expect(removePin(marks, 5)).toBe(marks);
  });
});

describe(movePin, () => {
  it("moves one pin, keeping its number and the image's edges", () => {
    const moved = movePin(
      three(),
      1,
      { x: 500, y: -4 },
      { height: 100, width: 200 }
    );

    expect(pinsOf(moved).map((pin) => pin.at)).toStrictEqual([
      { x: 10, y: 10 },
      { x: 200, y: 0 },
      { x: 30, y: 30 },
    ]);
  });
});

describe(nudgePin, () => {
  it("moves by 1 or 10 as the arrow keys ask", () => {
    expect(pinsOf(nudgePin(three(), 2, { x: -10, y: 1 }))[2]?.at).toStrictEqual(
      {
        x: 20,
        y: 31,
      }
    );
  });
});

describe(pinAt, () => {
  it("finds the pin whose head is under the point, topmost first", () => {
    const marks = addPin(three(), { x: 30, y: 31 });

    expect(pinAt(marks, { x: 30, y: 30 - 13 }, 9, -13)).toBe(3);
    expect(pinAt(marks, { x: 10, y: 10 - 13 }, 9, -13)).toBe(0);
    expect(pinAt(marks, { x: 100, y: 100 }, 9, -13)).toBeNull();
  });
});

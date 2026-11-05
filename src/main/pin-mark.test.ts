import {
  PIN_HEAD_Y,
  PIN_HEIGHT,
  digitStrokes,
  pinDistance,
} from "@shared/pin-shape";
import { describe, expect, it } from "vitest";

import { drawPinMarks, PIN_RGB } from "./pin-mark";

const GREY = 128;

const greyBitmap = (width: number, height: number) => ({
  data: new Uint8Array(width * height * 4).fill(GREY),
  height,
  width,
});

const bgraAt = (data: Uint8Array, width: number, x: number, y: number) => [
  ...data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4),
];

describe(pinDistance, () => {
  it("is inside at the head and outside beside the tip", () => {
    expect(pinDistance({ x: 0, y: PIN_HEAD_Y })).toBeLessThan(0);
    expect(pinDistance({ x: 0, y: -1 })).toBeLessThan(0);
    expect(pinDistance({ x: 5, y: -1 })).toBeGreaterThan(0);
    expect(pinDistance({ x: 0, y: 2 })).toBeGreaterThan(0);
  });

  it("is about 21 DIP tall, within the 18–22 DIP the spec asks for", () => {
    expect(PIN_HEIGHT).toBeGreaterThanOrEqual(18);
    expect(PIN_HEIGHT).toBeLessThanOrEqual(22);
    expect(pinDistance({ x: 0, y: -PIN_HEIGHT + 0.5 })).toBeLessThan(0);
    expect(pinDistance({ x: 0, y: -PIN_HEIGHT - 0.5 })).toBeGreaterThan(0);
  });
});

describe(digitStrokes, () => {
  it("keeps one and two digits inside the head", () => {
    for (const number of [1, 7, 10, 88, 99]) {
      for (const line of digitStrokes(number)) {
        for (const point of line) {
          expect(pinDistance(point)).toBeLessThan(-0.8);
        }
      }
    }
  });
});

describe(drawPinMarks, () => {
  const bitmap = greyBitmap(100, 100);

  const pins = [
    { x: 30, y: 60 },
    { x: 70, y: 60 },
  ];

  const marked = drawPinMarks(bitmap, pins, 2);
  const [r, g, b] = PIN_RGB;

  it("fills the head with the pin colour, in BGRA order, beside the number", () => {
    // Left of the centre of pin 1's head, clear of the digit.
    expect(bgraAt(marked, 100, 30 - 11, 60 + PIN_HEAD_Y * 2)).toStrictEqual([
      b,
      g,
      r,
      GREY,
    ]);
  });

  it("puts the tip exactly on the point", () => {
    const [blue] = bgraAt(marked, 100, 70, 59);

    expect(blue).not.toBe(GREY);
    expect(bgraAt(marked, 100, 70, 67)).toStrictEqual([GREY, GREY, GREY, GREY]);
  });

  it("draws the number in white inside the head", () => {
    // The stem of the 1 runs down the middle of the first pin's head.
    const stem = bgraAt(marked, 100, 30 + 1, 60 + PIN_HEAD_Y * 2);

    expect(stem[0]).toBeGreaterThan(200);
  });

  it("leaves the rest of the image alone", () => {
    expect(bgraAt(marked, 100, 50, 5)).toStrictEqual([GREY, GREY, GREY, GREY]);
  });

  it("returns a copy without pins unchanged", () => {
    expect(drawPinMarks(bitmap, [], 2)).toStrictEqual(bitmap.data);
  });
});

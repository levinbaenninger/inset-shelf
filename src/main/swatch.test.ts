import { describe, expect, it } from "vitest";

import { swatchBitmap } from "./swatch";

const pixel = (data: Uint8Array, size: number, x: number, y: number) => [
  ...data.subarray((y * size + x) * 4, (y * size + x) * 4 + 4),
];

describe(swatchBitmap, () => {
  it("fills the centre with the colour in BGRA order and leaves the corners clear", () => {
    const data = swatchBitmap("#ef4444", 28);

    expect(pixel(data, 28, 14, 14)).toStrictEqual([0x44, 0x44, 0xef, 255]);
    expect(pixel(data, 28, 0, 0)).toStrictEqual([0, 0, 0, 0]);
  });
});

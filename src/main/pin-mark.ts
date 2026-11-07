import {
  DIGIT_STROKE,
  digitDistance,
  digitStrokes,
  PIN_BOX,
  PIN_HALO,
  PIN_HALO_ALPHA,
  PIN_OUTLINE,
  PIN_RGB,
  pinDistance,
} from "@shared/pin-shape";

export { PIN_RGB } from "@shared/pin-shape";

type Rgb = readonly [number, number, number];

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

export interface Bitmap {
  /** BGRA, 4 bytes per pixel, as nativeImage.toBitmap returns it on macOS and Windows. */
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
}

const clamp01 = (value: number): number => Math.min(Math.max(value, 0), 1);

/** Antialiased coverage of a pixel whose centre is `distance` from an edge (negative inside), in pixels. */
const cover = (distance: number): number => clamp01(0.5 - distance);

const blend = (
  out: Uint8Array,
  offset: number,
  rgb: Rgb,
  alpha: number
): void => {
  if (alpha <= 0) {
    return;
  }

  const [r, g, b] = rgb;

  out[offset] = Math.round(b * alpha + (out[offset] ?? 0) * (1 - alpha));
  out[offset + 1] = Math.round(
    g * alpha + (out[offset + 1] ?? 0) * (1 - alpha)
  );
  out[offset + 2] = Math.round(
    r * alpha + (out[offset + 2] ?? 0) * (1 - alpha)
  );
};

/** Draws one numbered pin, tip on the point, scaled by pixelsPerDip, into `out`. */
const drawPin = (
  out: Uint8Array,
  bitmap: Bitmap,
  pin: { readonly x: number; readonly y: number },
  number: number,
  pixelsPerDip: number
): void => {
  const { height, width } = bitmap;
  const strokes = digitStrokes(number);
  const tipX = pin.x + 0.5;
  const tipY = pin.y + 0.5;
  const left = Math.floor(tipX + PIN_BOX.x * pixelsPerDip);
  const right = Math.ceil(tipX + (PIN_BOX.x + PIN_BOX.width) * pixelsPerDip);
  const top = Math.floor(tipY + PIN_BOX.y * pixelsPerDip);
  const bottom = Math.ceil(tipY + (PIN_BOX.y + PIN_BOX.height) * pixelsPerDip);

  for (let y = Math.max(0, top); y <= Math.min(height - 1, bottom); y += 1) {
    for (let x = Math.max(0, left); x <= Math.min(width - 1, right); x += 1) {
      // The pixel's centre in the pin's DIP, tip at the origin.
      const p = {
        x: (x + 0.5 - tipX) / pixelsPerDip,
        y: (y + 0.5 - tipY) / pixelsPerDip,
      };

      const edge = pinDistance(p) * pixelsPerDip;
      const offset = (y * width + x) * 4;

      blend(
        out,
        offset,
        BLACK,
        PIN_HALO_ALPHA * cover(edge - (PIN_OUTLINE + PIN_HALO) * pixelsPerDip)
      );
      blend(out, offset, WHITE, cover(edge - PIN_OUTLINE * pixelsPerDip));
      blend(out, offset, PIN_RGB, cover(edge));

      if (edge < 0) {
        const digit =
          (digitDistance(p, strokes) - DIGIT_STROKE / 2) * pixelsPerDip;

        blend(out, offset, WHITE, cover(digit));
      }
    }
  }
};

/**
 * Returns a copy of the bitmap with every pin drawn as the shelf shows it:
 * a numbered map pin, tip on the point, in the order given. Pins are in
 * image pixels; their size is in DIP, so it matches the screen.
 */
export const drawPinMarks = (
  bitmap: Bitmap,
  pins: readonly { readonly x: number; readonly y: number }[],
  pixelsPerDip: number
): Uint8Array => {
  const out = Uint8Array.from(bitmap.data);

  for (const [index, pin] of pins.entries()) {
    drawPin(out, bitmap, pin, index + 1, pixelsPerDip);
  }

  return out;
};

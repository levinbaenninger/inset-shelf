/** A filled, antialiased circle as a BGRA bitmap, for the colour swatches in native menus. */
export const swatchBitmap = (hex: string, size: number): Uint8Array => {
  const red = Number.parseInt(hex.slice(1, 3), 16);
  const green = Number.parseInt(hex.slice(3, 5), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);
  const data = new Uint8Array(size * size * 4);
  const radius = size / 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x + 0.5 - radius, y + 0.5 - radius);
      const alpha = Math.min(Math.max(radius - distance, 0), 1);
      const offset = (y * size + x) * 4;

      // Premultiplied, as Skia stores bitmaps.
      data[offset] = Math.round(blue * alpha);
      data[offset + 1] = Math.round(green * alpha);
      data[offset + 2] = Math.round(red * alpha);
      data[offset + 3] = Math.round(255 * alpha);
    }
  }

  return data;
};

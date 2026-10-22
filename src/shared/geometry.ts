export type Space = "screen" | "image" | "crop" | "preview";

declare const space: unique symbol;

/** The tag is optional so plain literals need no assertion, while mixing two spaces fails to typecheck. */
export interface Point<S extends Space> {
  readonly x: number;
  readonly y: number;
  readonly [space]?: S;
}

export interface Size<S extends Space> {
  readonly width: number;
  readonly height: number;
  readonly [space]?: S;
}

export type Rect<S extends Space> = Point<S> & Size<S>;

export const pt = <S extends Space>(x: number, y: number): Point<S> => ({
  x,
  y,
});

export const size = <S extends Space>(
  width: number,
  height: number
): Size<S> => ({
  height,
  width,
});

export const rect = <S extends Space>(
  x: number,
  y: number,
  width: number,
  height: number
): Rect<S> => ({ height, width, x, y });

export interface DisplaySnapshot {
  readonly id: number;
  readonly label: string | null;
  readonly bounds: Rect<"screen">;
  readonly workArea: Rect<"screen">;
  readonly scaleFactor: number;
}

// Design choices under test; see IMPLEMENTATION_REPORT.md.
export const DEFAULT_CROP_DIP = { height: 300, width: 480 } as const;

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), high);

/** Scales by image size over bounds, never bounds × scaleFactor, so negative origins and downscaled captures map correctly. */
export const screenToImage = (
  point: Point<"screen">,
  bounds: Rect<"screen">,
  image: Size<"image">
): Point<"image"> => {
  const x = Math.floor(((point.x - bounds.x) * image.width) / bounds.width);
  const y = Math.floor(((point.y - bounds.y) * image.height) / bounds.height);

  return pt(clamp(x, 0, image.width - 1), clamp(y, 0, image.height - 1));
};

/** Measured from the delivered image rather than taken from scaleFactor. */
export const pixelsPerDip = (
  bounds: Rect<"screen">,
  image: Size<"image">
): number => image.width / bounds.width;

/** Never shrinks: the crop must already fit inside the image. */
const shiftInside = (
  crop: Rect<"image">,
  image: Size<"image">
): Rect<"image"> =>
  rect(
    clamp(crop.x, 0, image.width - crop.width),
    clamp(crop.y, 0, image.height - crop.height),
    crop.width,
    crop.height
  );

export const defaultCrop = (
  pin: Point<"image">,
  image: Size<"image">,
  ppd: number
): Rect<"image"> => {
  const width = Math.min(Math.round(DEFAULT_CROP_DIP.width * ppd), image.width);

  const height = Math.min(
    Math.round(DEFAULT_CROP_DIP.height * ppd),
    image.height
  );

  return shiftInside(
    rect(
      Math.round(pin.x - width / 2),
      Math.round(pin.y - height / 2),
      width,
      height
    ),
    image
  );
};

export const pinInCrop = (
  pin: Point<"image">,
  crop: Rect<"image">
): Point<"crop"> => pt(pin.x - crop.x, pin.y - crop.y);

/** Movement under this many DIP between press and release counts as a click, which pins. */
export const CLICK_SLOP_DIP = 4;

/** Maps an area dragged over the frozen display, in display-local DIP, onto the captured image. */
export const areaToImage = (
  area: Rect<"screen">,
  display: Size<"screen">,
  image: Size<"image">
): Rect<"image"> => {
  const sx = image.width / display.width;
  const sy = image.height / display.height;
  const x = clamp(Math.floor(area.x * sx), 0, image.width - 1);
  const y = clamp(Math.floor(area.y * sy), 0, image.height - 1);

  const right = clamp(
    Math.ceil((area.x + area.width) * sx),
    x + 1,
    image.width
  );

  const bottom = clamp(
    Math.ceil((area.y + area.height) * sy),
    y + 1,
    image.height
  );

  return rect(x, y, right - x, bottom - y);
};

/** Normalises a drag from any corner into a rectangle. */
export const dragRect = (
  from: Point<"screen">,
  to: Point<"screen">
): Rect<"screen"> =>
  rect(
    Math.min(from.x, to.x),
    Math.min(from.y, to.y),
    Math.abs(to.x - from.x),
    Math.abs(to.y - from.y)
  );

export const SHELF_SIZE_DIP = { height: 560, width: 360 } as const;
export const SHELF_MARGIN_DIP = 12;

/** The shelf opens at the top right of the work area, or keeps its last place when that still fits. */
export const placeShelf = (
  workArea: Rect<"screen">,
  remembered: Rect<"screen"> | null
): Rect<"screen"> => {
  if (remembered !== null) {
    const width = Math.min(remembered.width, workArea.width);
    const height = Math.min(remembered.height, workArea.height);

    return rect(
      clamp(remembered.x, workArea.x, workArea.x + workArea.width - width),
      clamp(remembered.y, workArea.y, workArea.y + workArea.height - height),
      width,
      height
    );
  }

  const width = Math.min(SHELF_SIZE_DIP.width, workArea.width);

  const height = Math.min(
    SHELF_SIZE_DIP.height,
    workArea.height - 2 * SHELF_MARGIN_DIP
  );

  return rect(
    Math.max(
      workArea.x,
      workArea.x + workArea.width - width - SHELF_MARGIN_DIP
    ),
    workArea.y + SHELF_MARGIN_DIP,
    width,
    Math.max(height, 1)
  );
};

/** True when the rectangle overlaps the area at all. */
export const intersects = (a: Rect<"screen">, b: Rect<"screen">): boolean =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

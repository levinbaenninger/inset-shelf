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

export const SHELF_WIDTH_DIP = 340;
export const SHELF_MIN_HEIGHT_DIP = 360;
export const SHELF_DEFAULT_HEIGHT_DIP = 560;

/** A tall window still gets a shelf of a comfortable height, centred beside it. */
export const SHELF_MAX_HEIGHT_DIP = 620;

/** Space between the shelf and the window it docks to, and to the screen edge. */
export const SHELF_GAP_DIP = 8;

/**
 * Windows 11 reports a window's bounds with an invisible resize border on its
 * left, right and bottom edges; the visible edge is this far inside.
 */
export const WINDOWS_FRAME_INSET_DIP = 7;

/** The top that centres `height` in the span from `top` that is `extent` tall. */
const centredTop = (top: number, extent: number, height: number): number =>
  Math.round(top + (extent - height) / 2);

/**
 * Docks the shelf to the window in front: beside its right edge, else beside
 * its left edge, else inside its right edge when it fills the screen. It is
 * centred on the window's height, and as tall as the window up to
 * SHELF_MAX_HEIGHT_DIP; inside the window it keeps a gap from its edges as it
 * does from the right. Without a window it opens at the right of the work
 * area, centred on its height. `frameInset` is the invisible border included
 * in the target's bounds, so the visible gap stays SHELF_GAP_DIP.
 */
export const dockShelf = (
  target: Rect<"screen"> | null,
  workArea: Rect<"screen">,
  frameInset = 0
): Rect<"screen"> => {
  const width = Math.min(SHELF_WIDTH_DIP, workArea.width);
  const right = workArea.x + workArea.width;
  const bottom = workArea.y + workArea.height;

  if (target === null) {
    const height = Math.min(
      SHELF_DEFAULT_HEIGHT_DIP,
      workArea.height - 2 * SHELF_GAP_DIP
    );

    return rect(
      Math.max(workArea.x, right - width - SHELF_GAP_DIP),
      centredTop(workArea.y, workArea.height, height),
      width,
      height
    );
  }

  const visibleHeight = target.height - frameInset;
  const minHeight = Math.min(SHELF_MIN_HEIGHT_DIP, workArea.height);
  const maxHeight = Math.min(SHELF_MAX_HEIGHT_DIP, workArea.height);
  const height = clamp(visibleHeight, minHeight, maxHeight);

  const y = clamp(
    centredTop(target.y, visibleHeight, height),
    workArea.y,
    bottom - height
  );

  const beside = target.x + target.width - frameInset + SHELF_GAP_DIP;
  const before = target.x + frameInset - width - SHELF_GAP_DIP;

  if (beside + width <= right) {
    return rect(beside, y, width, height);
  }

  if (before >= workArea.x) {
    return rect(before, y, width, height);
  }

  const inside =
    Math.min(target.x + target.width, right) - width - SHELF_GAP_DIP;

  const top = Math.max(target.y, workArea.y) + SHELF_GAP_DIP;
  const end = Math.min(target.y + visibleHeight, bottom) - SHELF_GAP_DIP;
  const insideHeight = clamp(end - top, minHeight, height);

  return rect(
    clamp(inside, workArea.x, right - width),
    clamp(
      centredTop(top, end - top, insideHeight),
      workArea.y,
      bottom - insideHeight
    ),
    width,
    insideHeight
  );
};

/** True when the rectangle overlaps the area at all. */
export const intersects = (a: Rect<"screen">, b: Rect<"screen">): boolean =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

/** Room around an image on the drawing page; the bottom leaves space for the toolbar. */
export const VIEWER_MARGIN = { bottom: 76, side: 24, top: 24 } as const;

/** The drawing window's header with Save, above the page. */
export const VIEWER_HEADER_DIP = 48;

/** The smallest drawing window, which still fits the toolbar. */
export const VIEWER_MIN = { height: 360, width: 560 } as const;

/** Where an image sits on the drawing page: centred, as large as fits, never above its own size. */
export const viewerImageRect = (
  page: Size<"preview">,
  image: Size<"preview">
): Rect<"preview"> & { readonly scale: number } => {
  const roomWidth = Math.max(1, page.width - 2 * VIEWER_MARGIN.side);

  const roomHeight = Math.max(
    1,
    page.height - VIEWER_MARGIN.top - VIEWER_MARGIN.bottom
  );

  const scale = Math.min(1, roomWidth / image.width, roomHeight / image.height);

  const width = image.width * scale;
  const height = image.height * scale;

  return {
    height,
    scale,
    width,
    x: (page.width - width) / 2,
    y: VIEWER_MARGIN.top + (roomHeight - height) / 2,
  };
};

/** The drawing window's content size for an image: room for it at its own size, within 90% of the work area. */
export const viewerWindowSize = (
  image: Size<"preview">,
  workArea: Rect<"screen">
): Size<"screen"> => ({
  height: Math.round(
    clamp(
      image.height +
        VIEWER_HEADER_DIP +
        VIEWER_MARGIN.top +
        VIEWER_MARGIN.bottom,
      Math.min(VIEWER_MIN.height, workArea.height),
      workArea.height * 0.9
    )
  ),
  width: Math.round(
    clamp(
      image.width + 2 * VIEWER_MARGIN.side,
      Math.min(VIEWER_MIN.width, workArea.width),
      workArea.width * 0.9
    )
  ),
});

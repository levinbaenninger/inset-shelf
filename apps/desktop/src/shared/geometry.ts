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

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), high);

export const SHELF_WIDTH_DIP = 340;

/** As narrow as the shelf's window can be dragged. */
export const SHELF_MIN_WIDTH_DIP = 300;
export const SHELF_MIN_HEIGHT_DIP = 360;

/**
 * The shelf opens at this height whichever way it was opened, beside a
 * window of any height or with none; only a screen too short for it makes
 * it shorter.
 */
export const SHELF_HEIGHT_DIP = 620;

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
 * centred on the window's height and kept on screen. Without a window it
 * opens at the right of the work area, centred on its height. It is always
 * SHELF_HEIGHT_DIP tall, less the gaps on a screen too short for that. `frameInset` is the invisible border included
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

  const height = Math.min(
    SHELF_HEIGHT_DIP,
    workArea.height - 2 * SHELF_GAP_DIP
  );

  if (target === null) {
    return rect(
      Math.max(workArea.x, right - width - SHELF_GAP_DIP),
      centredTop(workArea.y, workArea.height, height),
      width,
      height
    );
  }

  const visibleHeight = target.height - frameInset;

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

  return rect(
    clamp(inside, workArea.x, right - width),
    clamp(centredTop(top, end - top, height), workArea.y, bottom - height),
    width,
    height
  );
};

/** How far the shelf's top may be from its expected place: window edges are rounded to whole points. */
const DOCK_TOLERANCE_DIP = 1;

/**
 * Whether `shelf` sits where the desktop trial expects beside `target`'s
 * right edge on a display with this work area: its one height, or what the
 * screen leaves it, centred on the window's height and held inside the work
 * area at its top and its bottom.
 */
export const dockedBeside = (
  shelf: Rect<"screen">,
  target: Rect<"screen">,
  workArea: Rect<"screen">
): boolean => {
  const height = Math.min(
    SHELF_HEIGHT_DIP,
    workArea.height - 2 * SHELF_GAP_DIP
  );

  const centred = target.y + (target.height - height) / 2;
  const lowest = workArea.y + workArea.height - height;
  const top = Math.min(Math.max(centred, workArea.y), lowest);

  return (
    shelf.x === target.x + target.width + SHELF_GAP_DIP &&
    Math.abs(shelf.y - top) <= DOCK_TOLERANCE_DIP &&
    shelf.height === height
  );
};

/** True when the rectangle overlaps the area at all. */
export const intersects = (a: Rect<"screen">, b: Rect<"screen">): boolean =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

/** How far a notice sits from the pointer, so it covers neither the pointer nor the text just selected above it. */
export const NOTICE_GAP_DIP = 12;

/**
 * A notice next to the pointer, where the user is looking: below and to the
 * right of it, flipped above or to the left where the screen ends there.
 */
export const noticeBesidePointer = (
  pointer: Point<"screen">,
  notice: Size<"screen">,
  workArea: Rect<"screen">
): Rect<"screen"> => {
  const right = workArea.x + workArea.width - notice.width;
  const bottom = workArea.y + workArea.height - notice.height;
  const besideX = pointer.x + NOTICE_GAP_DIP;
  const belowY = pointer.y + NOTICE_GAP_DIP;

  return rect(
    clamp(
      besideX <= right ? besideX : pointer.x - NOTICE_GAP_DIP - notice.width,
      workArea.x,
      right
    ),
    clamp(
      belowY <= bottom ? belowY : pointer.y - NOTICE_GAP_DIP - notice.height,
      workArea.y,
      bottom
    ),
    notice.width,
    notice.height
  );
};

/**
 * A notice inside a window's bottom-right corner, kept inside the work area;
 * the work area's own corner when there is no window. The recall pill sits
 * there: it is unasked, so it stays away from the pointer and the next click.
 */
export const noticeInWindowCorner = (
  target: Rect<"screen"> | null,
  notice: Size<"screen">,
  workArea: Rect<"screen">
): Rect<"screen"> => {
  const corner = target ?? workArea;
  const right = workArea.x + workArea.width - notice.width;
  const bottom = workArea.y + workArea.height - notice.height;

  return rect(
    clamp(
      corner.x + corner.width - NOTICE_GAP_DIP - notice.width,
      workArea.x,
      right
    ),
    clamp(
      corner.y + corner.height - NOTICE_GAP_DIP - notice.height,
      workArea.y,
      bottom
    ),
    notice.width,
    notice.height
  );
};

/** A window's corner, named as the notice window names where it draws. */
export type Corner = `${"top" | "bottom"}-${"left" | "right"}`;

/**
 * A window given a new size around one of its corners, which stays where it
 * was, then kept inside the work area: the notice turning into the why field
 * grows away from the corner it is drawn in.
 */
export const resizeAtCorner = (
  bounds: Rect<"screen">,
  corner: Corner,
  next: Size<"screen">,
  workArea: Rect<"screen">
): Rect<"screen"> => {
  const x = corner.endsWith("left")
    ? bounds.x
    : bounds.x + bounds.width - next.width;

  const y = corner.startsWith("top")
    ? bounds.y
    : bounds.y + bounds.height - next.height;

  return rect(
    clamp(x, workArea.x, workArea.x + workArea.width - next.width),
    clamp(y, workArea.y, workArea.y + workArea.height - next.height),
    next.width,
    next.height
  );
};

/** Room around an image on the drawing page; the bottom leaves space for the toolbar. */
export const VIEWER_MARGIN = { bottom: 76, side: 24, top: 24 } as const;

/** The header of Inset's titled windows, the drawing window's and Settings', with the title and the window's buttons. */
export const WINDOW_HEADER_DIP = 48;

/** The smallest drawing window, which still fits the toolbar. */
export const VIEWER_MIN = { height: 360, width: 600 } as const;

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
        WINDOW_HEADER_DIP +
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

import { SHELF_GAP_DIP, SHELF_HEIGHT_DIP } from "./geometry";
import type { Rect } from "./geometry";

/** How far the shelf's top may be from its expected place: window edges are rounded to whole points. */
const TOLERANCE_DIP = 1;

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
    Math.abs(shelf.y - top) <= TOLERANCE_DIP &&
    shelf.height === height
  );
};

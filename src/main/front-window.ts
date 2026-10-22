import { rect } from "@shared/geometry";
import type { Rect } from "@shared/geometry";
import { activeWindow } from "get-windows";

/**
 * The bounds of the window in front, read before the shelf shows. Bounds need
 * no permission; the title, which needs Screen Recording, is not asked for.
 * Null when it is Inset's own window or cannot be read.
 */
export const frontWindowBounds = async (): Promise<Rect<"screen"> | null> => {
  try {
    const front = await activeWindow({
      accessibilityPermission: false,
      screenRecordingPermission: false,
    });

    if (front === undefined || front.owner.processId === process.pid) {
      return null;
    }

    const { height, width, x, y } = front.bounds;

    return width > 0 && height > 0 ? rect(x, y, width, height) : null;
  } catch {
    return null;
  }
};

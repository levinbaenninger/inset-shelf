import { rect } from "@shared/geometry";
import type { Rect } from "@shared/geometry";
import { ContextSchema } from "@shared/shelf";
import type { ItemContext } from "@shared/shelf";
import { systemPreferences } from "electron";
import { activeWindow } from "get-windows";

export interface FrontWindow {
  readonly bounds: Rect<"screen"> | null;
  readonly context: ItemContext | null;
}

const NOTHING: FrontWindow = { bounds: null, context: null };

const isMac = process.platform === "darwin";

const orNull = (text: string | undefined): string | null =>
  text === undefined || text.trim() === "" ? null : text.trim();

/** Only http and https pages are kept as links. */
const pageUrl = (url: string | undefined): string | null => {
  const parsed = ContextSchema.shape.url.safeParse(orNull(url));

  return parsed.success ? parsed.data : null;
};

/**
 * The window in front, read before Inset takes focus: its bounds for docking,
 * and the app, window title and browser page as an item's source. It asks
 * only for what is already granted, so it never prompts: the title needs
 * Screen Recording, the page address needs Accessibility. A browser's page
 * address also needs the user's one-time consent to Automation. Null parts
 * when it is Inset's own window or cannot be read.
 */
export const frontWindow = async (): Promise<FrontWindow> => {
  try {
    const front = await activeWindow({
      accessibilityPermission:
        !isMac || systemPreferences.isTrustedAccessibilityClient(false),
      screenRecordingPermission:
        !isMac ||
        systemPreferences.getMediaAccessStatus("screen") === "granted",
    });

    if (front === undefined || front.owner.processId === process.pid) {
      return NOTHING;
    }

    const { height, width, x, y } = front.bounds;

    return {
      bounds: width > 0 && height > 0 ? rect(x, y, width, height) : null,
      context: {
        app: orNull(front.owner.name),
        title: orNull(front.title),
        url: "url" in front ? pageUrl(front.url) : null,
      },
    };
  } catch {
    return NOTHING;
  }
};

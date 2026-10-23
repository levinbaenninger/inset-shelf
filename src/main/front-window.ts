import { rect } from "@shared/geometry";
import type { Rect } from "@shared/geometry";
import { ContextSchema } from "@shared/shelf";
import type { ItemContext } from "@shared/shelf";
import { screen, systemPreferences } from "electron";
import type { Rectangle } from "electron";
import { activeWindow } from "get-windows";

export interface FrontWindow {
  readonly bounds: Rect<"screen"> | null;
  readonly context: ItemContext | null;
  /** One of Inset's own windows is in front, so there is nothing new to dock to. */
  readonly own: boolean;
}

const NOTHING: FrontWindow = { bounds: null, context: null, own: false };

const OWN: FrontWindow = { ...NOTHING, own: true };

const isMac = process.platform === "darwin";

/** Windows reports physical pixels; the shelf is placed in DIP. Elsewhere they are DIP already. */
const toDip = (bounds: Rectangle): Rectangle =>
  process.platform === "win32" ? screen.screenToDipRect(null, bounds) : bounds;

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
 * when it cannot be read, and `own` when it is one of Inset's windows.
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

    if (front === undefined) {
      return NOTHING;
    }

    if (front.owner.processId === process.pid) {
      return OWN;
    }

    const { height, width, x, y } = toDip(front.bounds);

    return {
      bounds: width > 0 && height > 0 ? rect(x, y, width, height) : null,
      context: {
        app: orNull(front.owner.name),
        title: orNull(front.title),
        url: "url" in front ? pageUrl(front.url) : null,
      },
      own: false,
    };
  } catch {
    return NOTHING;
  }
};

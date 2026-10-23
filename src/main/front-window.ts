import { rect } from "@shared/geometry";
import type { Rect } from "@shared/geometry";
import { ContextSchema } from "@shared/shelf";
import type { ItemContext } from "@shared/shelf";
import { desktopLink, t3Thread } from "@shared/web-source";
import { screen, systemPreferences } from "electron";
import type { Rectangle } from "electron";
import { activeWindow } from "get-windows";

import { chatGptThreadLink } from "./codex-threads";
import { readWebAreas } from "./page-address";
import { t3ThreadTitle } from "./t3-threads";

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
 * Where an item comes from, filled in from the window's web areas when `pid`
 * is given: the page address get-windows couldn't read, a better title where
 * the window only names its app (Claude, T3 Code), and the link that opens
 * the item again inside its desktop app.
 */
const sourceContext = async (
  window: Omit<ItemContext, "appLink">,
  pid: number | null
): Promise<ItemContext> => {
  const areas = pid === null ? [] : await readWebAreas(pid);
  const page = areas.find((area) => pageUrl(area.url) !== null);
  const url = window.url ?? pageUrl(page?.url);

  const thread =
    areas.map((area) => t3Thread(area.url)).find((found) => found !== null) ??
    null;

  const named = window.title === null || window.title === window.app;

  const threadTitle =
    thread === null ? null : await t3ThreadTitle(thread.thread);

  const title =
    threadTitle ??
    (named ? (orNull(page?.title) ?? window.title) : window.title);

  const appLink =
    thread?.link ??
    desktopLink(window.app, url) ??
    (window.app === "ChatGPT" && pid !== null
      ? await chatGptThreadLink(title)
      : null);

  return { app: window.app, appLink, title, url };
};

/**
 * The window in front, read before Inset takes focus: its bounds for docking,
 * and the app, window title and browser page as an item's source. It asks
 * only for what is already granted, so it never prompts: the title needs
 * Screen Recording, the page address needs Accessibility. Chrome, Safari and
 * their kin also need the user's one-time consent to Automation; with
 * `page`, other apps (Firefox, Zen, web views) are asked through their
 * accessibility tree, which takes a moment longer. Null parts when they
 * cannot be read, and `own` when it is one of Inset's windows.
 */
export const frontWindow = async (
  options: { readonly page?: boolean } = {}
): Promise<FrontWindow> => {
  try {
    const trusted =
      !isMac || systemPreferences.isTrustedAccessibilityClient(false);

    const front = await activeWindow({
      accessibilityPermission: trusted,
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

    const context = await sourceContext(
      {
        app: orNull(front.owner.name),
        title: orNull(front.title),
        url: "url" in front ? pageUrl(front.url) : null,
      },
      options.page === true && isMac && trusted ? front.owner.processId : null
    );

    return {
      bounds: width > 0 && height > 0 ? rect(x, y, width, height) : null,
      context,
      own: false,
    };
  } catch {
    return NOTHING;
  }
};

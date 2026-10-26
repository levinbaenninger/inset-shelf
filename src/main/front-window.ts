import path from "node:path";

import { rect } from "@shared/geometry";
import type { Rect } from "@shared/geometry";
import { ContextSchema } from "@shared/shelf";
import type { ItemContext } from "@shared/shelf";
import { desktopLink, t3Thread } from "@shared/web-source";
import { withoutAppName } from "@shared/window-title";
import { app, screen, systemPreferences } from "electron";
import type { Rectangle } from "electron";
import { activeWindow } from "get-windows";

import { chatGptThreadLink } from "./codex-threads";
import { readWebAreas } from "./page-address";
import type { WebArea } from "./page-address";
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

/**
 * Windows' desktop ("Program Manager", as wide as all displays) and its
 * taskbar (untitled, in front after a click on the notification area) are
 * no window to dock to or capture from.
 */
const isWindowsShell = (title: string, owner: string): boolean =>
  process.platform === "win32" &&
  path.win32.basename(owner).toLowerCase() === "explorer.exe" &&
  (title === "Program Manager" || title.trim() === "");

/** Only http and https pages are kept as links. */
const pageUrl = (url: string | undefined): string | null => {
  const parsed = ContextSchema.shape.url.safeParse(orNull(url));

  return parsed.success ? parsed.data : null;
};

/**
 * Where an item comes from, filled in from the pages the window shows, when
 * they are asked for: the page address get-windows couldn't read, a better
 * title where the window only names its app (Claude, T3 Code), and the link
 * that opens the item again inside its desktop app.
 */
const sourceContext = async (
  window: Omit<ItemContext, "appLink">,
  areas: readonly WebArea[] | null
): Promise<ItemContext> => {
  const page = areas?.find((area) => pageUrl(area.url) !== null);
  const url = window.url ?? pageUrl(page?.url);

  const thread =
    areas?.map((area) => t3Thread(area.url)).find((found) => found !== null) ??
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
    (window.app === "ChatGPT" && areas !== null
      ? await chatGptThreadLink(title)
      : null);

  // On Windows a link opens only in an app that registered its scheme (T3 Code, ChatGPT, Claude); without one it is no link.
  const openable =
    appLink !== null &&
    (isMac || app.getApplicationNameForProtocol(appLink) !== "")
      ? appLink
      : null;

  return { app: window.app, appLink: openable, title, url };
};

/** The pages a window shows: its web areas, read with `pid`, and the page the copied text came from. */
const pageAreas = async (
  pid: number | null,
  copiedFrom: Promise<string | null> | undefined
): Promise<readonly WebArea[]> => {
  const [tree, copied] = await Promise.all([
    pid === null ? [] : readWebAreas(pid),
    copiedFrom ?? null,
  ]);

  return copied === null ? tree : [...tree, { title: "", url: copied }];
};

/**
 * The window in front, read before Inset takes focus: its bounds for docking,
 * and the app, window title and browser page as an item's source. It asks
 * only for what is already granted, so it never prompts: the title needs
 * Screen Recording, the page address needs Accessibility. Chrome, Safari and
 * their kin also need the user's one-time consent to Automation; with
 * `page`, other apps (Firefox, Zen, web views) are asked through their
 * accessibility tree, which takes a moment longer. On Windows the page is
 * the one a browser noted beside text copied from it, `copiedFrom`. Null
 * parts when they cannot be read, and `own` when it is one of Inset's windows.
 */
export const frontWindow = async (
  options: {
    readonly page?: boolean;
    /** The page the copied selection came from, known once the copy is read. */
    readonly copiedFrom?: Promise<string | null>;
  } = {}
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

    if (isWindowsShell(front.title, front.owner.path)) {
      return NOTHING;
    }

    const { height, width, x, y } = toDip(front.bounds);

    const owner = orNull(front.owner.name);

    const areas =
      options.page === true
        ? await pageAreas(
            isMac && trusted ? front.owner.processId : null,
            options.copiedFrom
          )
        : null;

    const context = await sourceContext(
      {
        app: owner,
        title: orNull(isMac ? front.title : withoutAppName(front.title, owner)),
        url: "url" in front ? pageUrl(front.url) : null,
      },
      areas
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

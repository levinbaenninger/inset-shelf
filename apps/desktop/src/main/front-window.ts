import path from "node:path";

import { CODE_EDITORS, codeEditor, codePlace } from "@shared/code-editors";
import { rect } from "@shared/geometry";
import type { Rect } from "@shared/geometry";
import {
  APP_NAME_MAX,
  ContextSchema,
  fitText,
  WINDOW_TITLE_MAX,
} from "@shared/shelf";
import type { ItemContext } from "@shared/shelf";
import { desktopLink, t3Thread, webUrl } from "@shared/web-source";
import { app, screen, systemPreferences } from "electron";
import type { Rectangle } from "electron";
import { activeWindow } from "get-windows";

import { chatGptThreadLink } from "./codex-threads";
import { E2E_EDITORS } from "./e2e-log";
import { NO_WINDOW, readFocusedWindow } from "./page-address";
import type { FocusedWindow, WebArea } from "./page-address";
import { t3ThreadTitle } from "./t3-threads";
import { documentPath } from "./window-origin";

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

/** Only web pages and pages opened from a file are kept as links. */
const pageUrl = (url: string | undefined): string | null => {
  const parsed = ContextSchema.shape.url.safeParse(orNull(url));

  return parsed.success ? parsed.data : null;
};

/** The page a window shows: a web page first, since a page from a file may be an app's own shell around it. */
const shownPage = (areas: readonly WebArea[]): WebArea | undefined =>
  areas.find((area) => webUrl(area.url) !== null) ??
  areas.find((area) => pageUrl(area.url) !== null);

/** The names cut to what the saved shelf keeps; a longer one would make it unreadable. */
const fitted = (context: ItemContext): ItemContext => ({
  ...context,
  app: context.app === null ? null : fitText(context.app, APP_NAME_MAX),
  title:
    context.title === null ? null : fitText(context.title, WINDOW_TITLE_MAX),
});

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
  const page = shownPage(areas ?? []);

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

  return fitted({ ...window, appLink: openable, title, url });
};

/** What a window shows: its document and web areas, read with `pid`, and the page the copied text came from. */
const shownBy = async (
  pid: number | null,
  copiedFrom: Promise<string | null> | undefined
): Promise<FocusedWindow> => {
  const [read, copied] = await Promise.all([
    pid === null ? NO_WINDOW : readFocusedWindow(pid),
    copiedFrom ?? null,
  ]);

  return copied === null
    ? read
    : { ...read, areas: [...read.areas, { title: "", url: copied }] };
};

/** The editors main knows: the registry, and the desktop test's stand-in under its log. */
export const EDITORS = [...CODE_EDITORS, ...E2E_EDITORS];

/**
 * The window in front, read before Inset takes focus: its bounds for docking,
 * and the app, window title and browser page as an item's source, with the
 * file a code editor shows on macOS. It asks
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
    /**
     * False reads only the app, title and bounds: no Apple Event, so never a
     * consent prompt. Recall's cheap read, src/main/front-watch.ts.
     */
    readonly address?: boolean;
    /** The page the copied selection came from, known once the copy is read. */
    readonly copiedFrom?: Promise<string | null>;
  } = {}
): Promise<FrontWindow> => {
  try {
    const trusted =
      !isMac || systemPreferences.isTrustedAccessibilityClient(false);

    const front = await activeWindow({
      accessibilityPermission: trusted && options.address !== false,
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

    const shown =
      options.page === true
        ? await shownBy(
            isMac && trusted ? front.owner.processId : null,
            options.copiedFrom
          )
        : null;

    // As the window has it: the shelf cleans a title where it shows or compares it, src/shared/window-title.ts.
    const title = orNull(front.title);

    const document =
      shown === null || shown.document === null
        ? null
        : documentPath(shown.document);

    const context = await sourceContext(
      {
        app: owner,
        code: codePlace(codeEditor(owner, EDITORS), document, title, owner),
        title,
        url: "url" in front ? pageUrl(front.url) : null,
      },
      shown?.areas ?? null
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

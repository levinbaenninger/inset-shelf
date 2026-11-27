/**
 * How a window's app and title read once what the system adds to them is
 * gone: the one cleaning a source's label, a window link's name, the window
 * picker and recall's matching all use. It takes a title as the window has
 * it ("Page - Microsoft Edge") and the shelf keeps it as read, and cleans it
 * where it is shown or compared, never when it is kept, so no title is
 * cleaned twice. Each rule here is for the app and the system it is known
 * from; any other title and app stay as they are.
 */

/** Zero-width characters; Edge writes a zero-width space inside its name. */
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/gu;

/**
 * Apps get-windows names by their program file on Windows, and the name they
 * show under. Read from a Windows 11 PC (2026-11-27): Notepad has no file
 * description there. Any other name keeps its ".exe": "Ledger.exe" can be
 * an app's own description, apart from an app called "Ledger".
 */
const PROGRAM_NAMES: ReadonlyMap<string, string> = new Map([
  ["notepad.exe", "Notepad"],
]);

/** An app's name as the shelf shows it: "Notepad.exe" reads "Notepad". Any other name stays as it is. */
export const appName = (app: string | null): string | null =>
  app === null ? null : (PROGRAM_NAMES.get(app.toLowerCase()) ?? app);

/** Names apps end their window titles with when these differ from the app's own name. */
const TITLE_NAMES = {
  Firefox: ["Mozilla Firefox"],
} as const satisfies Readonly<Record<string, readonly string[]>>;

const hasTitleName = (app: string): app is keyof typeof TITLE_NAMES =>
  Object.hasOwn(TITLE_NAMES, app);

const DASHES = [" - ", " — ", " – "] as const;

const EDGE = "Microsoft Edge";
const NOTEPAD = "Notepad";

/** Edge's count of the window's other tabs, after the page's title. Its English wording only. */
const MORE_PAGES = /\s+and \d+ more pages?$/u;

/** Notepad's mark for unsaved changes, first in its title. */
const NOTEPAD_MARK = /^\*\s*/u;

/**
 * A window's title without the app's name at its end, or null when it
 * doesn't end in it. Windows titles read "Page - Google Chrome", "Notes.txt -
 * Notepad" or "Page — Mozilla Firefox", where macOS titles only name the page
 * or document. What it keeps is what stays between the title and the app's name.
 */
const withoutName = (title: string, app: string | null): string | null => {
  if (app === null) {
    return null;
  }

  const shown = appName(app) ?? app;
  const visible = title.replaceAll(INVISIBLE, "");

  const names = [
    ...new Set([
      app,
      shown,
      ...(hasTitleName(shown) ? TITLE_NAMES[shown] : []),
    ]),
  ];

  for (const name of names) {
    for (const dash of DASHES) {
      const suffix = `${dash}${name}`;

      if (visible.endsWith(suffix) && visible.length > suffix.length) {
        return visible.slice(0, -suffix.length).trim();
      }
    }
  }

  return null;
};

/** A title without the app's name at its end, nothing else off: the way a thread or file is named in a window's title. */
export const withoutAppName = (title: string, app: string | null): string =>
  withoutName(title, app) ?? title;

/**
 * The page's or file's own name, from a title read as the window has it.
 * Only a title that ends in the app's name is changed, and what else goes
 * is read from that app's own windows on Windows: Edge also writes its
 * profile after the page's title (the last " - ") and counts its other tabs
 * before it (Edge 158: "Example Domain and 1 more page - Profile 1 -
 * Microsoft Edge"; Chrome 158 writes neither), and Notepad marks unsaved
 * changes with a leading "*". An Edge window without Edge's name is an
 * installed web app's, and its title is the page's own.
 */
const pageTitle = (title: string, app: string | null): string => {
  const rest = withoutName(title, app);

  if (rest === null) {
    return title;
  }

  const shown = appName(app);

  if (shown === EDGE) {
    const profileAt = rest.lastIndexOf(" - ");
    const page = profileAt > 0 ? rest.slice(0, profileAt) : rest;

    return page.replace(MORE_PAGES, "").trim();
  }

  return shown === NOTEPAD ? rest.replace(NOTEPAD_MARK, "") : rest;
};

const UNREAD = /^\(\d+\)\s+/u;

/** The mark of unsaved changes in Code and others: a dot first in the title. */
const DIRTY = /^[●•]\s*/u;

const tidy = (title: string): string =>
  title.trim().replace(UNREAD, "").replace(DIRTY, "").trim();

/** A window's title as it names what it shows: without the app's name and what that app adds, an unread count or an unsaved mark; null when nothing is left or it only names the app. For showing. */
export const shownTitle = (
  title: string | null,
  app: string | null
): string | null => {
  if (title === null) {
    return null;
  }

  const clean = tidy(pageTitle(title, app));

  return clean === "" || clean === app || clean === appName(app) ? null : clean;
};

/** A window's title cleaned as it is shown, for telling windows apart: null when it is too short to name a place. */
export const cleanTitle = (
  title: string | null,
  app: string | null
): string | null => {
  const clean = shownTitle(title, app);

  return clean === null || clean.length < 3 ? null : clean;
};

/**
 * What a window's title can be called when two windows are compared: the
 * title as it is cleaned now, and as a build before this one cleaned it,
 * with only the app's name off. Items kept by that build hold the second
 * (Edge's profile still on it), and that form is unchanged by cleaning.
 */
export const titleKeys = (
  title: string | null,
  app: string | null
): readonly string[] => {
  const earlier = title === null ? "" : tidy(withoutName(title, app) ?? title);

  return [
    ...new Set(
      [
        cleanTitle(title, app),
        earlier.length < 3 || earlier === app ? null : earlier,
      ].filter((key) => key !== null)
    ),
  ];
};

/** A linked window in a few words: its cleaned title, else its app's name. */
export const windowName = (window: {
  readonly app: string | null;
  readonly title: string | null;
}): string =>
  shownTitle(window.title, window.app) ?? appName(window.app) ?? "Window";

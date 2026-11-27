/** Zero-width characters; Edge writes a zero-width space inside its name. */
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/gu;

/** A program file's name, which get-windows reports for an app whose program has no description (Windows 11's Notepad). */
const PROGRAM_FILE = /\.exe$/iu;

const nameOf = (app: string): string => {
  const name = app.replace(PROGRAM_FILE, "").trim();

  return name === "" ? app : name;
};

/** An app's name as the shelf shows it: "Notepad.exe" reads "Notepad". Any other name stays as it is. */
export const appName = (app: string | null): string | null =>
  app === null ? null : nameOf(app);

/** Names apps end their window titles with when these differ from the app's own name. */
const TITLE_NAMES = {
  Firefox: ["Mozilla Firefox"],
} as const satisfies Readonly<Record<string, readonly string[]>>;

const hasTitleName = (app: string): app is keyof typeof TITLE_NAMES =>
  Object.hasOwn(TITLE_NAMES, app);

const DASHES = [" - ", " — ", " – "] as const;

/**
 * Edge writes its profile, and a count of the window's other tabs, between
 * the page's title and its own name: "Example Domain and 1 more page -
 * Profile 1 - Microsoft Edge" (Edge 158 on Windows 11). Chrome 158 writes
 * neither: two tabs read "Example Domain - Google Chrome".
 */
const EDGE = "Microsoft Edge";

/** Edge's count of the other tabs, after the page's title. Its English wording only. */
const MORE_PAGES = /\s+and \d+ more pages?$/u;

/** The page's own title, from a window's title without the app's name: for Edge, without its profile and its count of other tabs. */
const pageTitle = (rest: string, app: string): string => {
  if (app !== EDGE) {
    return rest;
  }

  const profileAt = rest.lastIndexOf(" - ");
  const page = profileAt > 0 ? rest.slice(0, profileAt) : rest;

  return page.replace(MORE_PAGES, "").trim();
};

/**
 * A window's title without what the app adds at its end. Windows titles read
 * "Page - Google Chrome", "Notes.txt - Notepad" or "Page — Mozilla Firefox",
 * where macOS titles only name the page or document; Edge also names its
 * profile and counts its other tabs there, which go too. Only a title that
 * ends in the app's name is changed: that is what tells a browser's window
 * from an installed web app's.
 */
export const withoutAppName = (title: string, app: string | null): string => {
  if (app === null) {
    return title;
  }

  const shown = nameOf(app);

  const visible = title.replaceAll(INVISIBLE, "");

  const names = [
    ...new Set([
      shown,
      app,
      ...(hasTitleName(shown) ? TITLE_NAMES[shown] : []),
    ]),
  ];

  for (const name of names) {
    for (const dash of DASHES) {
      const suffix = `${dash}${name}`;

      if (visible.endsWith(suffix) && visible.length > suffix.length) {
        return pageTitle(visible.slice(0, -suffix.length).trim(), shown);
      }
    }
  }

  return title;
};

const UNREAD = /^\(\d+\)\s+/u;

/** Marks for unsaved changes: Code's dot, and the asterisk Windows apps such as Notepad put first. */
const DIRTY = /^[●•*]\s*/u;

/** A window's title as it names what it shows: without the app's name, an unread count or an unsaved mark; null when nothing is left or it only names the app. For showing. */
export const shownTitle = (
  title: string | null,
  app: string | null
): string | null => {
  if (title === null) {
    return null;
  }

  const clean = withoutAppName(title, app)
    .trim()
    .replace(UNREAD, "")
    .replace(DIRTY, "")
    .trim();

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

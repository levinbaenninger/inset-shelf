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
 * A window's title without the app's name at its end. Windows titles read
 * "Page - Google Chrome", "Notes.txt - Notepad" or "Page — Mozilla Firefox",
 * where macOS titles only name the page or document. Any other title stays
 * as it is.
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
        return visible.slice(0, -suffix.length).trim();
      }
    }
  }

  return title;
};

const UNREAD = /^\(\d+\)\s+/u;

/** Marks for unsaved changes: Code's dot, and the asterisk Windows apps such as Notepad put first. */
const DIRTY = /^[●•*]\s*/u;

/** A window's title as it names what it shows: without the app's name, an unread count or an unsaved mark; null when that says nothing. */
export const cleanTitle = (
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

  return clean.length < 3 || clean === app || clean === appName(app)
    ? null
    : clean;
};

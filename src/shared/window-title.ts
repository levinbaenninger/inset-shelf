/** Zero-width characters; Edge writes a zero-width space inside its name. */
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/gu;

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

  const visible = title.replaceAll(INVISIBLE, "");
  const names = [app, ...(hasTitleName(app) ? TITLE_NAMES[app] : [])];

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

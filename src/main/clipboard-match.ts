import type { ClipboardContents } from "./copy-gate";

/**
 * The formats every app reads. The raw ones Electron also reports
 * (`electron application/osclipboard;format=…`) don't always come back the
 * same, and macOS adds plain text and HTML to rich text put back.
 */
const STANDARD = new Set([
  "image/png",
  "text/html",
  "text/plain",
  "text/rtf",
  "text/uri-list",
]);

/** Text as the clipboard may hand it back: Windows line breaks, a trailing NUL. */
const plain = (text: string): string =>
  text.replaceAll("\r\n", "\n").replace(/\0+$/u, "");

/**
 * Whether the clipboard, read again as `types` and `text`, holds what
 * `saved` held: every standard format it had, and the same plain text. A
 * clipboard saved without any holds none again, so a copied selection left
 * behind counts as not put back.
 */
export const holdsAgain = async (
  saved: readonly ClipboardContents[],
  types: readonly string[],
  text: string
): Promise<boolean> => {
  const before = saved
    .flatMap((entry) => Object.keys(entry))
    .filter((type) => STANDARD.has(type));

  if (before.length === 0) {
    return !types.some((type) => STANDARD.has(type));
  }

  if (!before.every((type) => types.includes(type))) {
    return false;
  }

  const savedText = saved.find((entry) => "text/plain" in entry)?.[
    "text/plain"
  ];

  // Read back as a Blob, as Electron hands every format but bookmarks.
  const was = savedText instanceof Blob ? await savedText.text() : null;

  return was === null || plain(was) === plain(text);
};

import { isDeepStrictEqual } from "node:util";

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

const snapshotData = async (items: readonly ClipboardContents[]) =>
  await Promise.all(
    items.map(async (item) =>
      Object.fromEntries(
        await Promise.all(
          Object.entries(item).map(async ([type, data]) => {
            const value = await data;

            return [
              type,
              value instanceof Blob
                ? Buffer.from(await value.arrayBuffer())
                : value,
            ] as const;
          })
        )
      )
    )
  );

const isEmpty = (value: ClipboardContents[string]): boolean =>
  value instanceof Blob ? value.size === 0 : value === "";

/**
 * Whether a read of the clipboard came back with content. While another app
 * has the clipboard open, Electron hands back the standard formats with
 * nothing in them (on Windows, one empty text), which says nothing about
 * what is there. Raw formats can be empty for real: Windows leaves empty
 * ones behind when it clears the clipboard.
 */
export const readableClipboard = (
  items: readonly ClipboardContents[]
): boolean =>
  !items.some((item) => {
    const standard = Object.entries(item).filter(([type]) =>
      STANDARD.has(type)
    );

    return standard.length > 0 && standard.every(([, value]) => isEmpty(value));
  });

/**
 * Retry only while every format still has the capture's bytes, including
 * pictures and raw formats. `before` is the capture's read: a raw format it
 * got empty is skipped, since a read cut short by another app's hold gets
 * the first formats and none of the rest. A format empty only in `after`,
 * and any standard format, is compared whole: a newer copy can differ there.
 */
export const sameClipboard = async (
  before: readonly ClipboardContents[],
  after: readonly ClipboardContents[]
): Promise<boolean> => {
  if (before.length !== after.length) {
    return false;
  }

  const unread = new Set(
    before.flatMap((item) =>
      Object.entries(item)
        .filter(([type, value]) => !STANDARD.has(type) && isEmpty(value))
        .map(([type]) => type)
    )
  );

  const read = (items: readonly ClipboardContents[]) =>
    items.map((item) =>
      Object.fromEntries(
        Object.entries(item).filter(([type]) => !unread.has(type))
      )
    );

  return isDeepStrictEqual(
    await snapshotData(read(before)),
    await snapshotData(read(after))
  );
};

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

const textIn = async (
  read: readonly ClipboardContents[],
  type: string
): Promise<string> => {
  const value = read.find((item) => type in item)?.[type];

  return value instanceof Blob ? await value.text() : "";
};

/** The plain text and HTML in a read of the clipboard, "" for either it hasn't. */
export const clipboardContent = async (
  read: readonly ClipboardContents[]
): Promise<{ readonly html: string; readonly text: string }> => ({
  html: await textIn(read, "text/html"),
  text: await textIn(read, "text/plain"),
});

/** holdsAgain, judged from one read of the clipboard rather than reading it again. */
export const holdsAgainIn = async (
  saved: readonly ClipboardContents[],
  current: readonly ClipboardContents[]
): Promise<boolean> =>
  await holdsAgain(
    saved,
    current.flatMap((item) => Object.keys(item)),
    await textIn(current, "text/plain")
  );

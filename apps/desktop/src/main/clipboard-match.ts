import { isDeepStrictEqual } from "node:util";

import { copiedFilePaths } from "./copied-files";
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

/** How Electron names a raw format, one the platform lists beside the standard ones. */
const RAW = "electron application/osclipboard;";

/** Where Windows notes a copy or a cut of files, beside their list: a 32-bit set of flags, with 2 to move. */
const DROP_EFFECT = `${RAW}format="Preferred DropEffect"`;

/** The move flag is the second bit of the lowest byte: set when that byte, read as a number, is 2, 3, 6, 7 and so on. */
const isMove = (low: number): boolean => Math.floor(low / 2) % 2 === 1;

/**
 * Whether the files in a read were cut (true), copied (false), or the read
 * can't say (null). An app has to set an effect to cut, so files listed with
 * none are a copy, once the read's raw formats were listed (`rawListed`). An
 * effect listed but read back empty was cut short by another app's hold, and
 * is not known.
 */
const filesCut = async (
  read: readonly ClipboardContents[],
  rawListed = true
): Promise<boolean | null> => {
  const effect = read.find((item) => DROP_EFFECT in item)?.[DROP_EFFECT];

  if (effect === undefined) {
    return rawListed ? false : null;
  }

  if (!(effect instanceof Blob)) {
    return false;
  }

  const [low] = new Uint8Array(await effect.arrayBuffer());

  return low === undefined ? null : isMove(low);
};

/** The paths of the copied files in one read of the clipboard, as the live clipboard lists them. */
const filesIn = async (
  read: readonly ClipboardContents[]
): Promise<readonly string[]> =>
  await copiedFilePaths(
    read.map((item) => ({
      getType: async (type: string) => {
        const value = await item[type];

        return value instanceof Blob ? value : new Blob([]);
      },
      types: Object.keys(item),
    }))
  );

/**
 * What one read of the clipboard holds: its plain text and HTML ("" for either
 * it hasn't), the files it lists, and whether they were cut, null when the
 * read can't say. Judging a read by itself matters: a read made again could
 * fall under another app's hold, and come back empty. On Windows, Electron
 * lists the raw formats in a second look that a hold leaves empty, and
 * Explorer always lists some beside files: files with no raw format beside
 * them may have hidden a cut.
 */
export const clipboardContent = async (
  read: readonly ClipboardContents[],
  windows = process.platform === "win32"
): Promise<{
  readonly cut: boolean | null;
  readonly files: readonly string[];
  readonly html: string;
  readonly text: string;
}> => {
  const files = await filesIn(read);

  return {
    cut: await filesCut(
      read,
      !windows ||
        read.some((item) => Object.keys(item).some((type) => type.startsWith(RAW)))
    ),
    files,
    html: await textIn(read, "text/html"),
    text: await textIn(read, "text/plain"),
  };
};

/** Every file list on the clipboard (a URI list per item that has one), as one text. */
const fileListsIn = async (
  read: readonly ClipboardContents[]
): Promise<string> => {
  const lists = await Promise.all(
    read.map(async (item) =>
      "text/uri-list" in item ? await textIn([item], "text/uri-list") : ""
    )
  );

  return lists.map(plain).join("\n");
};

/**
 * holdsAgain, judged from one read of the clipboard rather than reading it
 * again. Files are part of what a clipboard holds, so they must be the same
 * files, cut or copied alike, and none beside text that had none: another
 * list of files isn't the clipboard put back.
 */
export const holdsAgainIn = async (
  saved: readonly ClipboardContents[],
  current: readonly ClipboardContents[]
): Promise<boolean> => {
  if ((await fileListsIn(saved)) !== (await fileListsIn(current))) {
    return false;
  }

  if ((await filesCut(saved)) !== (await filesCut(current))) {
    return false;
  }

  return await holdsAgain(
    saved,
    current.flatMap((item) => Object.keys(item)),
    await textIn(current, "text/plain")
  );
};

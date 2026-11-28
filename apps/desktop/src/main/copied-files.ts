import { fileURLToPath } from "node:url";

import type { ClipboardEntry } from "./copy-source";

/** How a copied file sits on the clipboard: the macOS pasteboard's file URL, or a URI list elsewhere. */
export const COPIED_FILE_TYPES = [
  'electron application/osclipboard;format="public.file-url"',
  "text/uri-list",
] as const;

const pathOf = (line: string): string | null => {
  const url = line.trim();

  if (!url.startsWith("file:")) {
    return null;
  }

  try {
    return fileURLToPath(url);
  } catch {
    return null;
  }
};

/** A format's words; a bookmark is never a file. */
const textOf = async (item: ClipboardEntry, type: string): Promise<string> => {
  const value = await item.getType(type);

  return value instanceof Blob ? await value.text() : "";
};

/** One item's file URLs: a URI list holds every file Explorer copied, a pasteboard item holds one of Finder's. */
const urlsOf = async (item: ClipboardEntry): Promise<readonly string[]> => {
  if (item.types.includes("text/uri-list")) {
    const list = await textOf(item, "text/uri-list");

    return list.split(/\r?\n/u).filter((line) => !line.startsWith("#"));
  }

  const [fileUrl] = COPIED_FILE_TYPES;

  return item.types.includes(fileUrl) ? [await textOf(item, fileUrl)] : [];
};

/** The paths of the files on the clipboard, as copied in Explorer or Finder, in order; empty for a copy of anything else. */
export const copiedFilePaths = async (
  items: readonly ClipboardEntry[]
): Promise<readonly string[]> => {
  const perItem = await Promise.all(items.map(urlsOf));
  const urls = perItem.flat();
  const paths = urls.flatMap((url) => pathOf(url) ?? []);

  return [...new Set(paths)];
};

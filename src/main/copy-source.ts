import type { ClipboardBookmark } from "electron";

/** What clipboard.read() returns, as far as finding the page is concerned. */
export interface ClipboardEntry {
  readonly types: readonly string[];
  readonly getType: (type: string) => Promise<Blob | ClipboardBookmark>;
}

/**
 * Where Windows browsers note the page a copy came from, beside the text:
 * Chromium (Chrome, Edge, Brave and apps built on it) in UTF-8, Firefox in
 * UTF-16. Both end the address with a NUL.
 */
const SOURCE_FORMATS = [
  {
    encoding: "utf-8",
    type: 'electron application/osclipboard;format="Chromium internal source URL"',
  },
  {
    encoding: "utf-16le",
    type: 'electron application/osclipboard;format="text/x-moz-url-priv"',
  },
] as const;

export const decodeSource = (
  bytes: Uint8Array,
  encoding: "utf-8" | "utf-16le"
): string =>
  new TextDecoder(encoding).decode(bytes).replaceAll("\0", "").trim();

/** The address of the page the clipboard's text was copied from, or "" when no browser noted one. */
export const copySource = async (
  entries: readonly ClipboardEntry[]
): Promise<string> => {
  const [found] = SOURCE_FORMATS.flatMap(({ encoding, type }) => {
    const entry = entries.find((candidate) => candidate.types.includes(type));

    return entry === undefined ? [] : [{ encoding, entry, type }];
  });

  if (found === undefined) {
    return "";
  }

  const blob = await found.entry.getType(found.type);

  return blob instanceof Blob
    ? decodeSource(new Uint8Array(await blob.arrayBuffer()), found.encoding)
    : "";
};

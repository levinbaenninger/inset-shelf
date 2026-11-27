import type { ImageItem } from "@shared/shelf";

const NAME_MAX = 60;
const FIRST_PRINTABLE = 0x20;

/** Characters a file name can't hold on macOS or Windows, besides control characters. */
const UNSAFE_FILE_CHARS = /[\\/:*?"<>|]/gu;
const TRAILING_DOTS_AND_SPACES = /[.\s]+$/u;
const WHITESPACE_RUN = /\s+/gu;

/** `text` without control characters, and with each character a file name can't hold replaced. */
const fileSafe = (text: string): string =>
  Array.from(text, (char) =>
    (char.codePointAt(0) ?? 0) < FIRST_PRINTABLE ? "" : char
  )
    .join("")
    .replaceAll(UNSAFE_FILE_CHARS, "-");

const pngNamed = (base: string): string =>
  `${base === "" ? "Screen area" : base}.png`;

/** Names an exported image after the first line of its note. */
export const exportFileName = (note: string): string => {
  const line =
    note
      .split("\n")
      .map((text) => text.replaceAll(WHITESPACE_RUN, " ").trim())
      .find((text) => text.length > 0) ?? "";

  return pngNamed(
    fileSafe(line).slice(0, NAME_MAX).replace(TRAILING_DOTS_AND_SPACES, "")
  );
};

/**
 * A picture's own name as the file it drags out as: as it is, spaces, dots
 * and length too, but for what no file name can hold. A space or dot at its
 * end stays, since ".png" comes after it.
 */
export const ownFileName = (name: string): string => pngNamed(fileSafe(name));

/** The file an image item drags out as: the name of the file it was added from, else named after its note. */
export const imageFileName = (item: ImageItem): string =>
  item.fileName === undefined
    ? exportFileName(item.note)
    : ownFileName(item.fileName);

const NAME_MAX = 60;
const FIRST_PRINTABLE = 0x20;

/** Characters a file name can't hold on macOS or Windows, besides control characters. */
const UNSAFE_FILE_CHARS = /[\\/:*?"<>|]/gu;
const TRAILING_DOTS_AND_SPACES = /[.\s]+$/u;
const WHITESPACE_RUN = /\s+/gu;

/** Names an exported image after the first line of its note. */
export const exportFileName = (note: string): string => {
  const line =
    note
      .split("\n")
      .map((text) => text.replaceAll(WHITESPACE_RUN, " ").trim())
      .find((text) => text.length > 0) ?? "";

  const base = Array.from(line, (char) =>
    (char.codePointAt(0) ?? 0) < FIRST_PRINTABLE ? "" : char
  )
    .join("")
    .replaceAll(UNSAFE_FILE_CHARS, "-")
    .slice(0, NAME_MAX)
    .replace(TRAILING_DOTS_AND_SPACES, "");

  return `${base === "" ? "Screen area" : base}.png`;
};

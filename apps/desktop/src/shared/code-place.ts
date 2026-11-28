import { z } from "zod";

/** The longest path the shelf keeps. A longer one is dropped whole, never cut. */
export const PATH_MAX = 4096;

/** The folder `root` is, or holds, `file`: a whole path segment, never a name that only starts the same. */
const isAncestor = (root: string, file: string): boolean =>
  file.startsWith(root.endsWith("/") ? root : `${root}/`);

/** Half of a character pair on its own: read by code point, only an unpaired one is a surrogate. */
const HALF_A_PAIR = /\p{Surrogate}/u;

/**
 * A whole path from the root, with no step back or in place: where it leads
 * is what it says. It is well-formed text with no NUL, so it can be written
 * into an address and handed to the disk.
 */
const isWholePath = (value: string): boolean =>
  value.startsWith("/") &&
  !HALF_A_PAIR.test(value) &&
  !value.includes("\0") &&
  !value.split("/").some((step) => step === "." || step === "..");

const WholePathSchema = z.string().min(1).max(PATH_MAX).refine(isWholePath);

/** The two sums a text's mark holds: each a prime under 2^32, with a step that keeps every product a whole number. */
const SUMS = [
  { step: 1_000_003, wrap: 4_294_967_291 },
  { step: 1_299_709, wrap: 4_294_967_279 },
] as const;

/** How a mark reads: a text's length and its two sums, in letters and digits. */
const MARK = /^[0-9a-z]{1,7}(?:\.[0-9a-z]{1,7}){2}$/u;

/**
 * A text's mark: its length and two sums over its characters. The same text
 * always gives the same mark, another text all but never does, and the mark
 * says nothing of the text. It only tells whether an item still holds the
 * words it was captured with.
 */
export const textMark = (text: string): string => {
  const sums = SUMS.map(() => 0);

  for (const character of text) {
    const point = character.codePointAt(0) ?? 0;

    for (const [index, { step, wrap }] of SUMS.entries()) {
      sums[index] = ((sums[index] ?? 0) * step + point + 1) % wrap;
    }
  }

  return [text.length, ...sums].map((part) => part.toString(36)).join(".");
};

/** Where in the code an item came from, read from the system, never from a page. */
export const CodePlaceSchema = z
  .object({
    /** The file the editor's window showed, absolute. */
    file: WholePathSchema,
    /** The project folder: the ancestor of `file` that the window's title names. Null when it names none. */
    root: WholePathSchema.nullable(),
    /** The 1-based line the captured text began on. Never stored: always null. The line is looked for when the item is opened (src/main/code-line.ts). */
    line: z.number().int().min(1).max(9_999_999).nullable(),
    /**
     * The mark (`textMark`) of the item's text as it was captured, set in the
     * step that adds the item. Absent on a place not yet in an item, and on an
     * item from before the mark. One that reads odd is left out alone.
     */
    mark: z.string().regex(MARK).optional().catch(undefined),
  })
  .refine(({ file, root }) => root === null || isAncestor(root, file), {
    message: "The project folder does not hold the file.",
    path: ["root"],
  });

export type CodePlace = z.output<typeof CodePlaceSchema>;

/** The file's name, the last part of its path. */
export const fileName = (place: CodePlace): string =>
  place.file.slice(place.file.lastIndexOf("/") + 1);

/** The file's path inside its project, or its name without one: never the whole path, which can name the user. */
export const pathInProject = (place: CodePlace): string =>
  place.root === null
    ? fileName(place)
    : place.file.slice(place.root.replace(/\/$/u, "").length + 1);

/** `text` with the place's line after a colon, when one is stored. */
export const atLine = (text: string, place: CodePlace): string =>
  place.line === null ? text : `${text}:${place.line}`;

/** `path` from the home folder as "~/…" when home holds it; null when it does not. */
export const fromHome = (path: string, home: string): string | null => {
  const folder = home.replace(/\/$/u, "");

  return folder !== "" && isAncestor(folder, path)
    ? `~${path.slice(folder.length)}`
    : null;
};

/** What the shelf says when a code item's file has moved or been deleted since it was captured. */
export const goneMessage = (place: CodePlace): string =>
  `${fileName(place)} is no longer at this path`;

/**
 * What the shelf says when a code item's editor was to open its file and
 * could not: what Inset tries next. Said before the file is shown in its
 * folder, which can't report that it failed, so never as done.
 */
export const fellBackMessage = (place: CodePlace, app: string): string =>
  `Couldn’t open ${fileName(place)} in ${app}, so Inset tries to show it in its folder`;

/**
 * Whether `text` is the text a code place was captured with: only then may
 * it be looked for in the file. Without a mark, it is not known to be.
 */
export const isCapturedText = (place: CodePlace, text: string): boolean =>
  place.mark !== undefined && place.mark === textMark(text);

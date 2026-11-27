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

/** Where in the code an item came from, read from the system, never from a page. */
export const CodePlaceSchema = z
  .object({
    /** The file the editor's window showed, absolute. */
    file: WholePathSchema,
    /** The project folder: the ancestor of `file` that the window's title names. Null when it names none. */
    root: WholePathSchema.nullable(),
    /** The 1-based line the captured text began on. Not read yet: always null. */
    line: z.number().int().min(1).max(9_999_999).nullable(),
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

import { z } from "zod";

/** The longest path the shelf keeps. A longer one is dropped whole, never cut. */
export const PATH_MAX = 4096;

/** The folder `root` is, or holds, `file`: a whole path segment, never a name that only starts the same. */
const isAncestor = (root: string, file: string): boolean =>
  file.startsWith(root.endsWith("/") ? root : `${root}/`);

/** A whole path from the root, with no step back or in place: where it leads is what it says. */
const isWholePath = (value: string): boolean =>
  value.startsWith("/") &&
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

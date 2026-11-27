import { lineOfText } from "@shared/code-editors";
import { TEXT_MAX } from "@shared/shelf";

import type { QuietDisk } from "./quiet-disk";

/** The largest source file read to find a line. */
export const SOURCE_READ_MAX = 2 * 1024 * 1024;

/**
 * The 1-based line `captured` begins on in the file as it is saved now, when
 * it is there exactly once; else null. The file is read through the quiet
 * disk (src/main/quiet-disk.ts), only when it holds 2 MB or less, and the text
 * looked for is no longer than the shelf keeps. Nothing from the file is kept
 * or logged: only the line leaves this function.
 */
export const lineInFile = async (
  file: string,
  captured: string,
  disk: Pick<QuietDisk, "read">
): Promise<number | null> => {
  if (captured.length > TEXT_MAX) {
    return null;
  }

  const bytes = await disk.read(file, SOURCE_READ_MAX);

  return bytes === null
    ? null
    : lineOfText(new TextDecoder().decode(bytes), captured);
};

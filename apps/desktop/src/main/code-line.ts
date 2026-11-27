import { lineOfText, quietlyReadable } from "@shared/code-editors";
import type { CodePlace } from "@shared/code-place";

/** How main reads a source file on this computer; main passes Node's, tests a disk of their own. */
export interface SourceReader {
  readonly home: string;
  /** `process.platform`. */
  readonly platform: string;
  readonly stat: (
    file: string
  ) => Promise<{ readonly size: number; readonly isFile: () => boolean }>;
  /** The file's words, as UTF-8. */
  readonly readFile: (file: string) => Promise<string>;
}

/** The largest source file read to find a line. */
export const SOURCE_READ_MAX = 2 * 1024 * 1024;

/**
 * The 1-based line `captured` begins on in the file as it is saved now, when
 * it is there exactly once; else null. Only a file that can be read without a
 * system prompt, and of 2 MB or less, is read. Nothing from it is kept or
 * logged: only the line leaves this function.
 */
export const lineInFile = async (
  file: string,
  captured: string,
  reader: SourceReader
): Promise<number | null> => {
  if (!quietlyReadable(file, reader.home, reader.platform)) {
    return null;
  }

  try {
    const found = await reader.stat(file);

    if (!found.isFile() || found.size > SOURCE_READ_MAX) {
      return null;
    }

    return lineOfText(await reader.readFile(file), captured);
  } catch {
    return null;
  }
};

/**
 * The line to open a code item's file at: where its words are in the file
 * now, so a line that moved is still found, else the line stored at capture.
 */
export const lineToOpen = async (
  place: CodePlace,
  text: string | null,
  reader: SourceReader
): Promise<number | null> =>
  (text === null ? null : await lineInFile(place.file, text, reader)) ??
  place.line;

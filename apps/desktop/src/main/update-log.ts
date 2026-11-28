import { appendFileSync, renameSync, statSync } from "node:fs";

export const MAX_LOG_BYTES = 1024 * 1024;

/** Appends a line, first moving a log past the cap to `<file>.old`, so it keeps about two caps at most. */
export const appendCappedLog = (
  file: string,
  line: string,
  maxBytes = MAX_LOG_BYTES
): void => {
  try {
    if (statSync(file).size >= maxBytes) {
      renameSync(file, `${file}.old`);
    }
  } catch {
    // No log yet.
  }

  appendFileSync(file, line);
};

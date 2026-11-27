import { realpathSync } from "node:fs";
import path from "node:path";

/**
 * Where a file is on disk, through any link on its way: macOS names a
 * temporary file under /var or under /private/var, and a link elsewhere can
 * name any folder. A file already gone keeps the path as spelled.
 */
export const onDisk = (file: string): string => {
  try {
    return realpathSync.native(file);
  } catch {
    return path.resolve(file);
  }
};

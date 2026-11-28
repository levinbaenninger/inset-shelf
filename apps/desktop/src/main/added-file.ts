import path from "node:path";

/** Pictures become image items, shown in the shelf; anything else is kept as a file. */
const IMAGE_EXTENSIONS = new Set([
  "bmp",
  "gif",
  "heic",
  "jpeg",
  "jpg",
  "png",
  "tif",
  "tiff",
  "webp",
]);

const SAFE_EXTENSION = /^[a-z0-9]{1,8}$/u;

/** Files over this size are refused rather than copied into the shelf. */
export const ADDED_FILE_MAX_BYTES = 200 * 1024 * 1024;

export interface AddedFile {
  readonly kind: "image" | "file";
  /** Lower-case, safe for a stored name; "bin" when the name has none. */
  readonly extension: string;
  readonly name: string;
}

export const classifyAddedFile = (filePath: string): AddedFile => {
  const name = path.basename(filePath);
  const raw = path.extname(name).slice(1).toLowerCase();
  const extension = SAFE_EXTENSION.test(raw) ? raw : "bin";

  return {
    extension,
    kind: IMAGE_EXTENSIONS.has(extension) ? "image" : "file",
    name: name === "" ? "File" : name.slice(0, 255),
  };
};

/** How adding went: what came of it, and why each file that couldn't be added wasn't. */
export interface AddedNotice {
  readonly headline: string;
  readonly reasons: readonly string[];
  readonly tone: "done" | "failed";
}

/** The notice's words as the toast says them: what came of it, then each reason. */
export const noticeText = (notice: AddedNotice): string =>
  [notice.headline, ...notice.reasons].join(" ");

/** What the notice says once files or pictures dropped or pasted on the shelf were added as items: done only when every one was. */
export const addedNotice = (
  added: number,
  tried: number,
  problems: readonly string[],
  noun: "file" | "picture"
): AddedNotice => {
  if (added === tried && problems.length === 0) {
    return {
      headline: added === 1 ? `Added 1 ${noun}` : `Added ${added} ${noun}s`,
      reasons: [],
      tone: "done",
    };
  }

  return {
    headline:
      added === 0 ? "Nothing was added." : `Added ${added} of ${tried}.`,
    reasons: problems,
    tone: "failed",
  };
};

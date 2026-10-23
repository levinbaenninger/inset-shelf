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

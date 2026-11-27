import {
  copyFileSync,
  mkdirSync,
  realpathSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import type { Picture } from "@shared/shelf";
import { nativeImage } from "electron";
import type { NativeImage } from "electron";

import { onDisk } from "./on-disk";
import { drawPinMarks } from "./pin-mark";
import { FsErrorSchema } from "./save-error";

export interface ExportedImage {
  readonly image: NativeImage;
  readonly png: Buffer;
}

/** The picture, scaled down to `longSideMax` pixels on its long side when it is larger. */
const fitted = (image: NativeImage, longSideMax: number): ExportedImage => {
  const { height, width } = image.getSize();

  if (Math.max(width, height) <= longSideMax) {
    return { image, png: image.toPNG() };
  }

  const smaller = image.resize(
    width >= height
      ? { quality: "best", width: longSideMax }
      : { height: longSideMax, quality: "best" }
  );

  return { image: smaller, png: smaller.toPNG() };
};

/** The saved PNG, with its numbered pins drawn on it. */
export const exportImage = (
  picture: Picture,
  file: string,
  longSideMax = Number.POSITIVE_INFINITY
): ExportedImage | null => {
  const saved = nativeImage.createFromPath(file);

  if (saved.isEmpty()) {
    return null;
  }

  if (picture.pins.length === 0) {
    return fitted(saved, longSideMax);
  }

  const { height, width } = saved.getSize();

  const marked = nativeImage.createFromBitmap(
    Buffer.from(
      drawPinMarks(
        { data: saved.toBitmap(), height, width },
        picture.pins,
        picture.image.pixelsPerDip
      )
    ),
    { height, width }
  );

  return fitted(marked, longSideMax);
};

/** Dragged copies wait here for the drop, which can finish after startDrag returns. */
export const createDragStaging = (tempDir: string) => {
  const root = path.join(tempDir, "Inset Shelf");
  // The same folder as the disk names it: macOS hands the app /var, a link to /private/var, and a drop can name either.
  const roots = [root, path.join(realpathSync.native(tempDir), "Inset Shelf")];

  return {
    /** True for a file this staging wrote, however the drop spells its path, through any link, so a drag back onto the shelf is not added twice. */
    contains: (file: string): boolean => {
      const where = onDisk(file);

      return roots.some((each) => where.startsWith(`${each}${path.sep}`));
    },
    clear: (id?: string): void => {
      rmSync(id === undefined ? root : path.join(root, id), {
        force: true,
        recursive: true,
      });
    },
    copy: (id: string, name: string, from: string): string => {
      const folder = path.join(root, id);
      const file = path.join(folder, name);

      mkdirSync(folder, { recursive: true });
      copyFileSync(from, file);

      return file;
    },
    write: (id: string, name: string, png: Uint8Array): string => {
      const folder = path.join(root, id);
      const file = path.join(folder, name);

      mkdirSync(folder, { recursive: true });
      writeFileSync(file, png);

      return file;
    },
  };
};

/**
 * The screenshot card's drags stage their copies here, apart from the
 * shelf's own, which are swept as a whole: an app a copy went to can save
 * the user's edit into it, or a file of theirs beside it, and those stay.
 */
export const createShotStaging = (tempDir: string) => {
  const root = path.join(tempDir, "Inset Shelf Screenshots");

  return {
    /** Writes `png` as `name` into the drag's own folder, and returns the file. */
    write: (folder: string, name: string, png: Uint8Array): string => {
      const file = path.join(root, folder, name);

      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, png);

      return file;
    },
    /** Removes a copy, and its folder once nothing else is in it. */
    remove: (file: string): void => {
      rmSync(file, { force: true });

      try {
        rmdirSync(path.dirname(file));
      } catch (error) {
        // A file the user saved beside the copy keeps the folder.
        if (FsErrorSchema.safeParse(error).data?.code !== "ENOTEMPTY") {
          throw error;
        }
      }
    },
  };
};

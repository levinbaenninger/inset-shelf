import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { ImageItem } from "@shared/shelf";
import { nativeImage } from "electron";
import type { NativeImage } from "electron";

import { containedPath } from "./contained-path";
import { drawPinMarks } from "./pin-mark";

export interface ExportedImage {
  readonly image: NativeImage;
  readonly png: Buffer;
}

/** The saved PNG, with its numbered pins drawn on it. */
export const exportImage = (
  item: ImageItem,
  file: string
): ExportedImage | null => {
  const saved = nativeImage.createFromPath(file);

  if (saved.isEmpty()) {
    return null;
  }

  if (item.pins.length === 0) {
    return { image: saved, png: saved.toPNG() };
  }

  const { height, width } = saved.getSize();

  const marked = nativeImage.createFromBitmap(
    Buffer.from(
      drawPinMarks(
        { data: saved.toBitmap(), height, width },
        item.pins,
        item.image.pixelsPerDip
      )
    ),
    { height, width }
  );

  return { image: marked, png: marked.toPNG() };
};

/** Dragged copies wait here for the drop, which can finish after startDrag returns. */
export const createDragStaging = (tempDir: string) => {
  const root = path.join(tempDir, "Inset Shelf");

  /** The folder for an item and the file in it; both must stay inside the staging folder. */
  const target = (id: string, name: string) => {
    const folder = containedPath(root, id);
    const file = folder === null ? null : containedPath(folder, name);

    if (folder === null || file === null) {
      throw new Error("A dragged file's name leaves the staging folder.");
    }

    return { file, folder };
  };

  return {
    /** True for a file this staging wrote, so a drag back onto the shelf is not added twice. */
    contains: (file: string): boolean =>
      path.resolve(file).startsWith(`${root}${path.sep}`),
    clear: (id?: string): void => {
      const folder = id === undefined ? root : containedPath(root, id);

      if (folder !== null) {
        rmSync(folder, { force: true, recursive: true });
      }
    },
    copy: (id: string, name: string, from: string): string => {
      const { file, folder } = target(id, name);

      mkdirSync(folder, { recursive: true });
      copyFileSync(from, file);

      return file;
    },
    write: (id: string, name: string, png: Uint8Array): string => {
      const { file, folder } = target(id, name);

      mkdirSync(folder, { recursive: true });
      writeFileSync(file, png);

      return file;
    },
  };
};

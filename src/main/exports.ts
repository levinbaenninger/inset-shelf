import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { ImageItem } from "@shared/shelf";
import { nativeImage } from "electron";
import type { NativeImage } from "electron";

import { drawPinMark } from "./pin-mark";

export interface ExportedImage {
  readonly image: NativeImage;
  readonly png: Buffer;
}

/** The saved PNG, with the pin drawn on it when the item has one. */
export const exportImage = (
  item: ImageItem,
  file: string
): ExportedImage | null => {
  const saved = nativeImage.createFromPath(file);

  if (saved.isEmpty()) {
    return null;
  }

  if (item.pin === null) {
    return { image: saved, png: saved.toPNG() };
  }

  const { height, width } = saved.getSize();

  const marked = nativeImage.createFromBitmap(
    Buffer.from(
      drawPinMark(
        { data: saved.toBitmap(), height, width },
        item.pin,
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

  return {
    clear: (id?: string): void => {
      rmSync(id === undefined ? root : path.join(root, id), {
        force: true,
        recursive: true,
      });
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

import { pathToFileURL } from "node:url";

import type { ActionResult } from "@shared/contracts";
import {
  itemDetailsText,
  itemsAsList,
  itemTextWithLink,
  listHtmlWithImage,
} from "@shared/shelf";
import type { FileItem, ImageItem, ItemId, ShelfItem } from "@shared/shelf";

import type { ClipboardData, CopyGate, Payload } from "./copy-gate";

/** The macOS pasteboard type for a file, which Electron reaches through its raw formats. */
const MAC_FILE_URL =
  'electron application/osclipboard;format="public.file-url"';

/** An image item's PNG with its pins drawn in. */
export interface ExportedPng {
  readonly png: Buffer;
  readonly widthPx: number;
}

export interface CopyCommandDeps {
  readonly gate: CopyGate;
  /** The item as the shelf holds it, read after the save. */
  readonly item: (id: ItemId) => ShelfItem | undefined;
  readonly exportImage: (item: ImageItem) => ExportedPng | null;
  /** A copy of the file under its own name, to put on the clipboard; null when it can't be read. */
  readonly stageFile: (item: FileItem) => string | null;
  readonly mac: boolean;
  /** Items copied with Copy or Copy as List; the setting may check them off. */
  readonly onCopied: (
    items: readonly ShelfItem[],
    kind: "item" | "list"
  ) => void;
}

/** Every copy the app offers. Each one goes through the gate. */
export interface CopyCommands {
  /** ⌘C, Edit › Copy, Copy in the menus, and Copy and Save in the drawing window. */
  readonly copy: (id: ItemId) => Promise<ActionResult>;
  /** ⌥⌘C, Copy with Details. */
  readonly copyDetails: (id: ItemId) => Promise<ActionResult>;
  readonly copyWithLink: (id: ItemId) => Promise<ActionResult>;
  /** ⇧⌘C, Copy as List, and ⌘C with several items picked. */
  readonly copyList: (ids: readonly ItemId[]) => Promise<ActionResult>;
  /** The screenshot card's Copy. */
  readonly copyScreenshot: (png: Uint8Array) => Promise<ActionResult>;
}

const text = (value: string): Blob => new Blob([value], { type: "text/plain" });

const GONE: Payload = { problem: "This item no longer exists." };

export const createCopyCommands = (deps: CopyCommandDeps): CopyCommands => {
  const fileData = (item: FileItem): Payload => {
    const file = deps.stageFile(item);

    if (file === null) {
      return { problem: "The file can't be read." };
    }

    const url = pathToFileURL(file).href;

    // A named copy goes on the clipboard as a file, so it pastes into Finder, Explorer or Mail as itself.
    return {
      data: {
        // On Windows a URI list becomes a file drop list (CF_HDROP).
        ...(deps.mac
          ? { [MAC_FILE_URL]: new Blob([url]) }
          : { "text/uri-list": new Blob([url], { type: "text/uri-list" }) }),
        "text/plain": text(item.file.name),
      },
    };
  };

  const itemData = (item: ShelfItem): Payload => {
    if (item.kind === "text") {
      // The copied HTML goes back next to the text, so links and formatting paste too.
      return {
        data:
          item.html === null
            ? { "text/plain": text(item.text) }
            : {
                "text/html": new Blob([item.html], { type: "text/html" }),
                "text/plain": text(item.text),
              },
      };
    }

    if (item.kind === "file") {
      return fileData(item);
    }

    const exported = deps.exportImage(item);

    if (exported === null) {
      return { problem: "The image can't be read." };
    }

    const image = new Blob([exported.png], { type: "image/png" });

    // The note travels as text next to the image, so a chat box can take both.
    return {
      data:
        item.note.trim() === ""
          ? { "image/png": image }
          : { "image/png": image, "text/plain": text(item.note) },
    };
  };

  /**
   * Items as one numbered list, with the first image (pins drawn in) in its
   * HTML, so apps that paste formatting show the picture with the words and
   * the rest keep the words. Without any words, the image alone.
   */
  const listData = (items: readonly ShelfItem[]): Payload => {
    const list = itemsAsList(items);
    const firstImage = items.find((item) => item.kind === "image");

    const exported =
      firstImage === undefined ? null : deps.exportImage(firstImage);

    if (list.count === 0) {
      return exported === null
        ? { problem: "There is nothing to copy." }
        : {
            data: {
              "image/png": new Blob([exported.png], { type: "image/png" }),
            },
          };
    }

    const html =
      exported === null || firstImage === undefined
        ? list.html
        : listHtmlWithImage(list.html, {
            alt: firstImage.note.trim() === "" ? "Image" : firstImage.note,
            base64: exported.png.toString("base64"),
            width: exported.widthPx / firstImage.image.pixelsPerDip,
          });

    const data: ClipboardData = {
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": text(list.text),
    };

    return { data };
  };

  const copyText = async (
    id: ItemId,
    format: (item: ShelfItem) => string
  ): Promise<ActionResult> =>
    await deps.gate.copy(() => {
      const item = deps.item(id);

      return item === undefined
        ? GONE
        : { data: { "text/plain": text(format(item)) } };
    });

  return {
    copy: async (id) => {
      let copied: ShelfItem | undefined;

      const result = await deps.gate.copy(() => {
        copied = deps.item(id);

        return copied === undefined ? GONE : itemData(copied);
      });

      if (result.ok && copied !== undefined) {
        deps.onCopied([copied], "item");
      }

      return result;
    },
    copyDetails: async (id) => await copyText(id, itemDetailsText),
    copyList: async (ids) => {
      let copied: readonly ShelfItem[] = [];

      const result = await deps.gate.copy(() => {
        copied = ids.flatMap((id) => {
          const item = deps.item(id);

          return item === undefined ? [] : [item];
        });

        return listData(copied);
      });

      if (result.ok) {
        deps.onCopied(copied, "list");
      }

      return result;
    },
    copyScreenshot: async (png) =>
      await deps.gate.copy(() => ({
        data: { "image/png": new Blob([png], { type: "image/png" }) },
      })),
    copyWithLink: async (id) => await copyText(id, itemTextWithLink),
  };
};

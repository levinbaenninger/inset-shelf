import type { AttachResult } from "@shared/contracts";
import { ATTACHMENTS_MAX } from "@shared/shelf";
import type { AttachmentId, ItemId, ShelfItem } from "@shared/shelf";
import { useEffect, useEffectEvent, useState } from "react";
import { toast } from "sonner";

import { filePath, shelfBridge } from "@/shared/bridge";

import { Excerpt, NOTICE_MS, UNDO_VISIBLE_MS } from "./toast-parts";
import { DROP_LOOK } from "./use-attach-drop";
import type { AttachTarget, RowDropLook } from "./use-attach-drop";

// Files dropped on the shelf or pasted into it: as new items, or attached to
// one item with Undo. Which row a drop goes to is use-attach-drop.ts's part.

const api = shelfBridge();

/** Files dropped or pasted in: by path when they have one, else as image bytes (an image copied from a page). Main's notice says how it went once they are on disk. */
const addDataFiles = async (files: readonly File[]): Promise<void> => {
  const paths = files.flatMap((file) => {
    const found = filePath(file);

    return found === "" ? [] : [found];
  });

  if (paths.length > 0) {
    api.addFiles(paths);

    return;
  }

  const images = files.filter((file) => file.type.startsWith("image/"));

  await Promise.all(
    images.map(async (file) => {
      api.pasteImage(new Uint8Array(await file.arrayBuffer()));
    })
  );
};

/** Files for one item, by path when they have one, else as image bytes, one after another; null when none can be attached. */
const attachDataFiles = async (
  id: ItemId,
  files: readonly File[]
): Promise<AttachResult | null> => {
  const paths = files.flatMap((file) => {
    const found = filePath(file);

    return found === "" ? [] : [found];
  });

  if (paths.length > 0) {
    return await api.addFilesTo({ id, paths });
  }

  const images = await Promise.all(
    files.flatMap((file) =>
      file.type.startsWith("image/")
        ? [file.arrayBuffer().then((buffer) => new Uint8Array(buffer))]
        : []
    )
  );

  if (images.length === 0) {
    return null;
  }

  const attached: AttachmentId[] = [];
  let message: string | null = null;

  for (const bytes of images) {
    // oxlint-disable-next-line no-await-in-loop -- in order, so what fits is what came first.
    const next = await api.pasteImageTo({ bytes, id });

    attached.push(...next.attached);
    message ??= next.message;
  }

  return { attached, message };
};

/** A drop on an item that holds all it can: refused, and said why while the files are over it. */
export const fullToast = (item: ShelfItem): void => {
  toast.error(
    `This item holds ${ATTACHMENTS_MAX} attachments, the most it can`,
    {
      description: <Excerpt item={item} />,
      duration: NOTICE_MS,
      id: "attach-full",
    }
  );
};

const isFull = (item: ShelfItem): boolean =>
  item.attachments.length >= ATTACHMENTS_MAX;

/**
 * The window's ring while files are over it, unless a row is their target:
 * the shelf's, for new items; with details open, the details item's, lit as
 * an open row is, or refusing them when it is full.
 */
export const dropRing = (
  over: boolean,
  target: AttachTarget,
  details: ShelfItem | undefined
): string | null => {
  if (!over || target !== null) {
    return null;
  }

  if (details === undefined) {
    return "ring-pin ring-2 ring-inset";
  }

  return DROP_LOOK[isFull(details) ? "full" : "open"];
};

/** How a row looks while files are over the shelf. */
export const dropLook = (target: AttachTarget, id: ItemId): RowDropLook => {
  if (target?.id !== id) {
    return "none";
  }

  return target.full ? "full" : "open";
};

/** Files pasted with details open: attached to that item; says why when some or all can't be. */
const attachPasted = async (
  id: ItemId,
  files: readonly File[]
): Promise<void> => {
  const result = await attachDataFiles(id, files);
  const message = result?.message ?? null;

  if (message !== null) {
    toast.error(message, { duration: NOTICE_MS });
  }
};

/** Files dropped on a row: attached, with Undo for a drop that landed on the wrong item. Undo takes off what this drop attached, and nothing else. */
export const attachDropped = async (
  item: ShelfItem,
  files: readonly File[]
): Promise<void> => {
  const result = await attachDataFiles(item.id, files);

  if (result === null) {
    return;
  }

  const { attached, message } = result;

  // Nothing landed: say why, unless nothing was meant to (the shelf's own files dropped back).
  if (attached.length === 0) {
    if (message !== null) {
      toast.error(message, { duration: NOTICE_MS });
    }

    return;
  }

  const options = {
    action: {
      label: "Undo",
      onClick: () => {
        for (const attachmentId of attached) {
          api.apply({
            attachmentId,
            id: item.id,
            type: "removeAttachment",
          });
        }
      },
    },
    description: <Excerpt item={item} />,
    duration: UNDO_VISIBLE_MS,
  };

  if (message === null) {
    toast(
      attached.length === 1
        ? "Attached 1 file"
        : `Attached ${attached.length} files`,
      options
    );
  } else {
    toast.error(message, options);
  }
};

const hasFiles = (event: DragEvent): boolean =>
  event.dataTransfer?.types.includes("Files") === true;

/**
 * Files can be dropped anywhere on the shelf, or pasted when the clipboard
 * holds files. With details open they attach to that item, as a drop on its
 * open row does; a full one refuses a drop and says why while the files are
 * over it. One of the shelf's own images or files dragged back in is not
 * added again (`ownDrag`).
 */
export const useFileDrops = (
  ownDrag: () => boolean,
  /** The item open in details: files dropped or pasted then attach to it. */
  detailsItem: () => ShelfItem | null
): boolean => {
  const [over, setOver] = useState(false);

  const onDragOver = useEffectEvent((event: DragEvent) => {
    if (!hasFiles(event) || ownDrag()) {
      return;
    }

    event.preventDefault();

    const item = detailsItem();

    if (item !== null && event.dataTransfer !== null) {
      event.dataTransfer.dropEffect = isFull(item) ? "none" : "copy";

      if (isFull(item) && !over) {
        fullToast(item);
      }
    }

    setOver(true);
  });

  const onDragLeave = useEffectEvent((event: DragEvent) => {
    if (event.relatedTarget === null) {
      setOver(false);
    }
  });

  const onDrop = useEffectEvent((event: DragEvent) => {
    setOver(false);

    // A row took it: the files attach to that item (use-attach-drop.ts).
    if (event.defaultPrevented) {
      return;
    }

    if (!hasFiles(event) || ownDrag()) {
      return;
    }

    event.preventDefault();

    const files = [...(event.dataTransfer?.files ?? [])];
    const item = detailsItem();

    if (item === null) {
      void addDataFiles(files);
    } else if (!isFull(item)) {
      void attachDropped(item, files);
    }
  });

  const onPaste = useEffectEvent((event: ClipboardEvent) => {
    const files = [...(event.clipboardData?.files ?? [])];

    if (files.length === 0) {
      return;
    }

    event.preventDefault();

    const target = detailsItem();

    void (target === null
      ? addDataFiles(files)
      : attachPasted(target.id, files));
  });

  useEffect(() => {
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("paste", onPaste);

    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("paste", onPaste);
    };
  }, []);

  return over;
};

/** Paste Image in details: the clipboard's picture, read by main, attached to the item; says why when there is none. */
export const pasteClipboardImage = async (id: ItemId): Promise<void> => {
  const { message } = await api.pasteImageTo({ bytes: null, id });

  if (message !== null) {
    toast.error(message, { duration: NOTICE_MS });
  }
};

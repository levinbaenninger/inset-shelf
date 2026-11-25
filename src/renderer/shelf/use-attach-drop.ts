import { ATTACHMENTS_MAX } from "@shared/shelf";
import type { ItemId, ShelfItem } from "@shared/shelf";
import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";

/** The row files are being dragged over; `full` when it holds all it can, so the drop is refused. */
export type AttachTarget = {
  readonly id: ItemId;
  readonly full: boolean;
} | null;

/** A row while files are over the shelf: their target, refusing them because it is full, or neither. */
export type RowDropLook = "open" | "full" | "none";

export interface RowDropProps {
  readonly onDragOver: (event: DragEvent) => void;
  readonly onDragLeave: (event: DragEvent) => void;
  readonly onDrop: (event: DragEvent) => void;
}

export interface AttachDrop {
  readonly target: AttachTarget;
  /** On an item's card: files from outside dropped on it attach to it. */
  readonly rowProps: (item: ShelfItem) => RowDropProps;
  /** One of an item's attachments leaves as a file: dropped back on the shelf, it adds nothing. */
  readonly startDragOut: () => void;
  readonly draggingOut: () => boolean;
}

/**
 * Files dropped on a row attach to that item; anywhere else on the shelf
 * they become new items (shelf-app.tsx). The row marks its drop as handled,
 * so the window's own drop leaves it alone. A full row refuses the drop
 * and `onFull` says why, while the files are over it.
 */
export const useAttachDrop = ({
  ownDrag,
  onDrop,
  onFull,
}: {
  /** One of the shelf's own items is being dragged out as a file. */
  readonly ownDrag: () => boolean;
  readonly onDrop: (item: ShelfItem, files: readonly File[]) => void;
  readonly onFull: (item: ShelfItem) => void;
}): AttachDrop => {
  const [target, setTarget] = useState<AttachTarget>(null);
  const out = useRef(false);

  // The system's drag has no end event here: the next ordinary pointer move means it is over.
  useEffect(() => {
    const settle = (event: PointerEvent): void => {
      if (event.buttons === 0) {
        out.current = false;
      }
    };

    window.addEventListener("pointermove", settle);

    return () => {
      window.removeEventListener("pointermove", settle);
    };
  }, []);

  const fromOutside = (event: DragEvent): boolean =>
    event.dataTransfer.types.includes("Files") && !ownDrag() && !out.current;

  return {
    draggingOut: () => out.current,
    rowProps: (item) => ({
      onDragLeave: (event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          setTarget((current) => (current?.id === item.id ? null : current));
        }
      },
      onDragOver: (event) => {
        if (!fromOutside(event)) {
          return;
        }

        event.preventDefault();

        const full = item.attachments.length >= ATTACHMENTS_MAX;

        event.dataTransfer.dropEffect = full ? "none" : "copy";

        if (target?.id !== item.id) {
          setTarget({ full, id: item.id });

          if (full) {
            onFull(item);
          }
        }
      },
      onDrop: (event) => {
        if (!fromOutside(event)) {
          return;
        }

        // Handled: the window's file drop sees it is, and adds no new item.
        event.preventDefault();
        setTarget(null);

        if (item.attachments.length < ATTACHMENTS_MAX) {
          onDrop(item, [...event.dataTransfer.files]);
        }
      },
    }),
    startDragOut: () => {
      out.current = true;
    },
    target,
  };
};

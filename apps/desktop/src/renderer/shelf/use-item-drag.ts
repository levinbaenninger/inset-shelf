import type { ItemId, SectionId } from "@shared/shelf";
import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";

/** Marks a drag of an item within the shelf, apart from files dragged in from elsewhere. */
const ITEM_TYPE = "application/x-inset-shelf-item";

export interface ItemDrag {
  /** The item being dragged, shown faded. */
  readonly draggingId: ItemId | null;
  /** The section the pointer is over, shown as a drop target. */
  readonly overSectionId: SectionId | null;
  /** On an item's card: it drags as itself, and as its words into other apps. */
  readonly itemProps: (
    id: ItemId,
    text: string
  ) => {
    readonly draggable: true;
    readonly onDragStart: (event: DragEvent) => void;
    readonly onDragEnd: () => void;
  };
  /** On a section: an item dropped on it moves to its end. */
  readonly sectionProps: (sectionId: SectionId) => {
    readonly onDragOver: (event: DragEvent) => void;
    readonly onDragLeave: (event: DragEvent) => void;
    readonly onDrop: (event: DragEvent) => void;
  };
  /**
   * An image or file leaves as a real file, dragged by the system. Dropped
   * back on a section, it moves there instead of being added again.
   */
  readonly startDragOut: (id: ItemId) => void;
  /** True while one of the shelf's own files is being dragged. */
  readonly draggingOut: () => boolean;
}

/**
 * `move` gets the dragged item's id as the drag carried it, to be checked
 * against the shelf. `canMove` tells whether a drop on a section would move
 * anything; a section the items are already in is no target.
 */
export const useItemDrag = ({
  canMove,
  move,
}: {
  readonly canMove: (id: string, sectionId: SectionId) => boolean;
  readonly move: (id: string, sectionId: SectionId) => void;
}): ItemDrag => {
  const [draggingId, setDraggingId] = useState<ItemId | null>(null);
  const [overSectionId, setOverSectionId] = useState<SectionId | null>(null);
  const outRef = useRef<ItemId | null>(null);

  // The system's drag has no end event here: the next ordinary pointer move means it is over.
  useEffect(() => {
    const settle = (event: PointerEvent): void => {
      if (event.buttons === 0) {
        outRef.current = null;
      }
    };

    window.addEventListener("pointermove", settle);

    return () => {
      window.removeEventListener("pointermove", settle);
    };
  }, []);

  const carried = (event: DragEvent): boolean =>
    event.dataTransfer.types.includes(ITEM_TYPE) ||
    (outRef.current !== null && event.dataTransfer.types.includes("Files"));

  const finish = (): void => {
    setDraggingId(null);
    setOverSectionId(null);
    outRef.current = null;
  };

  return {
    draggingId,
    draggingOut: () => outRef.current !== null,
    itemProps: (id, text) => ({
      draggable: true,
      onDragEnd: finish,
      onDragStart: (event) => {
        event.dataTransfer.setData(ITEM_TYPE, id);
        event.dataTransfer.setData("text/plain", text);
        event.dataTransfer.effectAllowed = "copyMove";
        setDraggingId(id);
      },
    }),
    overSectionId,
    sectionProps: (sectionId) => ({
      onDragLeave: (event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          setOverSectionId((current) =>
            current === sectionId ? null : current
          );
        }
      },
      onDragOver: (event) => {
        if (!carried(event)) {
          return;
        }

        event.preventDefault();

        const id = draggingId ?? outRef.current;

        if (id !== null && !canMove(id, sectionId)) {
          event.dataTransfer.dropEffect = "none";
          setOverSectionId(null);

          return;
        }

        event.dataTransfer.dropEffect = event.dataTransfer.types.includes(
          ITEM_TYPE
        )
          ? "move"
          : "copy";
        setOverSectionId(sectionId);
      },
      onDrop: (event) => {
        if (!carried(event)) {
          return;
        }

        // The shelf's own drop, not a file to add: the window's file drop must not see it.
        event.preventDefault();
        event.stopPropagation();

        const id = event.dataTransfer.getData(ITEM_TYPE) || outRef.current;

        if (id !== null && id !== "" && canMove(id, sectionId)) {
          move(id, sectionId);
        }

        finish();
      },
    }),
    startDragOut: (id) => {
      outRef.current = id;
    },
  };
};

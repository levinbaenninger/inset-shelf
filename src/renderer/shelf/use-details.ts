import type { DetailField } from "@shared/contracts";
import type { ItemId, ShelfDoc, ShelfItem, ShelfOp } from "@shared/shelf";
import { useRef, useState } from "react";
import type { RefObject } from "react";

import type { DetailsUndo, FieldRequest, StepsReset } from "./details-view";

/** Removals in details that ⌘Z can still put back. */
const UNDO_DEPTH = 20;

let lastSeq = 0;

/** A new number for each request, so asking for the same field twice still counts. */
const nextSeq = (): number => {
  lastSeq += 1;

  return lastSeq;
};

export interface Details {
  /** The item whose details are pushed over the list, if any. */
  readonly item: ShelfItem | undefined;
  readonly request: FieldRequest | null;
  readonly stepsReset: StepsReset | null;
  /** Pushes details for an item, remembering where the list was; a field shortcut opens that field. */
  readonly open: (id: ItemId, field?: DetailField) => void;
  /** Back to the list, with the list where it was and the row focused. Does nothing when details are closed. */
  readonly close: () => void;
  /** A field shortcut while details are open. */
  readonly requestField: (field: DetailField) => void;
  readonly pushUndo: (undo: DetailsUndo) => void;
  /** ⌘Z in details: the last removed step or window comes back; false when there is none. */
  readonly undo: () => boolean;
}

/** Level 2: which item's details show, the field asked for, and what ⌘Z can put back there. */
export const useDetails = ({
  apply,
  doc,
  listRef,
}: {
  readonly doc: ShelfDoc;
  readonly listRef: RefObject<HTMLElement | null>;
  readonly apply: (op: ShelfOp) => void;
}): Details => {
  const [id, setId] = useState<ItemId | null>(null);
  const [request, setRequest] = useState<FieldRequest | null>(null);
  const [stepsReset, setStepsReset] = useState<StepsReset | null>(null);
  // Refs, not state: a toast's Undo runs long after the render that made it.
  const undoable = useRef<readonly DetailsUndo[]>([]);
  const openId = useRef<ItemId | null>(null);
  const listScroll = useRef(0);
  const item = doc.items.find((candidate) => candidate.id === id);

  // An item deleted while its details are open takes them with it.
  if (id !== null && item === undefined) {
    setId(null);
  }

  return {
    close: () => {
      if (id === null) {
        return;
      }

      openId.current = null;
      undoable.current = [];
      setId(null);
      setRequest(null);
      requestAnimationFrame(() => {
        if (listRef.current !== null) {
          listRef.current.scrollTop = listScroll.current;
        }

        // Back on the row's Details button, where → or a click came from.
        const row = document.querySelector(`[data-item-id="${id}"]`);

        (
          row?.querySelector<HTMLElement>("[data-details-button]") ??
          row?.querySelector<HTMLElement>("button:not([role=checkbox])")
        )?.focus({ preventScroll: true });
      });
    },
    item,
    open: (next, field) => {
      listScroll.current = listRef.current?.scrollTop ?? 0;

      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }

      openId.current = next;
      undoable.current = [];
      setStepsReset(null);
      setRequest(field === undefined ? null : { field, seq: nextSeq() });
      setId(next);
    },
    pushUndo: (entry) => {
      undoable.current = [...undoable.current, entry].slice(-UNDO_DEPTH);
    },
    request,
    requestField: (field) => {
      setRequest({ field, seq: nextSeq() });
    },
    stepsReset,
    undo: () => {
      const last = undoable.current.at(-1);
      const itemId = openId.current;

      if (itemId === null || last === undefined) {
        return false;
      }

      undoable.current = undoable.current.slice(0, -1);

      if (last.kind === "steps") {
        apply({ id: itemId, steps: [...last.steps], type: "setSteps" });
        setStepsReset({ seq: nextSeq(), steps: last.steps });
      } else {
        apply({ id: itemId, type: "restoreWindow", windowId: last.windowId });
      }

      return true;
    },
  };
};

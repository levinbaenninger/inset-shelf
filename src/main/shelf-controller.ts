import type { ShelfStatus, ShelfView } from "@shared/contracts";
import { applyOp } from "@shared/shelf";
import type {
  ItemId,
  MainOp,
  OpEnv,
  Removed,
  ShelfDoc,
  ShelfItem,
  ShelfOp,
} from "@shared/shelf";

import type { WriteResult } from "./shelf-store";

/** Typing in a note saves after this pause; everything else saves at once. */
export const EDIT_SAVE_DELAY_MS = 400;

export interface ControllerDeps {
  readonly initial: ShelfDoc;
  readonly env: OpEnv;
  readonly save: (doc: ShelfDoc) => Promise<WriteResult>;
  readonly deleteAttachment: (file: string) => Promise<void>;
  readonly status: ShelfStatus;
  readonly setTimer: (run: () => void, ms: number) => () => void;
}

export interface ShelfController {
  readonly view: () => ShelfView;
  /** Returns the id of an item the operation added. */
  readonly apply: (op: ShelfOp | MainOp) => ItemId | null;
  readonly item: (id: ItemId) => ShelfItem | undefined;
  readonly focus: (id: ItemId) => void;
  readonly setStatus: (patch: Partial<ShelfStatus>) => void;
  readonly subscribe: (listener: () => void) => () => void;
  /** Writes any pending change now; used before quitting. */
  readonly flush: () => Promise<void>;
}

const isEdit = (op: ShelfOp | MainOp): boolean =>
  op.type === "editText" || op.type === "editNote";

export const createShelfController = (
  deps: ControllerDeps
): ShelfController => {
  let doc = deps.initial;
  let { status } = deps;
  let lastRemoved: Removed | null = null;
  let focus: ShelfView["focus"] = null;
  let focusSeq = 0;
  let cancelTimer: (() => void) | null = null;
  let toDelete: ShelfItem[] = [];
  let inFlight: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();

  const emit = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };

  const setStatus = (patch: Partial<ShelfStatus>): void => {
    status = { ...status, ...patch };
    emit();
  };

  const persist = async (): Promise<void> => {
    const snapshot = doc;
    const deletable = toDelete;

    toDelete = [];

    const result = await deps.save(snapshot);

    if (!result.ok) {
      toDelete = [...deletable, ...toDelete];
      setStatus({ saveError: result.message });

      return;
    }

    if (status.saveError !== null) {
      setStatus({ saveError: null });
    }

    await Promise.all(
      deletable.flatMap((item) =>
        item.kind === "image" ? [deps.deleteAttachment(item.image.file)] : []
      )
    );
  };

  const saveNow = (): void => {
    cancelTimer?.();
    cancelTimer = null;
    const previous = inFlight;

    inFlight = (async () => {
      await previous;
      await persist();
    })();
  };

  const saveSoon = (): void => {
    cancelTimer?.();
    cancelTimer = deps.setTimer(() => {
      cancelTimer = null;
      saveNow();
    }, EDIT_SAVE_DELAY_MS);
  };

  return {
    apply: (op) => {
      const result = applyOp(doc, op, deps.env, lastRemoved);

      if (result.doc === doc) {
        return null;
      }

      ({ doc } = result);
      toDelete = [...toDelete, ...result.discarded];

      if (op.type === "undoRemove") {
        lastRemoved = null;
      } else if (result.removed !== null) {
        lastRemoved = result.removed;
      }

      if (isEdit(op)) {
        saveSoon();
      } else {
        saveNow();
      }

      emit();

      return result.addedId;
    },
    flush: async () => {
      if (cancelTimer !== null) {
        saveNow();
      }

      await inFlight;
    },
    focus: (id) => {
      focusSeq += 1;
      focus = { id, seq: focusSeq };
      emit();
    },
    item: (id) => doc.items.find((item) => item.id === id),
    setStatus,
    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    view: () => ({ canUndo: lastRemoved !== null, doc, focus, status }),
  };
};

import type { ShelfStatus, ShelfView } from "@shared/contracts";
import { applyOp, attachmentsOf, UNDO_MAX } from "@shared/shelf";
import type {
  ItemId,
  MainOp,
  OpEnv,
  Removed,
  ShelfDoc,
  ShelfItem,
  ShelfOp,
  WindowId,
  WindowRef,
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

/** The shelf at one revision; each change makes the next one. */
export interface Revision {
  readonly rev: number;
  readonly doc: ShelfDoc;
}

export interface ShelfController {
  readonly view: () => ShelfView;
  /** Returns the id of an item the operation added. */
  readonly apply: (op: ShelfOp | MainOp) => ItemId | null;
  readonly item: (id: ItemId) => ShelfItem | undefined;
  /** Selects an item in the shelf; `edit` opens its text for typing. */
  readonly focus: (id: ItemId, edit?: boolean) => void;
  readonly setStatus: (patch: Partial<ShelfStatus>) => void;
  readonly subscribe: (listener: () => void) => () => void;
  /** The shelf as it is now, with the revision that names it. Documents are never changed in place. */
  readonly snapshot: () => Revision;
  /**
   * Resolves once the disk holds revision `rev` or a later one, retrying a
   * change a failed save left unwritten, or with why it doesn't. A write
   * already on its way that covers `rev` is waited for, not repeated.
   */
  readonly persisted: (rev: number) => Promise<WriteResult>;
  /** `persisted` for every change made so far. Quitting waits for it. */
  readonly flush: () => Promise<WriteResult>;
  /** How many items differ from what the disk holds: 0 once it holds every change, otherwise at least 1. */
  readonly unsaved: () => number;
  /** A window removed in details that can still come back. */
  readonly removedWindow: (id: WindowId) => WindowRef | undefined;
}

/** Typing saves after a pause; everything else at once. */
const TYPED: ReadonlySet<string> = new Set([
  "editText",
  "editNote",
  "setTitle",
  "setDescription",
  "setSteps",
  "describeWindow",
  "setPins",
]);

const isEdit = (op: ShelfOp | MainOp): boolean => TYPED.has(op.type);

/** A window taken off an item, kept so details can put it back with ⌘Z. */
interface RemovedWindow {
  readonly itemId: ItemId;
  readonly window: WindowRef;
  readonly index: number;
}

/** Windows removed in details that can still come back; their pictures stay until the shelf is next opened. */
const REMOVED_WINDOWS_MAX = 20;

export const createShelfController = (
  deps: ControllerDeps
): ShelfController => {
  let doc = deps.initial;
  let onDisk = deps.initial;
  let { status } = deps;
  let pending: readonly Removed[] = [];
  let focus: ShelfView["focus"] = null;
  let focusSeq = 0;
  let cancelTimer: (() => void) | null = null;
  let toDelete: ShelfItem[] = [];
  let removedWindows: readonly RemovedWindow[] = [];
  let inFlight: Promise<void> = Promise.resolve();
  // Counts the changes; `saved` is the last one the disk holds.
  let version = 0;
  let saved = 0;
  // A save is on its way that hasn't read the document yet.
  let queued = false;
  // The revision the write now on the disk's way holds, if one is.
  let writing: number | null = null;
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
    queued = false;

    if (saved === version) {
      return;
    }

    const snapshot = doc;
    const snapshotVersion = version;
    const deletable = toDelete;

    toDelete = [];
    writing = snapshotVersion;

    const result = await deps.save(snapshot);

    writing = null;

    if (!result.ok) {
      toDelete = [...deletable, ...toDelete];
      setStatus({ saveError: result.message });

      return;
    }

    saved = snapshotVersion;
    onDisk = snapshot;

    if (status.saveError !== null) {
      setStatus({ saveError: null });
    }

    await Promise.all(
      deletable.flatMap((item) =>
        attachmentsOf(item).map(deps.deleteAttachment)
      )
    );
  };

  const saveNow = (): void => {
    cancelTimer?.();
    cancelTimer = null;
    queued = true;
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

  /** removeWindow remembers the window; restoreWindow puts it back where it was. */
  const windowOp = (op: ShelfOp | MainOp): ShelfOp | MainOp | null => {
    if (op.type === "removeWindow") {
      const item = doc.items.find((candidate) => candidate.id === op.id);

      const index =
        item?.windows.findIndex((window) => window.id === op.windowId) ?? -1;

      const window = item?.windows[index];

      if (window !== undefined) {
        removedWindows = [
          ...removedWindows,
          { index, itemId: op.id, window },
        ].slice(-REMOVED_WINDOWS_MAX);
      }

      return op;
    }

    if (op.type !== "restoreWindow") {
      return op;
    }

    const removed = removedWindows.find(
      (candidate) =>
        candidate.itemId === op.id && candidate.window.id === op.windowId
    );

    if (removed === undefined) {
      return null;
    }

    removedWindows = removedWindows.filter(
      (candidate) => candidate !== removed
    );

    return {
      id: removed.itemId,
      index: removed.index,
      type: "insertWindow",
      window: removed.window,
    };
  };

  const persisted = async (rev: number): Promise<WriteResult> => {
    // A typed edit waiting for its pause, or a change a failed save left unwritten.
    if (saved < rev && !queued && (writing ?? 0) < rev) {
      saveNow();
    }

    await inFlight;

    return saved >= rev
      ? { ok: true }
      : {
          message: status.saveError ?? "The shelf could not be saved to disk.",
          ok: false,
        };
  };

  return {
    apply: (requested) => {
      const op = windowOp(requested);

      if (op === null) {
        return null;
      }

      const result = applyOp(doc, op, deps.env, pending);

      if (result.doc === doc) {
        return null;
      }

      ({ doc } = result);
      version += 1;
      toDelete = [...toDelete, ...result.discarded];

      if (op.type === "undoRemove") {
        const restored = op.id ?? pending.at(-1)?.item.id;

        pending = pending.filter((removed) => removed.item.id !== restored);
      } else if (result.removed !== null) {
        pending = [...pending, result.removed].slice(-UNDO_MAX);
      }

      if (isEdit(op)) {
        saveSoon();
      } else {
        saveNow();
      }

      emit();

      return result.addedId;
    },
    flush: async () => await persisted(version),
    focus: (id, edit = false) => {
      focusSeq += 1;
      focus = edit ? { edit, id, seq: focusSeq } : { id, seq: focusSeq };
      emit();
    },
    item: (id) => doc.items.find((item) => item.id === id),
    persisted,
    setStatus,
    snapshot: () => ({ doc, rev: version }),
    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    unsaved: () => {
      if (saved === version) {
        return 0;
      }

      const stored = new Map(onDisk.items.map((item) => [item.id, item]));
      const now = new Set(doc.items.map((item) => item.id));

      const changed = doc.items.filter(
        (item) => stored.get(item.id) !== item
      ).length;

      const removed = onDisk.items.filter((item) => !now.has(item.id)).length;

      // A change to sections alone still counts as one.
      return Math.max(1, changed + removed);
    },
    view: () => ({ canUndo: pending.length > 0, doc, focus, status }),
    removedWindow: (id: WindowId) =>
      removedWindows.find((removed) => removed.window.id === id)?.window,
  };
};

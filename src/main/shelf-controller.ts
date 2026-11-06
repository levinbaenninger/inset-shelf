import type { NotSavedItem, ShelfStatus, ShelfView } from "@shared/contracts";
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

export const SAVE_FAILED = "The shelf could not be saved to disk.";

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

/**
 * Whether a copy of some items can go ahead: the disk already holds them
 * (`saved`), a save of them is still to come (`pending`), or a save of them
 * failed and only Retry or Discard changes ends that (`failed`).
 */
export type CopyState =
  | { readonly kind: "saved" }
  | { readonly kind: "pending" }
  | { readonly kind: "failed"; readonly message: string };

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
   * Resolves once the disk holds revision `rev` or a later one, writing a
   * change still waiting for its pause, or with why it doesn't. A write
   * already on its way that covers `rev` is waited for, not repeated.
   */
  readonly persisted: (rev: number) => Promise<WriteResult>;
  /** `persisted` for every change made so far: Retry, and quitting. */
  readonly flush: () => Promise<WriteResult>;
  /** How many items differ from what the disk holds; a change to sections alone counts as one. */
  readonly unsaved: () => number;
  /** Where these items of `doc` stand against the disk, for a copy of them. */
  readonly copyState: (ids: readonly ItemId[], doc: ShelfDoc) => CopyState;
  /**
   * Discard changes: the item goes back to what the disk holds, and only
   * that item. False for an item the disk has never held, or one that
   * already matches it.
   */
  readonly discard: (id: ItemId) => boolean;
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

const byId = (doc: ShelfDoc): ReadonlyMap<ItemId, ShelfItem> =>
  new Map(doc.items.map((item) => [item.id, item]));

/** Items of `doc` the disk doesn't hold as they are, and items it holds that `doc` no longer has. */
const differences = (doc: ShelfDoc, onDisk: ShelfDoc) => {
  const stored = byId(onDisk);
  const now = new Set(doc.items.map((item) => item.id));

  return {
    changed: doc.items.filter((item) => stored.get(item.id) !== item),
    removed: onDisk.items.filter((item) => !now.has(item.id)).length,
  };
};

/** The same items, in the same order, in the same sections: nothing to write. */
const sameShelf = (doc: ShelfDoc, onDisk: ShelfDoc): boolean =>
  doc === onDisk ||
  (doc.activeSectionId === onDisk.activeSectionId &&
    doc.items.length === onDisk.items.length &&
    doc.items.every((item, index) => onDisk.items[index] === item) &&
    JSON.stringify(doc.sections) === JSON.stringify(onDisk.sections));

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
  // Items a failed write held a change to. They stay failed, edited or not, until a write holding them succeeds or Discard changes.
  let failed: ReadonlySet<ItemId> = new Set();
  let discarded: ShelfView["discarded"] = null;

  // Items Discard changes put back, with the version that did it. Until a write that new lands, a write already on its way may leave the discarded words on the disk, and this stays the item's saved version.
  let kept: ReadonlyMap<
    ItemId,
    { readonly item: ShelfItem; readonly version: number }
  > = new Map();

  // A captured selection's formatting while its words are edited: it comes back with the captured words (Escape after typing).
  let formatted: ReadonlyMap<
    ItemId,
    { readonly text: string; readonly html: string }
  > = new Map();

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
      failed = new Set([
        ...failed,
        ...differences(snapshot, onDisk).changed.map((item) => item.id),
      ]);
      setStatus({ saveError: result.message });

      return;
    }

    saved = Math.max(saved, snapshotVersion);
    onDisk = snapshot;
    // An item edited again since this write began stays failed until a write holds its latest version.
    const written = byId(snapshot);

    failed = new Set(
      doc.items
        .filter((item) => failed.has(item.id) && written.get(item.id) !== item)
        .map((item) => item.id)
    );
    kept = new Map(
      [...kept].filter(([, entry]) => entry.version > snapshotVersion)
    );

    if (status.saveError !== null && failed.size === 0) {
      setStatus({ saveError: null });
    }

    // A file the saved shelf, the shown shelf or a Discard's saved version still names stays: Discard changes can bring back an image's old picture while this write was on its way.
    const used = new Set(
      [
        ...snapshot.items,
        ...doc.items,
        ...[...kept.values()].map((e) => e.item),
      ].flatMap(attachmentsOf)
    );

    await Promise.all(
      deletable
        .flatMap(attachmentsOf)
        .filter((file) => !used.has(file))
        .map(deps.deleteAttachment)
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

  /**
   * After a failed save, a change can leave the shelf as the disk holds it
   * (Discard changes, deleting a capture that was never saved): there is
   * nothing to write, so nothing is left to fail.
   */
  const settleIfClean = (): boolean => {
    if (
      status.readOnly ||
      status.saveError === null ||
      writing !== null ||
      !sameShelf(doc, onDisk)
    ) {
      return false;
    }

    cancelTimer?.();
    cancelTimer = null;
    saved = version;
    failed = new Set();
    status = { ...status, saveError: null };

    return true;
  };

  /** An edit of a captured selection's words clears its formatting; going back to the captured words brings it back. */
  const keepFormatting = (
    id: ItemId,
    text: string,
    before: ShelfDoc
  ): ShelfDoc => {
    const was = before.items.find((item) => item.id === id);

    if (was?.kind === "text" && was.html !== null && !formatted.has(id)) {
      formatted = new Map([
        ...formatted,
        [id, { html: was.html, text: was.text }],
      ]);
    }

    const captured = formatted.get(id);

    if (captured?.text !== text) {
      return doc;
    }

    return {
      ...doc,
      items: doc.items.map((item) =>
        item.id === id && item.kind === "text"
          ? { ...item, html: captured.html }
          : item
      ),
    };
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
      : { message: status.saveError ?? SAVE_FAILED, ok: false };
  };

  /** The version Discard changes goes back to: the disk's, or the one a Discard put back while a write was on its way. */
  const savedVersion = (id: ItemId): ShelfItem | undefined =>
    kept.get(id)?.item ?? onDisk.items.find((item) => item.id === id);

  /**
   * Failed items that still differ from the disk, with what each offers
   * next to Retry. A read-only session has nothing to retry: its banner
   * already says nothing is saved.
   */
  const notSaved = (): readonly NotSavedItem[] => {
    if (failed.size === 0 || status.readOnly) {
      return [];
    }

    const stored = byId(onDisk);

    return doc.items.flatMap((item): NotSavedItem[] => {
      if (!failed.has(item.id) || stored.get(item.id) === item) {
        return [];
      }

      const before = savedVersion(item.id);

      if (before === undefined) {
        return [{ id: item.id, undo: "delete" }];
      }

      return [{ id: item.id, undo: before === item ? null : "discard" }];
    });
  };

  return {
    apply: (requested) => {
      const op = windowOp(requested);

      if (op === null) {
        return null;
      }

      const before = doc;
      const result = applyOp(doc, op, deps.env, pending);

      if (result.doc === doc) {
        return null;
      }

      ({ doc } = result);

      if (op.type === "editText") {
        doc = keepFormatting(op.id, op.text, before);
      }

      version += 1;
      toDelete = [...toDelete, ...result.discarded];

      if (op.type === "undoRemove") {
        const restored = op.id ?? pending.at(-1)?.item.id;

        pending = pending.filter((removed) => removed.item.id !== restored);
      } else if (result.removed !== null) {
        pending = [...pending, result.removed].slice(-UNDO_MAX);
      }

      if (settleIfClean()) {
        // Nothing left to write.
      } else if (isEdit(op)) {
        saveSoon();
      } else {
        saveNow();
      }

      emit();

      return result.addedId;
    },
    copyState: (ids, from) => {
      const stored = byId(onDisk);
      const items = ids.flatMap((id) => from.items.filter((i) => i.id === id));

      if (
        items.some(
          (item) => failed.has(item.id) && stored.get(item.id) !== item
        )
      ) {
        return { kind: "failed", message: status.saveError ?? SAVE_FAILED };
      }

      return items.every((item) => stored.get(item.id) === item)
        ? { kind: "saved" }
        : { kind: "pending" };
    },
    discard: (id) => {
      const before = savedVersion(id);
      const now = doc.items.find((item) => item.id === id);

      if (before === undefined || now === undefined || before === now) {
        return false;
      }

      // A section deleted since keeps its item where it is now.
      const restored = doc.sections.some(
        (section) => section.id === before.sectionId
      )
        ? before
        : { ...before, sectionId: now.sectionId };

      doc = {
        ...doc,
        items: doc.items.map((item) => (item.id === id ? restored : item)),
      };
      version += 1;
      kept = new Map([...kept, [id, { item: restored, version }]]);
      failed = new Set([...failed].filter((other) => other !== id));
      discarded = { id, seq: (discarded?.seq ?? 0) + 1 };
      // A picture drawn in since goes once the disk no longer names it.
      toDelete = [...toDelete, now];
      removedWindows = removedWindows.filter(
        (removed) => removed.itemId !== id
      );

      if (!settleIfClean()) {
        // A write on its way may still put the discarded words on the disk; this one puts them back.
        saveNow();
      }

      emit();

      return true;
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

      const { changed, removed } = differences(doc, onDisk);
      const count = changed.length + removed;

      if (count > 0) {
        return count;
      }

      return sameShelf(doc, onDisk) ? 0 : 1;
    },
    view: () => ({
      canUndo: pending.length > 0,
      discarded,
      doc,
      focus,
      notSaved: notSaved(),
      status,
    }),
    removedWindow: (id: WindowId) =>
      removedWindows.find((removed) => removed.window.id === id)?.window,
  };
};

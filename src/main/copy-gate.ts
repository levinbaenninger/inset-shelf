import type { ActionResult } from "@shared/contracts";
import type { ItemId, ShelfDoc } from "@shared/shelf";
import type { ClipboardItem, WebContents } from "electron";

import type { CopyState, Revision } from "./shelf-controller";
import type { WriteResult } from "./shelf-store";

/**
 * The only file that writes the clipboard (Round 5). A copy of shelf items
 * takes the shelf as it is when the copy starts, waits until the disk holds
 * that revision, and copies exactly that, so what it copies is what is
 * saved; it copies nothing when the save failed (Round 6). An item whose
 * save already failed is refused at once, with no new write: Retry is the
 * user's to choose (Round 7).
 * clipboard-writers.test.ts fails when any other file writes the clipboard.
 */

/** One clipboard item the shelf copies, format by format: "text/plain", "text/html", "image/png", a file URL. */
export type ClipboardData = Readonly<Record<string, Blob>>;

/** Everything a clipboard item can hold, as read back to put it back. */
export type ClipboardContents = ConstructorParameters<typeof ClipboardItem>[0];

/** What a copy puts on the clipboard, or why there is nothing to put there. */
export type Payload =
  | { readonly data: ClipboardData }
  | { readonly problem: string };

/** Electron's clipboard, as far as the gate uses it; `Item` is its ClipboardItem. */
export interface ClipboardWriter<Item> {
  readonly write: (items: Item[]) => Promise<void>;
  readonly clear: () => void;
}

export interface CopyGateDeps<Item> {
  /** The shelf now, and the revision that names it. */
  readonly snapshot: () => Revision;
  /** Resolves once the disk holds that revision or a later one, or with why it doesn't. */
  readonly persisted: (rev: number) => Promise<WriteResult>;
  /** Whether the disk holds these items of the snapshot, will soon, or failed to. */
  readonly copyState: (ids: readonly ItemId[], doc: ShelfDoc) => CopyState;
  /** How often Discard changes put these items back; it changes when they are discarded. */
  readonly discards: (ids: readonly ItemId[]) => number;
  /**
   * The shelf file could not be read or set aside at launch, so this session
   * saves nothing (the banner says so). Copies don't wait for a save that
   * can't happen; they copy what the shelf shows.
   */
  readonly readOnly: boolean;
  readonly clipboard: ClipboardWriter<Item>;
  /** Electron's ClipboardItem, made in main; tests keep the formats as they are. */
  readonly toItem: (data: ClipboardContents) => Item;
  /** The app is about to change the clipboard: the screenshot watcher must not take it for a screenshot. */
  readonly onWrite: () => void;
}

export interface CopyGate {
  /**
   * Builds the payload of items `ids` from the shelf as it is now, waits
   * until the disk holds them, then copies that payload. An edit made
   * meanwhile is not copied. Items the disk holds already copy at once;
   * an item whose save failed copies nothing, says why and offers Retry.
   */
  readonly copy: (
    ids: readonly ItemId[],
    payload: (doc: ShelfDoc) => Payload | Promise<Payload>
  ) => Promise<ActionResult>;
  /**
   * A copy that carries its own picture, not the shelf's items: the
   * screenshot card's, and a new drawing's. A shelf that can't be saved
   * doesn't stop it, so nothing waits for a save.
   */
  readonly copyOwn: (data: ClipboardData) => Promise<ActionResult>;
  /**
   * Edit › Copy inside a text field: the words selected there, as any app
   * copies them. They are on screen, not the shelf's saved items, so no save
   * is waited for.
   */
  readonly copySelection: (contents: Pick<WebContents, "copy">) => void;
  /** Double Shift empties the clipboard before it copies the selection in front. */
  readonly clearForSelection: () => void;
  /** Then it puts back what the clipboard held. Nothing of the shelf goes on it, so no save is waited for. */
  readonly restore: (saved: readonly ClipboardContents[]) => Promise<void>;
}

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : "Unknown error";

/** A copy refused because what it would copy isn't on the disk. */
export const notSaved = (cause: string): ActionResult => ({
  message: `Couldn’t save your changes, so nothing was copied. ${cause}`,
  ok: false,
  retrySave: true,
});

/** A copy refused because the changes it waited for were discarded meanwhile: they are never saved. */
export const DISCARDED = "Its changes were discarded, so nothing was copied.";

export const createCopyGate = <Item>(deps: CopyGateDeps<Item>): CopyGate => {
  const write = async (data: ClipboardData): Promise<ActionResult> => {
    try {
      deps.onWrite();
      await deps.clipboard.write([deps.toItem(data)]);

      return { ok: true };
    } catch (error) {
      return { message: `Couldn’t copy: ${errorMessage(error)}`, ok: false };
    }
  };

  return {
    clearForSelection: () => {
      deps.onWrite();
      deps.clipboard.clear();
    },
    copySelection: (contents) => {
      deps.onWrite();
      contents.copy();
    },
    copy: async (ids, payload) => {
      // Taken before anything waits: a later edit makes a new document and leaves this one as it is.
      const { doc, rev } = deps.snapshot();
      const state = deps.readOnly ? null : deps.copyState(ids, doc);
      const discards = deps.discards(ids);

      if (state?.kind === "failed") {
        return notSaved(state.message);
      }

      let built: Payload;

      try {
        built = await payload(doc);
      } catch (error) {
        return { message: `Couldn’t copy: ${errorMessage(error)}`, ok: false };
      }

      if ("problem" in built) {
        return { message: built.problem, ok: false };
      }

      if (state?.kind === "pending") {
        const saved = await deps.persisted(rev);

        if (!saved.ok) {
          return notSaved(saved.message);
        }

        // Discarded while it waited: the snapshot holds words that are never saved (Round 8).
        if (deps.discards(ids) !== discards) {
          return { message: DISCARDED, ok: false };
        }
      }

      return await write(built.data);
    },
    copyOwn: write,
    restore: async (saved) => {
      deps.onWrite();

      // Electron reads an empty clipboard (or one it can't open) as one item with no formats, which it can't write back.
      const items = saved.filter((entry) => Object.keys(entry).length > 0);

      if (items.length === 0) {
        deps.clipboard.clear();

        return;
      }

      await deps.clipboard.write(items.map(deps.toItem));
    },
  };
};

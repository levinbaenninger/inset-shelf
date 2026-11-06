import type { ActionResult } from "@shared/contracts";
import type { ClipboardItem, WebContents } from "electron";

import type { WriteResult } from "./shelf-store";

/**
 * The only file that writes the clipboard (Round 5). A copy waits until the
 * disk holds every change, so what it copies is what is saved, and copies
 * nothing when the save failed. clipboard-writers.test.ts fails when any
 * other file writes the clipboard.
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
  /** Resolves once the disk holds every change made so far, or with why it doesn't. */
  readonly flush: () => Promise<WriteResult>;
  readonly clipboard: ClipboardWriter<Item>;
  /** Electron's ClipboardItem, made in main; tests keep the formats as they are. */
  readonly toItem: (data: ClipboardContents) => Item;
  /** The app is about to change the clipboard: the screenshot watcher must not take it for a screenshot. */
  readonly onWrite: () => void;
}

export interface CopyGate {
  /**
   * Saves, then copies what `payload` builds from the saved shelf. With a
   * failed save it copies nothing and says why.
   */
  readonly copy: (
    payload: () => Payload | Promise<Payload>
  ) => Promise<ActionResult>;
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

export const createCopyGate = <Item>(deps: CopyGateDeps<Item>): CopyGate => ({
  clearForSelection: () => {
    deps.onWrite();
    deps.clipboard.clear();
  },
  copySelection: (contents) => {
    deps.onWrite();
    contents.copy();
  },
  copy: async (payload) => {
    const saved = await deps.flush();

    if (!saved.ok) {
      return { message: `Not copied. ${saved.message}`, ok: false };
    }

    try {
      const built = await payload();

      if ("problem" in built) {
        return { message: built.problem, ok: false };
      }

      deps.onWrite();
      await deps.clipboard.write([deps.toItem(built.data)]);

      return { ok: true };
    } catch (error) {
      return { message: `Couldn't copy: ${errorMessage(error)}`, ok: false };
    }
  },
  restore: async (saved) => {
    deps.onWrite();

    if (saved.length === 0) {
      deps.clipboard.clear();

      return;
    }

    await deps.clipboard.write(saved.map(deps.toItem));
  },
});

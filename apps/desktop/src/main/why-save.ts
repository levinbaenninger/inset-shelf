import { withWhy } from "@shared/pill";
import type { WhyOutcome } from "@shared/pill";
import type { ItemId, ShelfItem } from "@shared/shelf";

import type { WriteResult } from "./shelf-store";

/**
 * Say why: the words go after what the item's description already says, and
 * the answer comes once the disk holds them or couldn't.
 *
 * A write that fails leaves the words on the item, as every unsaved edit
 * stays in the shelf. Trying the same words again is then the same edit: it
 * owes only the write, so the description holds the line once. When Discard
 * changes or another edit changed the description meanwhile, the words go on
 * again.
 */
export const createWhySave = (deps: {
  readonly item: (id: ItemId) => ShelfItem | undefined;
  readonly describe: (id: ItemId, description: string) => void;
  /** Ends once the disk holds the shelf as it is now, or couldn't take it. */
  readonly written: () => Promise<WriteResult>;
}): ((item: ItemId, text: string) => Promise<WhyOutcome>) => {
  /** Per item, the words a write couldn't keep and the description they left on it. */
  const unwritten = new Map<
    ItemId,
    { readonly text: string; readonly description: string }
  >();

  return async (item, text) => {
    const saved = deps.item(item);

    if (saved === undefined) {
      unwritten.delete(item);

      return { kind: "gone" };
    }

    const left = unwritten.get(item);

    const held =
      left !== undefined &&
      left.text === text &&
      left.description === saved.description;

    const description = held
      ? saved.description
      : withWhy(saved.description, text);

    if (!held) {
      deps.describe(item, description);
    }

    const written = await deps.written();

    if (written.ok) {
      unwritten.delete(item);

      return { kind: "saved" };
    }

    unwritten.set(item, { description, text });

    return { kind: "failed", message: written.message };
  };
};

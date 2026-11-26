import type { ItemId, ShelfItem } from "@shared/shelf";

/** What the page makes of the shelf's items each time they change. */
export interface Looked {
  /** Every item the page has held; null until the shelf has loaded with its first items. */
  readonly held: ReadonlySet<ItemId> | null;
  /** The item made since the page last looked: the last one it has never held. */
  readonly made: ItemId | undefined;
}

/**
 * Tells an item made now from everything else that changes the list. The
 * items the shelf loads with are not new, even when they arrive after an
 * empty first view. Deleting, moving or checking items makes none, and
 * neither does an Undo that brings one back.
 */
export const lookAt = (
  held: ReadonlySet<ItemId> | null,
  items: readonly ShelfItem[]
): Looked => {
  if (held === null) {
    return {
      held: items.length === 0 ? null : new Set(items.map((item) => item.id)),
      made: undefined,
    };
  }

  return {
    held: new Set([...held, ...items.map((item) => item.id)]),
    made: items.findLast((item) => !held.has(item.id))?.id,
  };
};

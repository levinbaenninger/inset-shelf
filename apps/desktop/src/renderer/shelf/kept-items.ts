import type { ShelfDoc, ShelfItem } from "@shared/shelf";

/** Whether two copies of an item hold the same data: main sends its fields in the same order every time. */
const sameItem = (a: ShelfItem, b: ShelfItem): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * The new shelf with every item that didn't change kept as the object the
 * page already holds. Main's views arrive as copies (IPC clones them), so
 * without this every item is new after any change, and every row draws
 * again (item-row.tsx memoises rows on their item).
 */
export const keptItems = (
  before: ShelfDoc | undefined,
  next: ShelfDoc
): ShelfDoc => {
  if (before === undefined) {
    return next;
  }

  const held = new Map(before.items.map((item) => [item.id, item]));

  return {
    ...next,
    items: next.items.map((item): ShelfItem => {
      const old = held.get(item.id);

      return old !== undefined && sameItem(old, item) ? old : item;
    }),
  };
};

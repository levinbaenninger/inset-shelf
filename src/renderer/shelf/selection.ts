import type { ItemId } from "@shared/shelf";

/** The id offset steps away from current, stopping at the ends; the last id when nothing is selected, since new items arrive at the bottom. Null below the last item. */
export const stepSelection = (
  ids: readonly ItemId[],
  current: ItemId | null,
  offset: 1 | -1
): ItemId | null => {
  const index = current === null ? -1 : ids.indexOf(current);

  if (index === -1) {
    return offset === -1 ? (ids.at(-1) ?? null) : null;
  }

  if (offset === 1 && index === ids.length - 1) {
    return null;
  }

  return ids[Math.max(index + offset, 0)] ?? null;
};

/** After a delete, select the next item, else the one before. */
export const selectionAfterRemoval = (
  ids: readonly ItemId[],
  removed: ItemId
): ItemId | null => {
  const index = ids.indexOf(removed);

  if (index === -1) {
    return null;
  }

  return ids[index + 1] ?? ids[index - 1] ?? null;
};

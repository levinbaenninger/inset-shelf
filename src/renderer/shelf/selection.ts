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

/** Keeps ids in the order they are shown. */
const inOrder = (
  ids: readonly ItemId[],
  wanted: ReadonlySet<ItemId>
): readonly ItemId[] => ids.filter((id) => wanted.has(id));

/**
 * ⌘-click: adds or removes one item. The open item, if any, joins the picks
 * first, so a ⌘-click next to it picks both.
 */
export const togglePick = (
  ids: readonly ItemId[],
  picked: readonly ItemId[],
  open: ItemId | null,
  id: ItemId
): readonly ItemId[] => {
  const next = new Set(picked.length === 0 && open !== null ? [open] : picked);

  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }

  return inOrder(ids, next);
};

/** ⇧-click: every item shown from the anchor to this one; just this one without an anchor. */
export const rangePick = (
  ids: readonly ItemId[],
  anchor: ItemId | null,
  id: ItemId
): readonly ItemId[] => {
  const from = anchor === null ? -1 : ids.indexOf(anchor);
  const to = ids.indexOf(id);

  if (to === -1) {
    return [];
  }

  if (from === -1) {
    return [id];
  }

  return ids.slice(Math.min(from, to), Math.max(from, to) + 1);
};

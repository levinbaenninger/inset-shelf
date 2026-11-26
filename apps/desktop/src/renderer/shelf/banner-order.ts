/**
 * Which banner shows open and in what order (banners.tsx): kept apart so
 * the order is tested without a page.
 */

export type BannerId = "keys" | "save" | "problem";

/** What a banner is known by: its kind and its words. */
export interface Signed {
  readonly id: BannerId;
  readonly text: string;
}

/** Which banner takes the open slot first: anything about unsaved data, then a failed capture, then a missing permission. */
export const SEVERITY: Readonly<Record<BannerId, number>> = {
  keys: 0,
  problem: 1,
  save: 2,
};

/** A banner as last seen: a new text is news, as a new banner is. */
export const signature = (entry: Signed): string =>
  `${entry.id}\n${entry.text}`;

/**
 * The banners in the order they first showed, later is newer, after
 * `shown` came in: new ones join at the end, and cleared ones leave, so one
 * that comes back is news again. The same array when nothing changed, so a
 * render can compare it.
 */
export const nextNews = (
  news: readonly string[],
  shown: readonly string[]
): readonly string[] => {
  const kept = news.filter((each) => shown.includes(each));
  const arrived = shown.filter((each) => !news.includes(each));

  return kept.length === news.length && arrived.length === 0
    ? news
    : [...kept, ...arrived];
};

/** Every banner in the order they show opened: the most severe first, and of equals the newest. The first takes the open slot. */
export const bySeverity = <T extends Signed>(
  entries: readonly T[],
  news: readonly string[]
): readonly T[] =>
  entries.toSorted(
    (a, b) =>
      SEVERITY[b.id] - SEVERITY[a.id] ||
      news.indexOf(signature(b)) - news.indexOf(signature(a))
  );

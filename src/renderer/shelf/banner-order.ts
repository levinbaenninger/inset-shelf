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
 * `shown` came in: new ones join at the end. The same array when nothing
 * is new, so a render can compare it.
 */
export const nextNews = (
  news: readonly string[],
  shown: readonly string[]
): readonly string[] =>
  shown.some((each) => !news.includes(each))
    ? [
        ...news.filter((each) => shown.includes(each)),
        ...shown.filter((each) => !news.includes(each)),
      ]
    : news;

/** The banner that takes the open slot: the most severe, and of those the newest news. */
export const openFirst = <T extends Signed>(
  entries: readonly T[],
  news: readonly string[]
): T["id"] | null => {
  let best: T | null = null;

  for (const entry of entries) {
    const newer =
      best !== null &&
      news.indexOf(signature(entry)) > news.indexOf(signature(best));

    if (
      best === null ||
      SEVERITY[entry.id] > SEVERITY[best.id] ||
      (SEVERITY[entry.id] === SEVERITY[best.id] && newer)
    ) {
      best = entry;
    }
  }

  return best?.id ?? null;
};

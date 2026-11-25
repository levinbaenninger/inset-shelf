/** How wide the name's characters are drawn, for cutting it to its line. */
export interface NameMeasure {
  /** The width of the name up to this index. */
  readonly upTo: (end: number) => number;
  /** The width of the ellipsis. */
  readonly dots: number;
}

/**
 * The name as far as `room` takes it: whole when it fits, else its longest
 * start with … right after it. A CSS ellipsis can't do this for a name inside
 * quotes: it leaves the rest of its box empty before the closing quote.
 */
export const fitName = (
  name: string,
  room: number,
  measure: NameMeasure
): string => {
  if (measure.upTo(name.length) <= room) {
    return name;
  }

  const cuts = [
    ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(name),
  ].map((character) => character.index);

  for (const cut of cuts.toReversed()) {
    const start = name.slice(0, cut).trimEnd();

    if (start !== "" && measure.upTo(start.length) + measure.dots <= room) {
      return `${start}…`;
    }
  }

  return "…";
};

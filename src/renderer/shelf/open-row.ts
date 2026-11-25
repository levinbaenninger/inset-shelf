/**
 * How much of an open row shows, so one item never takes more than
 * OPEN_SHARE of the list (item-row.tsx measures, this decides). Past the
 * share the row gives way in a fixed order: the picture's height, then pin
 * labels, then steps, then the linked windows, then its words or caption,
 * then its description. The title never does. Words that give way are cut
 * with one Show more for the whole row; what the lists leave out is said in
 * the row's one "N more pins · N more steps" line.
 */

/** An open row takes at most this share of the list's height. */
export const OPEN_SHARE = 0.6;

/** The words of an open row that a cap can cut. */
export type TextPart = "title" | "words" | "description";

/** How far each part of an open row shows. */
export interface RowBudget {
  /** The picture's greatest height, in pixels. */
  readonly picture: number;
  /** Labelled pins listed. */
  readonly pins: number;
  /** Steps listed. */
  readonly steps: number;
  /** The linked windows' strip shows; else they are counted in the more line. */
  readonly windows: boolean;
  /** Lines of each text part before Show more. */
  readonly title: number;
  readonly words: number;
  readonly description: number;
}

/** What an open row shows while it has the room. */
export const ROW_CAPS: RowBudget = {
  description: 3,
  picture: 192,
  pins: 3,
  steps: 5,
  title: 3,
  windows: true,
  words: 10,
};

/** The least each part shows, however little room is left. */
const ROW_FLOORS: RowBudget = {
  description: 2,
  picture: 128,
  pins: 1,
  steps: 2,
  title: 3,
  windows: false,
  words: 3,
};

/** The picture gives way in steps this tall. */
const PICTURE_STEP = 16;

/** A text part as measured: its lines whole, one line's height, and the gap above it. */
export interface TextMeasure {
  readonly lines: number;
  readonly line: number;
  /** Its whole height, which may not be a whole number of lines. */
  readonly height: number;
  readonly gap: number;
}

/** A part's height and the gap above it. */
export interface Box {
  readonly height: number;
  readonly gap: number;
}

/**
 * An open row as measured. Every number is the same whatever the budget it
 * was rendered with, so the fit never feeds back into what it reads: parts
 * not rendered now are estimated no smaller than they would be.
 */
export interface RowMeasure {
  /** The most the row may take. */
  readonly budget: number;
  /** The row without any of the parts below. */
  readonly rest: number;
  /** The picture's height with no cap, and the gap above it; null without one. */
  readonly picture: Box | null;
  /** One pin label's height, the gap between two, and the gap above the list; null without labelled pins. */
  readonly pin: (Box & { readonly between: number }) | null;
  readonly pinCount: number;
  /** Each listed step's height, in order, and the gap above the list. */
  readonly steps: {
    readonly heights: readonly number[];
    readonly gap: number;
  } | null;
  readonly windows: Box | null;
  readonly text: Readonly<Partial<Record<TextPart, TextMeasure>>>;
  /** Show more with the gap above it. */
  readonly showMore: number;
  /** The "N more pins · N more steps" line with the gap above it. */
  readonly moreLine: number;
  /** Whether the lists hold more than their caps, so the more line shows anyway. */
  readonly moreAnyway: boolean;
}

const TEXT_PARTS: readonly TextPart[] = ["title", "words", "description"];

/** A text part is cut only when at least two lines would hide: a button that costs a line to save one is worse than none. */
const isCut = (measured: TextMeasure, cap: number): boolean =>
  measured.lines >= cap + 2;

/** The text parts this budget cuts, in the row's order. */
export const cutParts = (
  measure: RowMeasure,
  budget: RowBudget
): readonly TextPart[] =>
  TEXT_PARTS.filter((part) => {
    const measured = measure.text[part];

    return measured !== undefined && isCut(measured, budget[part]);
  });

const sum = (values: readonly number[]): number =>
  values.reduce((total, value) => total + value, 0);

/** How tall the row is with this budget. */
export const rowHeight = (measure: RowMeasure, budget: RowBudget): number => {
  const { picture, pin, steps, windows } = measure;

  const text = TEXT_PARTS.map((part) => {
    const measured = measure.text[part];

    if (measured === undefined) {
      return 0;
    }

    return (
      measured.gap +
      (isCut(measured, budget[part])
        ? budget[part] * measured.line
        : measured.height)
    );
  });

  const pins = Math.min(measure.pinCount, budget.pins);
  const shownSteps = steps?.heights.slice(0, budget.steps) ?? [];

  const listsGaveWay =
    measure.pinCount > budget.pins ||
    (steps !== null && steps.heights.length > budget.steps) ||
    (windows !== null && !budget.windows);

  return (
    measure.rest +
    (picture === null
      ? 0
      : picture.gap + Math.min(picture.height, budget.picture)) +
    sum(text) +
    (pin === null || pins === 0
      ? 0
      : pin.gap + pins * pin.height + (pins - 1) * pin.between) +
    (steps === null ? 0 : steps.gap + sum(shownSteps)) +
    (windows === null || !budget.windows ? 0 : windows.gap + windows.height) +
    (cutParts(measure, budget).length > 0 ? measure.showMore : 0) +
    (listsGaveWay || measure.moreAnyway ? measure.moreLine : 0)
  );
};

/** One step of giving way, or null once the part is at its floor. */
type Shrink = (budget: RowBudget) => RowBudget | null;

/** One fewer of a count or a part's lines, or null at its floor. */
const less = (
  budget: RowBudget,
  key: "pins" | "steps" | TextPart
): RowBudget | null =>
  budget[key] > ROW_FLOORS[key] ? { ...budget, [key]: budget[key] - 1 } : null;

/** The parts that give way, in the order they do. */
const GIVES_WAY: readonly Shrink[] = [
  (budget) =>
    budget.picture > ROW_FLOORS.picture
      ? {
          ...budget,
          picture: Math.max(ROW_FLOORS.picture, budget.picture - PICTURE_STEP),
        }
      : null,
  (budget) => less(budget, "pins"),
  (budget) => less(budget, "steps"),
  (budget) => (budget.windows ? { ...budget, windows: false } : null),
  (budget) => less(budget, "words"),
  (budget) => less(budget, "description"),
];

/**
 * The budget that fits the row in `measure.budget`: each part in turn gives
 * way, one step at a time, only while the row is still too tall and only
 * where the step saves room. A row that can't fit at its floors shows them.
 */
export const fitOpenRow = (measure: RowMeasure): RowBudget => {
  let budget = ROW_CAPS;

  for (const shrink of GIVES_WAY) {
    for (
      let next = shrink(budget);
      next !== null && rowHeight(measure, budget) > measure.budget;
      next = shrink(budget)
    ) {
      // A step that saves nothing (a part shorter than its cap) is taken anyway: the next one may save.
      budget = next;
    }
  }

  return budget;
};

/**
 * Each step's height for the fit: as rendered now, else as last seen, else
 * as tall as the tallest seen (or `unseen`). `seen` keeps every height
 * measured at this width, so an estimate only ever grows and the fit can't
 * swing between showing a step and not.
 */
export const stepHeights = (
  ids: readonly string[],
  rendered: ReadonlyMap<string, number>,
  seen: Map<string, number>,
  unseen: number
): readonly number[] => {
  for (const [id, height] of rendered) {
    seen.set(id, height);
  }

  const tallest = Math.max(unseen, ...seen.values());

  return ids.map((id) => seen.get(id) ?? tallest);
};

const sameBudget = (a: RowBudget, b: RowBudget): boolean =>
  a.picture === b.picture &&
  a.pins === b.pins &&
  a.steps === b.steps &&
  a.windows === b.windows &&
  a.title === b.title &&
  a.words === b.words &&
  a.description === b.description;

/** The budget a render should keep: the one it has when nothing changed, so React can skip it. */
export const keptBudget = (now: RowBudget, next: RowBudget): RowBudget =>
  sameBudget(now, next) ? now : next;

const MORE_NAMES = [
  { key: "pins", many: "pins", one: "pin" },
  { key: "steps", many: "steps", one: "step" },
  { key: "windows", many: "windows", one: "window" },
] as const;

/** What only details show of an open row's lists, in one line: "27 more pins · 15 more steps · 10 windows", or null. */
export const moreText = (
  more: Readonly<Record<"pins" | "steps" | "windows", number>>
): string | null => {
  const parts = MORE_NAMES.flatMap(({ key, many, one }) => {
    const count = more[key];
    const noun = count === 1 ? one : many;

    if (count === 0) {
      return [];
    }

    // Windows give way all together: they are counted, not "more".
    return [key === "windows" ? `${count} ${noun}` : `${count} more ${noun}`];
  });

  return parts.length === 0 ? null : parts.join(" · ");
};

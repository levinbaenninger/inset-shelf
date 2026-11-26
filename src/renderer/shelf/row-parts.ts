import type { ShelfItem, Step } from "@shared/shelf";

/** A metadata badge on a row's quiet line. */
export type RowBadge =
  | { readonly kind: "due"; readonly due: string }
  | { readonly kind: "steps"; readonly done: number; readonly total: number }
  | { readonly kind: "windows"; readonly count: number }
  | { readonly kind: "pins"; readonly count: number };

/** A list the open row shows: its first entries, and how many more only details show. */
export interface RowList {
  readonly shown: number;
  readonly more: number;
}

/** The steps an open row lists, and the rest: how many, and how many of those are done. */
export interface RowStepList {
  readonly shown: readonly Step[];
  readonly more: number;
  readonly moreDone: number;
}

/**
 * What an open row shows besides its words, each part only once it is set
 * and each under its own cap (ROW_CAPS): no part's share depends on
 * another's or on the list's height.
 */
export interface RowOpen {
  /** The labelled pins. */
  readonly pins: RowList | null;
  readonly description: boolean;
  /** Steps that hold words, those still to do first. */
  readonly steps: RowStepList | null;
  readonly windows: number;
  readonly links: boolean;
}

/**
 * Everything a row shows besides its words, decided in one place. A row
 * shows its words and one quiet line; the rest appears once it is set, and
 * the lists only while the row is open.
 */
export interface RowParts {
  /** At most three, most telling first: due, step progress, linked windows, pins. */
  readonly badges: readonly RowBadge[];
  /** A file without a source carries its badges on its name's line; every other row on its source line. */
  readonly badgesOn: "source" | "file";
  /** Null while the row is closed. */
  readonly open: RowOpen | null;
  /** The first attachments as tiles, open or closed, and how many more only details show; null when the item has none. */
  readonly strip: RowList | null;
}

/** How much of each part an open row shows: the picture's height in pixels, the words' lines before Show more, and how many pins and steps it lists. */
export const ROW_CAPS = {
  description: 10,
  picture: 192,
  pins: 3,
  steps: 5,
  title: 3,
  words: 10,
} as const;

const MAX_BADGES = 3;

/** An open text row's links take one line each once its description passes this many lines. */
export const LINKS_FOLD_AFTER = 3;

/** A window's thumbnail with the gap after it, and the "+N" after the last one with its gap, in pixels (item-meta.tsx WindowStrip). */
const WINDOW_STEP = 48 + 6;
const WINDOW_MORE = 44 + 6;

/** How many linked windows fit on the open row's one line of thumbnails `width` wide, leaving room for "+N" when some don't. */
export const windowsThatFit = (width: number, total: number): number => {
  const all = Math.floor((width + 6) / WINDOW_STEP);

  return total <= all
    ? total
    : Math.max(0, Math.floor((width + 6 - WINDOW_MORE) / WINDOW_STEP));
};

/** How many attachments a row shows as tiles; the rest are a "+N" that opens details. */
export const ROW_STRIP_MAX = 3;

const rowList = (count: number, max: number): RowList | null =>
  count === 0
    ? null
    : { more: Math.max(0, count - max), shown: Math.min(count, max) };

/** Steps that hold words; an empty one being typed doesn't count. */
export const filledSteps = (steps: readonly Step[]): readonly Step[] =>
  steps.filter((step) => step.text.trim() !== "");

/** The ids of the checked steps, as the open row takes them when it opens. */
export const checkedSteps = (steps: readonly Step[]): ReadonlySet<string> =>
  new Set(steps.flatMap((step) => (step.done ? [step.id] : [])));

/**
 * The steps an open row lists, first to last: those still to do when it
 * opened, then those checked by then, each group in its stored order, so
 * what its cap leaves out is done work before open work. A step ticked in
 * the open row stays where it is until the row opens again, so nothing
 * moves under the pointer or the keyboard.
 */
export const rowSteps = (
  steps: readonly Step[],
  checkedAtOpen: ReadonlySet<string>
): readonly Step[] => {
  const filled = filledSteps(steps);

  return [
    ...filled.filter((step) => !checkedAtOpen.has(step.id)),
    ...filled.filter((step) => checkedAtOpen.has(step.id)),
  ];
};

const labelledPins = (item: ShelfItem): number =>
  item.kind === "image"
    ? item.pins.filter((pin) => pin.label !== undefined).length
    : 0;

const badgesOf = (item: ShelfItem, open: boolean): readonly RowBadge[] => {
  const steps = filledSteps(item.steps);
  const pins = item.kind === "image" ? item.pins.length : 0;
  const badges: RowBadge[] = [];

  if (item.due !== null) {
    badges.push({ due: item.due, kind: "due" });
  }

  // An open row lists its steps and windows, so it leaves out their counts.
  if (!open && steps.length > 0) {
    badges.push({
      done: steps.filter((step) => step.done).length,
      kind: "steps",
      total: steps.length,
    });
  }

  if (!open && item.windows.length > 0) {
    badges.push({ count: item.windows.length, kind: "windows" });
  }

  // An open row with labelled pins lists them, so it leaves out their count too.
  if (pins > 0 && !(open && labelledPins(item) > 0)) {
    badges.push({ count: pins, kind: "pins" });
  }

  return badges.slice(0, MAX_BADGES);
};

const stepList = (
  steps: readonly Step[],
  checkedAtOpen: ReadonlySet<string>
): RowStepList | null => {
  const listed = rowSteps(steps, checkedAtOpen);
  const rest = listed.slice(ROW_CAPS.steps);

  return listed.length === 0
    ? null
    : {
        more: rest.length,
        moreDone: rest.filter((step) => step.done).length,
        shown: listed.slice(0, ROW_CAPS.steps),
      };
};

const openOf = (
  item: ShelfItem,
  checkedAtOpen: ReadonlySet<string>
): RowOpen => ({
  description: item.description.trim() !== "",
  links: item.kind === "text" && item.links.length > 0,
  pins: rowList(labelledPins(item), ROW_CAPS.pins),
  steps: stepList(item.steps, checkedAtOpen),
  windows: item.windows.length,
});

/** `checkedAtOpen`: the steps checked when the row opened (checkedSteps), which the row lists last. */
export const rowParts = (
  item: ShelfItem,
  open: boolean,
  checkedAtOpen: ReadonlySet<string> = checkedSteps(item.steps)
): RowParts => ({
  badges: badgesOf(item, open),
  badgesOn: item.kind === "file" && item.context === null ? "file" : "source",
  open: open ? openOf(item, checkedAtOpen) : null,
  strip: rowList(item.attachments.length, ROW_STRIP_MAX),
});

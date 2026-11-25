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

/** What an open row lists under its words, each only once it is set: how many of each, 0 for none. How many show is the row's budget (open-row.ts). */
export interface RowExtras {
  /** The labelled pins. */
  readonly pinLegend: number;
  readonly description: boolean;
  /** Steps that hold words. */
  readonly steps: number;
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
  readonly extras: RowExtras | null;
  /** The first attachments as tiles, open or closed, and how many more only details show; null when the item has none. */
  readonly strip: RowList | null;
}

const MAX_BADGES = 3;

/** How many linked windows the open row's strip shows; it says "+N" for the rest itself. */
export const ROW_WINDOWS = 3;

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
 * opened, then those checked by then, each group in its stored order. How
 * many show is the row's budget, so what it cuts is done work before open
 * work. A step ticked in the open row stays where it is until the row opens
 * again, so nothing moves under the pointer or the keyboard.
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

const extrasOf = (item: ShelfItem): RowExtras => ({
  description: item.description.trim() !== "",
  links: item.kind === "text" && item.links.length > 0,
  pinLegend: labelledPins(item),
  steps: filledSteps(item.steps).length,
  windows: item.windows.length,
});

export const rowParts = (item: ShelfItem, open: boolean): RowParts => ({
  badges: badgesOf(item, open),
  badgesOn: item.kind === "file" && item.context === null ? "file" : "source",
  extras: open ? extrasOf(item) : null,
  strip: rowList(item.attachments.length, ROW_STRIP_MAX),
});

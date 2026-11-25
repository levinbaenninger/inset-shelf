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

/** What an open row lists under its words, each only once it is set; null where there is nothing. */
export interface RowExtras {
  /** The labelled pins. */
  readonly pinLegend: RowList | null;
  readonly description: boolean;
  readonly steps: RowList | null;
  readonly windows: RowList | null;
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
}

const MAX_BADGES = 3;

/** How much of each list an open row shows, so one item never fills the shelf; details show all of it. */
const ROW_LIST_MAX = { pins: 3, steps: 5, windows: 6 } as const;

const rowList = (count: number, max: number): RowList | null =>
  count === 0
    ? null
    : { more: Math.max(0, count - max), shown: Math.min(count, max) };

/** Steps that hold words; an empty one being typed doesn't count. */
export const filledSteps = (steps: readonly Step[]): readonly Step[] =>
  steps.filter((step) => step.text.trim() !== "");

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

  if (pins > 0) {
    badges.push({ count: pins, kind: "pins" });
  }

  return badges.slice(0, MAX_BADGES);
};

const extrasOf = (item: ShelfItem): RowExtras => ({
  description: item.description.trim() !== "",
  links: item.kind === "text" && item.links.length > 0,
  pinLegend: rowList(
    item.kind === "image"
      ? item.pins.filter((pin) => pin.label !== undefined).length
      : 0,
    ROW_LIST_MAX.pins
  ),
  steps: rowList(filledSteps(item.steps).length, ROW_LIST_MAX.steps),
  windows: rowList(item.windows.length, ROW_LIST_MAX.windows),
});

export const rowParts = (item: ShelfItem, open: boolean): RowParts => ({
  badges: badgesOf(item, open),
  badgesOn: item.kind === "file" && item.context === null ? "file" : "source",
  extras: open ? extrasOf(item) : null,
});

const MORE_NAMES = [
  { key: "pinLegend", many: "pins", one: "pin" },
  { key: "steps", many: "steps", one: "step" },
  { key: "windows", many: "windows", one: "window" },
] as const;

/** What only details show of an open row's lists, in one line: "27 more pins · 15 more steps", or null. */
export const moreText = (extras: RowExtras): string | null => {
  const parts = MORE_NAMES.flatMap(({ key, many, one }) => {
    const more = extras[key]?.more ?? 0;

    return more === 0 ? [] : [`${more} more ${more === 1 ? one : many}`];
  });

  return parts.length === 0 ? null : parts.join(" · ");
};

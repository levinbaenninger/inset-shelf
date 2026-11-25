import type { ShelfItem, Step } from "@shared/shelf";

/** A metadata badge on a row's quiet line. */
export type RowBadge =
  | { readonly kind: "due"; readonly due: string }
  | { readonly kind: "steps"; readonly done: number; readonly total: number }
  | { readonly kind: "windows"; readonly count: number }
  | { readonly kind: "pins"; readonly count: number };

/** What an open row lists under its words, each only once it is set. */
export interface RowExtras {
  readonly pinLegend: boolean;
  readonly description: boolean;
  readonly steps: boolean;
  readonly windows: boolean;
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
  pinLegend:
    item.kind === "image" && item.pins.some((pin) => pin.label !== undefined),
  steps: filledSteps(item.steps).length > 0,
  windows: item.windows.length > 0,
});

export const rowParts = (item: ShelfItem, open: boolean): RowParts => ({
  badges: badgesOf(item, open),
  badgesOn: item.kind === "file" && item.context === null ? "file" : "source",
  extras: open ? extrasOf(item) : null,
});

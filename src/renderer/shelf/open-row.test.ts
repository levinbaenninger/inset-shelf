import { describe, expect, it } from "vitest";

import {
  cutParts,
  fitOpenRow,
  keptBudget,
  moreText,
  ROW_CAPS,
  rowHeight,
  stepHeights,
} from "./open-row";
import type { RowBudget, RowMeasure } from "./open-row";

const LINE = 20;

const text = (lines: number) => ({
  gap: 6,
  height: lines * LINE,
  line: LINE,
  lines,
});

/** The crowded picture row: 30 labelled pins, 20 steps, 10 windows, a long title and caption. */
const CROWDED: RowMeasure = {
  budget: 10_000,
  moreAnyway: true,
  moreLine: 30,
  pin: { between: 4, gap: 8, height: 22 },
  pinCount: 30,
  picture: { gap: 0, height: 240 },
  rest: 80,
  showMore: 22,
  steps: { gap: 8, heights: [40, 24, 24, 24, 24] },
  text: { description: text(6), title: text(5), words: text(8) },
  windows: { gap: 8, height: 32 },
};

const fitIn = (budget: number): RowBudget => fitOpenRow({ ...CROWDED, budget });

describe(fitOpenRow, () => {
  it("keeps every cap while the row fits", () => {
    expect(fitIn(10_000)).toStrictEqual(ROW_CAPS);
  });

  it("gives way in order: the picture's height, pin labels, steps, the windows, the words, then the description", () => {
    const full = rowHeight(CROWDED, ROW_CAPS);

    // Just too tall: the picture gives the first room.
    expect(fitIn(full - 10)).toStrictEqual({ ...ROW_CAPS, picture: 176 });
    // The picture at its floor, then the pins.
    expect(fitIn(full - 80).pins).toBe(2);
    expect(fitIn(full - 80).picture).toBe(128);
    expect(fitIn(full - 220)).toMatchObject({
      picture: 128,
      pins: 1,
      steps: 2,
    });
  });

  it("never takes the title under three lines or the description under two", () => {
    expect(fitIn(0)).toStrictEqual({
      description: 2,
      picture: 128,
      pins: 1,
      steps: 2,
      title: 3,
      windows: false,
      words: 3,
    });
  });

  it("cuts only parts that would hide two lines or more", () => {
    const short = { ...CROWDED, text: { title: text(4), words: text(5) } };

    expect(cutParts(short, ROW_CAPS)).toStrictEqual([]);
    expect(cutParts(short, { ...ROW_CAPS, words: 3 })).toStrictEqual(["words"]);
  });
});

describe(stepHeights, () => {
  it("estimates a step not shown as tall as the tallest seen, so the estimate only grows", () => {
    const seen = new Map<string, number>();

    expect(
      stepHeights(["a", "b", "c"], new Map([["a", 40]]), seen, 24)
    ).toStrictEqual([40, 40, 40]);
    expect(
      stepHeights(["a", "b", "c"], new Map([["b", 24]]), seen, 24)
    ).toStrictEqual([40, 24, 40]);
  });
});

/**
 * A row as the page would measure it after rendering `budget`: steps not
 * shown are estimated (stepHeights), the rest is what it is. Show more opened
 * makes the words whole but measures the same.
 */
const STEP_TRUE = [24, 24, 60, 24, 24];
const IDS = ["s1", "s2", "s3", "s4", "s5"];

/** The row's rest as the page reads it: the row's height less every part as rendered, Show more opened or not. */
const restAsRead = (budget: RowBudget, expanded: boolean): number => {
  const parts = Object.values(CROWDED.text).map((part) =>
    expanded || part.lines < budget.words + 2
      ? part.gap + part.height
      : part.gap + budget.words * part.line
  );

  const row = CROWDED.rest + parts.reduce((sum, each) => sum + each, 0);

  return row - parts.reduce((sum, each) => sum + each, 0);
};

const measureAfter = (
  budget: RowBudget,
  expanded: boolean,
  list: number,
  seen: Map<string, number>
): RowMeasure => ({
  ...CROWDED,
  budget: 0.6 * list,
  rest: restAsRead(budget, expanded),
  steps: {
    gap: 8,
    heights: stepHeights(
      IDS,
      new Map(
        IDS.slice(0, budget.steps).map((id, index) => [
          id,
          STEP_TRUE[index] ?? 0,
        ])
      ),
      seen,
      24
    ),
  },
});

describe("an open row settling", () => {
  it("settles within three passes after every change, with Show more opened and closed while the list shrinks", () => {
    const seen = new Map<string, number>();
    let budget = ROW_CAPS;
    let worst = 0;

    for (const list of [1400, 1200, 1100, 1000, 900, 800, 700, 600, 500]) {
      // Show more opened or closed makes the words whole or cut: the measure doesn't change, so neither does the fit.
      for (const expanded of [false, true, false]) {
        let passes = 0;

        for (;;) {
          const next = keptBudget(
            budget,
            fitOpenRow(measureAfter(budget, expanded, list, seen))
          );

          passes += 1;

          if (next === budget || passes > 10) {
            break;
          }

          budget = next;
        }

        worst = Math.max(worst, passes);
      }
    }

    expect(worst).toBeLessThanOrEqual(3);
  });
});

describe(moreText, () => {
  it("sums what the lists leave out in one line", () => {
    expect(moreText({ pins: 27, steps: 15, windows: 10 })).toBe(
      "27 more pins · 15 more steps · 10 windows"
    );
    expect(moreText({ pins: 0, steps: 1, windows: 0 })).toBe("1 more step");
    expect(moreText({ pins: 0, steps: 0, windows: 0 })).toBeNull();
  });
});

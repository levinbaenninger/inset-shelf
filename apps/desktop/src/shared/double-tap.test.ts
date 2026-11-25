import { describe, expect, it } from "vitest";

import { INITIAL_TAP_STATE, stepTap } from "./double-tap";
import type { TapKeyEvent } from "./double-tap";

type Step = [type: TapKeyEvent["type"], key: TapKeyEvent["key"], at: number];

/** Returns the times at which the detector fired. */
const run = (steps: readonly Step[]): number[] => {
  let state = INITIAL_TAP_STATE;
  const fired: number[] = [];

  for (const [type, key, at] of steps) {
    const next = stepTap(state, { at, key, type });

    ({ state } = next);

    if (next.fired) {
      fired.push(at);
    }
  }

  return fired;
};

const tap = (
  key: "leftShift" | "rightShift",
  at: number,
  hold = 60
): Step[] => [
  ["down", key, at],
  ["up", key, at + hold],
];

describe(stepTap, () => {
  it("fires on the release of a second quick tap", () => {
    expect(
      run([...tap("leftShift", 0), ...tap("leftShift", 180)])
    ).toStrictEqual([240]);
  });

  it("fires for the right Shift and for one tap on each side", () => {
    expect(
      run([...tap("rightShift", 0), ...tap("rightShift", 150)])
    ).toHaveLength(1);
    expect(
      run([...tap("leftShift", 0), ...tap("rightShift", 150)])
    ).toHaveLength(1);
  });

  it("ignores Shift used to type capitals or extend a selection", () => {
    expect(
      run([
        ["down", "leftShift", 0],
        ["down", "other", 30],
        ["up", "other", 50],
        ["up", "leftShift", 70],
        ["down", "leftShift", 150],
        ["down", "other", 170],
        ["up", "other", 190],
        ["up", "leftShift", 210],
      ])
    ).toStrictEqual([]);
  });

  it("ignores a held Shift and taps too far apart", () => {
    expect(
      run([...tap("leftShift", 0, 400), ...tap("leftShift", 500)])
    ).toStrictEqual([]);
    expect(
      run([...tap("leftShift", 0), ...tap("leftShift", 600)])
    ).toStrictEqual([]);
  });

  it("resets when another key is pressed between the taps", () => {
    expect(
      run([
        ...tap("leftShift", 0),
        ["down", "other", 100],
        ["up", "other", 120],
        ...tap("leftShift", 160),
      ])
    ).toStrictEqual([]);
  });

  it("does not fire a third time from a triple tap", () => {
    expect(
      run([
        ...tap("leftShift", 0),
        ...tap("leftShift", 150),
        ...tap("leftShift", 300),
      ])
    ).toStrictEqual([210]);
  });

  it("ignores both Shift keys held together", () => {
    expect(
      run([
        ["down", "leftShift", 0],
        ["down", "rightShift", 20],
        ["up", "rightShift", 40],
        ["up", "leftShift", 60],
        ...tap("leftShift", 150),
      ])
    ).toStrictEqual([]);
  });
});

import { describe, expect, it } from "vitest";

import { AFTER_HOVER_MS, INITIAL_PILL, NOTICE_MS, stepPill } from "./pill";
import type { PillEffect, PillEvent, PillState } from "./pill";
import { ItemIdSchema } from "./shelf";

const ITEM = ItemIdSchema.parse("00000000-0000-4000-8000-000000000001");

const CAPTURED: PillEvent = {
  item: ITEM,
  text: "the selection",
  title: "Saved to Inbox",
  type: "captured",
};

/** Runs the events from the start and gives the last state and every effect, in order. */
const run = (events: readonly PillEvent[], from: PillState = INITIAL_PILL) => {
  let state = from;
  const effects: PillEffect[] = [];

  for (const event of events) {
    const step = stepPill(state, event);

    ({ state } = step);
    effects.push(...step.effects);
  }

  return { effects, state };
};

const types = (effects: readonly PillEffect[]): readonly string[] =>
  effects.map((effect) => effect.type);

describe("the capture notice", () => {
  it("shows beside the pointer, lets clicks through and hides after its time", () => {
    const { effects, state } = run([CAPTURED]);

    expect(effects).toStrictEqual([
      { take: false, type: "clicks" },
      {
        at: "pointer",
        type: "show",
        view: {
          kind: "notice",
          seq: 1,
          title: "Saved to Inbox",
          tone: "done",
          why: false,
        },
      },
      { ms: NOTICE_MS, seq: 1, type: "timer" },
    ]);
    expect(
      types(stepPill(state, { seq: 1, type: "timeout" }).effects)
    ).toContain("hide");
  });

  it("stays while the pointer is on it, takes its click, and hides soon after the pointer leaves", () => {
    const on = run([CAPTURED, { on: true, type: "hover" }]);

    expect(on.effects.slice(-2)).toStrictEqual([
      { type: "stopTimer" },
      { take: true, type: "clicks" },
    ]);

    const off = run([{ on: false, type: "hover" }], on.state);

    expect(off.effects).toStrictEqual([
      { take: false, type: "clicks" },
      { ms: AFTER_HOVER_MS, seq: 1, type: "timer" },
    ]);
  });

  it("opens the shelf at its item on a click, once", () => {
    const { effects } = run([
      CAPTURED,
      { seq: 1, type: "opened" },
      { seq: 1, type: "opened" },
    ]);

    expect(
      effects.filter((effect) => effect.type === "openShelf")
    ).toStrictEqual([{ item: ITEM, type: "openShelf" }]);
  });

  it("opens the shelf at nothing from a plain notice", () => {
    const { effects } = run([
      { title: "Copied", tone: "done", type: "notified" },
      { seq: 1, type: "opened" },
    ]);

    expect(effects.at(-1)).toStrictEqual({ item: null, type: "openShelf" });
  });

  it("ignores a late click or timer meant for a notice a newer one replaced", () => {
    const { effects, state } = run([
      CAPTURED,
      { title: "Copied", tone: "done", type: "notified" },
      { seq: 1, type: "opened" },
      { seq: 1, type: "timeout" },
    ]);

    expect(types(effects)).not.toContain("openShelf");
    expect(types(effects)).not.toContain("hide");
    expect(state.shown.kind).toBe("notice");
  });

  it("ignores the pointer while nothing shows", () => {
    expect(run([{ on: true, type: "hover" }]).effects).toStrictEqual([]);
  });

  it("hides when the shelf shows", () => {
    const { state, effects } = run([CAPTURED, { type: "shelfShown" }]);

    expect(state.shown.kind).toBe("hidden");
    expect(types(effects)).toContain("hide");
  });

  it("draws a failure in its own tone", () => {
    const { effects } = run([
      { title: "Couldn't copy", tone: "failed", type: "notified" },
    ]);

    expect(effects[1]).toMatchObject({ view: { tone: "failed", why: false } });
  });
});

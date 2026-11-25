import { describe, expect, it } from "vitest";

import { rect } from "./geometry";
import {
  AFTER_HOVER_MS,
  holdsKeys,
  IDLE_WHY_MS,
  INITIAL_PILL,
  NOTICE_MS,
  offerOf,
  RECALL_MS,
  SAVED_MS,
  secondTap,
  stepPill,
  TAKE_KEYS_MS,
  WHY_GONE,
  withWhy,
} from "./pill";
import type { PillEffect, PillEvent, PillState } from "./pill";
import { placeOf } from "./recall";
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
          why: true,
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
    ).toStrictEqual([{ field: null, item: ITEM, type: "openShelf" }]);
  });

  it("opens the shelf at nothing from a plain notice", () => {
    const { effects } = run([
      { title: "Copied", tone: "done", type: "notified" },
      { seq: 1, type: "opened" },
    ]);

    expect(effects.at(-1)).toStrictEqual({
      field: null,
      item: null,
      type: "openShelf",
    });
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

describe(secondTap, () => {
  const offer = { item: ITEM, text: "the selection" };

  it.each([
    ["the same text again", offer, "the selection", "why"],
    ["the same text, spaced differently", offer, " the selection\n", "why"],
    ["nothing selected", offer, null, "why"],
    ["other text: a quick second capture", offer, "another line", "capture"],
    ["text with no notice showing", null, "the selection", "capture"],
    ["nothing with no notice showing", null, null, "toggle"],
  ] as const)("%s → %s", (_, given, text, expected) => {
    expect(
      secondTap(
        given,
        text === null ? { kind: "none" } : { kind: "text", text }
      )
    ).toBe(expected);
  });
});

describe(withWhy, () => {
  it("is the why alone on an empty description and its own line after one", () => {
    expect(withWhy("", "because")).toBe("because");
    expect(withWhy("  ", "because")).toBe("because");
    expect(withWhy("Earlier note\n", "because")).toBe("Earlier note\nbecause");
  });
});

/** A capture notice, then its why field asked for and ready: seq 2. */
const OPEN_FIELD: readonly PillEvent[] = [
  CAPTURED,
  { seq: 1, type: "whyAsked" },
  { seq: 2, type: "whyReady" },
];

describe("the why field", () => {
  it("is offered by a capture notice only", () => {
    expect(run([CAPTURED]).effects[1]).toMatchObject({ view: { why: true } });
    expect(offerOf(run([CAPTURED]).state)).toStrictEqual({
      item: ITEM,
      seq: 1,
      text: "the selection",
    });

    const plain = run([{ title: "Copied", tone: "done", type: "notified" }]);

    expect(plain.effects[1]).toMatchObject({ view: { why: false } });
    expect(offerOf(plain.state)).toBeNull();
    expect(
      run([{ seq: 1, type: "whyAsked" }], plain.state).effects
    ).toStrictEqual([]);
  });

  it("takes the keyboard where the notice was and gives itself a moment to get it", () => {
    const { effects, state } = run([CAPTURED, { seq: 1, type: "whyAsked" }]);

    expect(effects.slice(3)).toStrictEqual([
      { type: "stopTimer" },
      { take: true, type: "clicks" },
      {
        at: "same",
        type: "show",
        view: { kind: "why", phase: "taking", seq: 2 },
      },
      { type: "takeKeys" },
      { ms: TAKE_KEYS_MS, seq: 2, type: "timer" },
    ]);
    expect(holdsKeys(state)).toBeTruthy();
  });

  it("ignores a Why click meant for an older notice", () => {
    const { effects } = run([CAPTURED, CAPTURED, { seq: 1, type: "whyAsked" }]);

    expect(types(effects)).not.toContain("takeKeys");
  });

  it("opens the shelf at the description when the keyboard never came", () => {
    const { effects, state } = run([
      CAPTURED,
      { seq: 1, type: "whyAsked" },
      { seq: 2, type: "timeout" },
    ]);

    const after = effects.slice(8);

    expect(after[0]).toStrictEqual({ type: "giveKeys" });
    expect(after.at(-1)).toStrictEqual({
      field: "description",
      item: ITEM,
      type: "openShelf",
    });
    expect(state.shown.kind).toBe("hidden");
  });

  it("never opens the shelf once the keyboard came", () => {
    const { effects } = run([...OPEN_FIELD, { seq: 2, type: "timeout" }]);

    expect(types(effects)).not.toContain("openShelf");
  });

  it("shows its caret once ready, and gives the keyboard back when left empty", () => {
    const ready = run(OPEN_FIELD);

    expect(ready.effects.slice(-2)).toStrictEqual([
      {
        at: "same",
        type: "show",
        view: { kind: "why", phase: "typing", seq: 2 },
      },
      { ms: IDLE_WHY_MS, seq: 2, type: "timer" },
    ]);

    const idle = run([{ seq: 2, type: "timeout" }], ready.state);

    expect(types(idle.effects)).toStrictEqual([
      "giveKeys",
      "hide",
      "stopTimer",
    ]);
  });

  it("waits without a limit once it holds words", () => {
    const { effects, state } = run([
      ...OPEN_FIELD,
      { seq: 2, text: "half a", type: "whyInput" },
    ]);

    expect(effects.at(-1)).toStrictEqual({ type: "stopTimer" });
    expect(holdsKeys(state)).toBeTruthy();

    const emptied = run([{ seq: 2, text: "", type: "whyInput" }], state);

    expect(emptied.effects).toStrictEqual([
      { ms: IDLE_WHY_MS, seq: 2, type: "timer" },
    ]);
  });

  it("writes trimmed words on Return, then gives the keyboard back first and says so briefly", () => {
    const { effects, state } = run([
      ...OPEN_FIELD,
      { seq: 2, text: "  because the API changes  ", type: "whySaved" },
      {
        outcome: { kind: "saved" },
        seq: 2,
        text: "because the API changes",
        type: "whyStored",
      },
    ]);

    expect(effects.slice(-7)).toStrictEqual([
      { type: "stopTimer" },
      {
        at: "same",
        type: "show",
        view: { kind: "why", phase: "saving", seq: 2 },
      },
      { item: ITEM, seq: 2, text: "because the API changes", type: "saveWhy" },
      { type: "giveKeys" },
      { take: false, type: "clicks" },
      {
        at: "same",
        type: "show",
        view: { kind: "why", phase: "saved", seq: 2 },
      },
      { ms: SAVED_MS, seq: 2, type: "timer" },
    ]);
    expect(holdsKeys(state)).toBeFalsy();
    expect(types(run([{ seq: 2, type: "timeout" }], state).effects)).toContain(
      "hide"
    );
  });

  it("says Why saved only once the disk holds the words, keeping the keyboard while they are written", () => {
    const saving = run([
      ...OPEN_FIELD,
      { seq: 2, text: "because", type: "whySaved" },
    ]);

    expect(saving.effects.slice(-2)).toStrictEqual([
      {
        at: "same",
        type: "show",
        view: { kind: "why", phase: "saving", seq: 2 },
      },
      { item: ITEM, seq: 2, text: "because", type: "saveWhy" },
    ]);
    expect(holdsKeys(saving.state)).toBeTruthy();

    const stored = run(
      [
        {
          outcome: { kind: "saved" },
          seq: 2,
          text: "because",
          type: "whyStored",
        },
      ],
      saving.state
    );

    expect(stored.effects[0]).toStrictEqual({ type: "giveKeys" });
    expect(stored.effects).toContainEqual({
      at: "same",
      type: "show",
      view: { kind: "why", phase: "saved", seq: 2 },
    });
    expect(holdsKeys(stored.state)).toBeFalsy();
  });

  it("keeps the typed words and says why when they couldn't be written, and Return tries again", () => {
    const failed = run([
      ...OPEN_FIELD,
      { seq: 2, text: "because", type: "whySaved" },
      {
        outcome: { kind: "failed", message: "The disk is full." },
        seq: 2,
        text: "because",
        type: "whyStored",
      },
    ]);

    expect(failed.effects.at(-2)).toStrictEqual({
      at: "same",
      type: "show",
      view: {
        kind: "why",
        phase: "typing",
        problem: "The disk is full.",
        seq: 2,
      },
    });
    expect(failed.state.shown).toMatchObject({
      phase: "typing",
      text: "because",
    });
  });

  it("tries again on Return after the words couldn't be written, still holding the keyboard", () => {
    const failed = run([
      ...OPEN_FIELD,
      { seq: 2, text: "because", type: "whySaved" },
      {
        outcome: { kind: "failed", message: "The disk is full." },
        seq: 2,
        text: "because",
        type: "whyStored",
      },
    ]);

    expect(holdsKeys(failed.state)).toBeTruthy();
    expect(
      run([{ seq: 2, text: "because", type: "whySaved" }], failed.state).effects
    ).toContainEqual({ item: ITEM, seq: 2, text: "because", type: "saveWhy" });
  });

  it("says the item is gone, and gives the keyboard back, when it was deleted meanwhile", () => {
    const { effects, state } = run([
      ...OPEN_FIELD,
      { seq: 2, text: "because", type: "whySaved" },
      { outcome: { kind: "gone" }, seq: 2, text: "because", type: "whyStored" },
    ]);

    expect(effects.at(-4)).toStrictEqual({ type: "giveKeys" });
    expect(state.shown).toMatchObject({
      kind: "notice",
      tone: "failed",
      title: WHY_GONE,
    });
  });

  it("says in a notice, with the words, that a why saved on the way out couldn't be written", () => {
    const { effects } = run([
      ...OPEN_FIELD,
      { seq: 2, text: "half a thought", type: "whyInput" },
      { type: "blurred" },
      {
        outcome: { kind: "failed", message: "The disk is full." },
        seq: 2,
        text: "half a thought",
        type: "whyStored",
      },
    ]);

    expect(effects).toContainEqual({
      at: "pointer",
      type: "show",
      view: {
        kind: "notice",
        seq: 3,
        title: "“half a thought” wasn’t saved. The disk is full.",
        tone: "failed",
        why: false,
      },
    });
  });

  it("lets go of the keyboard once, and saves once, when the user leaves while the words are written", () => {
    const saving = run([
      ...OPEN_FIELD,
      { seq: 2, text: "because", type: "whySaved" },
    ]);

    for (const event of [
      { type: "blurred" },
      { type: "shelfShown" },
    ] as const) {
      const left = run([event], saving.state);

      expect(types(left.effects)).toStrictEqual([
        "giveKeys",
        "hide",
        "stopTimer",
      ]);
      expect(holdsKeys(left.state)).toBeFalsy();
    }
  });

  it("saves nothing on Return with nothing typed", () => {
    const { effects, state } = run([
      ...OPEN_FIELD,
      { seq: 2, text: "   ", type: "whySaved" },
    ]);

    expect(types(effects)).not.toContain("saveWhy");
    expect(state.shown.kind).toBe("hidden");
  });

  it("throws the words away on Esc", () => {
    const { effects, state } = run([
      ...OPEN_FIELD,
      { seq: 2, text: "never mind", type: "whyInput" },
      { seq: 2, type: "whyCancelled" },
    ]);

    expect(types(effects)).not.toContain("saveWhy");
    expect(types(effects).at(-3)).toBe("giveKeys");
    expect(state.shown.kind).toBe("hidden");
  });

  it("keeps the words when the user clicks away", () => {
    const { effects, state } = run([
      ...OPEN_FIELD,
      { seq: 2, text: "half a thought", type: "whyInput" },
      { type: "blurred" },
    ]);

    expect(effects.slice(-4)).toStrictEqual([
      { type: "giveKeys" },
      { item: ITEM, seq: 2, text: "half a thought", type: "saveWhy" },
      { type: "hide" },
      { type: "stopTimer" },
    ]);
    expect(state.shown.kind).toBe("hidden");
  });

  it("saves nothing when clicked away from empty", () => {
    const { effects } = run([...OPEN_FIELD, { type: "blurred" }]);

    expect(types(effects)).not.toContain("saveWhy");
    expect(types(effects)).toContain("giveKeys");
  });

  it("ignores the keyboard leaving after Return gave it back", () => {
    const saved = run([
      ...OPEN_FIELD,
      { seq: 2, text: "because", type: "whySaved" },
      {
        outcome: { kind: "saved" },
        seq: 2,
        text: "because",
        type: "whyStored",
      },
    ]);

    expect(run([{ type: "blurred" }], saved.state).effects).toStrictEqual([]);
  });

  it("keeps a notice that arrives while it has the keyboard and shows it after", () => {
    const { effects, state } = run([
      ...OPEN_FIELD,
      { title: "Inset Shelf is up to date.", tone: "done", type: "notified" },
    ]);

    expect(effects.slice(OPEN_FIELD.length * 3 + 2)).toStrictEqual([]);
    expect(holdsKeys(state)).toBeTruthy();

    const closed = run([{ seq: 2, type: "whyCancelled" }], state);

    expect(closed.effects[0]).toStrictEqual({ type: "giveKeys" });
    expect(closed.effects).toContainEqual({
      at: "pointer",
      type: "show",
      view: {
        kind: "notice",
        seq: 3,
        title: "Inset Shelf is up to date.",
        tone: "done",
        why: false,
      },
    });
  });

  it("drops a waiting notice when the shelf shows, and keeps the words", () => {
    const { effects, state } = run([
      ...OPEN_FIELD,
      { seq: 2, text: "for the review", type: "whyInput" },
      { title: "Copied", tone: "done", type: "notified" },
      { type: "shelfShown" },
    ]);

    expect(types(effects)).not.toContain("openShelf");
    expect(effects).toContainEqual({
      item: ITEM,
      seq: 2,
      text: "for the review",
      type: "saveWhy",
    });
    expect(state.shown.kind).toBe("hidden");
  });

  it("holds the notice while a Double Shift copies, then lets it go", () => {
    const held = run([CAPTURED, { on: true, seq: 1, type: "holding" }]);

    expect(held.effects.at(-1)).toStrictEqual({ type: "stopTimer" });

    const freed = run([{ on: false, seq: 1, type: "holding" }], held.state);

    expect(freed.effects).toStrictEqual([
      { ms: AFTER_HOVER_MS, seq: 1, type: "timer" },
    ]);
  });
});

const PLACE = placeOf({
  app: "Safari",
  title: null,
  url: "https://github.com/acme/app/pull/12",
});

if (PLACE === null) {
  throw new Error("a pull request is a place");
}

const FRONT = rect<"screen">(100, 100, 800, 600);

const RECALLED: PillEvent = {
  ids: [ITEM],
  label: "GitHub · acme/app #12",
  place: PLACE,
  type: "recalled",
  window: FRONT,
};

describe("the recall pill", () => {
  it("shows in the front window's corner, without the keyboard, for a while", () => {
    const { effects } = run([RECALLED]);

    expect(effects).toStrictEqual([
      { take: false, type: "clicks" },
      {
        at: "window",
        type: "show",
        view: {
          count: 1,
          kind: "recall",
          label: "GitHub · acme/app #12",
          seq: 1,
        },
        window: FRONT,
      },
      { ms: RECALL_MS, seq: 1, type: "timer" },
    ]);
    expect(types(effects)).not.toContain("takeKeys");
  });

  it("never replaces a capture notice or the why field", () => {
    expect(run([CAPTURED, RECALLED]).state.shown.kind).toBe("notice");
    expect(run([...OPEN_FIELD, RECALLED]).state.shown.kind).toBe("why");
  });

  it("gives way to a capture, which counts as ignored", () => {
    const { effects, state } = run([RECALLED, CAPTURED]);

    expect(effects.slice(3)[0]).toStrictEqual({
      how: "ignored",
      place: PLACE,
      type: "recallEnded",
    });
    expect(state.shown.kind).toBe("notice");
  });

  it.each([
    ["a key down", { type: "keyDown" }, "ignored"],
    ["its time running out", { seq: 1, type: "timeout" }, "ignored"],
    ["the shelf showing", { type: "shelfShown" }, "ignored"],
    ["its close button", { seq: 1, type: "dismissed" }, "dismissed"],
  ] as const)("hides on %s, which ends it as %s", (_, event, how) => {
    const { effects, state } = run([RECALLED, event]);

    expect(effects.slice(3)).toStrictEqual([
      { type: "hide" },
      { type: "stopTimer" },
      { how, place: PLACE, type: "recallEnded" },
    ]);
    expect(state.shown.kind).toBe("hidden");
  });

  it("opens the shelf filtered to its items on a click", () => {
    const { effects } = run([RECALLED, { seq: 1, type: "opened" }]);

    expect(effects.slice(3)).toStrictEqual([
      { type: "hide" },
      { type: "stopTimer" },
      { how: "opened", place: PLACE, type: "recallEnded" },
      { ids: [ITEM], place: PLACE, type: "openRecall" },
    ]);
  });

  it("stays while the pointer is on it", () => {
    const { effects } = run([RECALLED, { on: true, type: "hover" }]);

    expect(effects.slice(3)).toStrictEqual([
      { type: "stopTimer" },
      { take: true, type: "clicks" },
    ]);
  });

  it("ignores keys while a capture notice shows", () => {
    expect(run([CAPTURED, { type: "keyDown" }]).state.shown.kind).toBe(
      "notice"
    );
  });
});

/** Every event, aimed at the pill showing now. */
const ALPHABET = (state: PillState): readonly PillEvent[] => [
  CAPTURED,
  { title: "Copied", tone: "done", type: "notified" },
  { on: true, type: "hover" },
  { on: false, type: "hover" },
  { seq: state.seq, type: "timeout" },
  { seq: state.seq, type: "opened" },
  { seq: state.seq, type: "whyAsked" },
  { seq: state.seq, type: "whyReady" },
  { seq: state.seq, text: "why", type: "whyInput" },
  { seq: state.seq, text: "why", type: "whySaved" },
  { seq: state.seq, type: "whyCancelled" },
  {
    outcome: { kind: "saved" },
    seq: state.seq,
    text: "why",
    type: "whyStored",
  },
  {
    outcome: { kind: "failed", message: "The disk is full." },
    seq: state.seq,
    text: "why",
    type: "whyStored",
  },
  { outcome: { kind: "gone" }, seq: state.seq, text: "why", type: "whyStored" },
  { type: "blurred" },
  { type: "shelfShown" },
  RECALLED,
  { seq: state.seq, type: "dismissed" },
  { type: "keyDown" },
];

describe("the keyboard", () => {
  it("is taken and given back in pairs, given back first, on every path of up to five events", () => {
    const problems: string[] = [];

    const walk = (state: PillState, path: readonly string[]): void => {
      if (path.length === 5) {
        return;
      }

      for (const event of ALPHABET(state)) {
        const step = stepPill(state, event);
        const kinds = types(step.effects);
        const here = [...path, event.type];
        const gives = kinds.filter((kind) => kind === "giveKeys").length;
        const takes = kinds.filter((kind) => kind === "takeKeys").length;
        const left = holdsKeys(state) && !holdsKeys(step.state);
        const came = !holdsKeys(state) && holdsKeys(step.state);

        if (left !== (gives === 1) || (left && kinds[0] !== "giveKeys")) {
          problems.push(
            `${here.join(" → ")} gave back ${gives}: ${kinds.join(", ")}`
          );
        }

        if (came !== (takes === 1)) {
          problems.push(`${here.join(" → ")} took ${takes}`);
        }

        walk(step.state, here);
      }
    };

    walk(INITIAL_PILL, []);

    expect(problems.slice(0, 5)).toStrictEqual([]);
  });
});

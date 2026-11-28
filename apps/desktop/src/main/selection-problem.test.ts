import { describe, expect, it } from "vite-plus/test";

import { INITIAL_PILL, stepPill } from "../shared/pill";
import type { PillEvent, PillState } from "../shared/pill";
import type { SelectionResult } from "./selection";
import { selectionProblem, warningToUser } from "./selection-problem";

/** A files capture whose clipboard was never put back, as at the deadline of a hold. */
const NOT_PUT_BACK: SelectionResult = {
  kind: "files",
  paths: ["/Users/me/a.pdf"],
  restored: false,
  unchecked: false,
};

const PUT_BACK: SelectionResult = { ...NOT_PUT_BACK, restored: true };

describe("the clipboard warning of a capture", () => {
  it("goes to the user as a notice when the shelf is hidden, since its banner is out of sight", () => {
    expect(warningToUser(NOT_PUT_BACK, false)).toStrictEqual({
      message: selectionProblem(NOT_PUT_BACK),
      tone: "failed",
    });
  });

  it("stays in the shelf's banner when the shelf is showing", () => {
    expect(warningToUser(NOT_PUT_BACK, true)).toBeNull();
  });

  it("is none for a clipboard put back", () => {
    expect(warningToUser(PUT_BACK, false)).toBeNull();
  });

  it("keeps a failed save's reason, saying the clipboard after it in the same notice", () => {
    const failed = {
      message: "Inset couldn't save the shelf.",
      tone: "failed",
    } as const;

    expect(warningToUser(NOT_PUT_BACK, false, failed)).toStrictEqual({
      message: `${failed.message} ${selectionProblem(NOT_PUT_BACK)}`,
      tone: "failed",
    });
  });

  it("replaces a success notice, which the shelf's items already show", () => {
    expect(
      warningToUser(NOT_PUT_BACK, false, {
        message: "Added 1 file",
        tone: "done",
      })?.message
    ).toBe(selectionProblem(NOT_PUT_BACK));
  });

  it("says a check that ran out of time as well", () => {
    const unchecked: SelectionResult = { ...PUT_BACK, unchecked: true };

    expect(warningToUser(unchecked, false)?.message).toBe(
      selectionProblem(unchecked)
    );
  });
});

/** Plays events into the toast's own reducer and gives the notice it shows last. */
const shownAfter = (events: readonly PillEvent[]): string | null => {
  let state: PillState = INITIAL_PILL;

  for (const event of events) {
    ({ state } = stepPill(state, event));
  }

  return state.shown.kind === "notice" ? state.shown.title : null;
};

describe("the toast after a hidden-shelf capture", () => {
  const warning = warningToUser(NOT_PUT_BACK, false);

  it("shows the warning, sent after the success notice, not the success notice over it", () => {
    expect(warning).not.toBeNull();

    const shown = shownAfter([
      { title: "Added 1 file", tone: "done", type: "notified" },
      {
        title: warning?.message ?? "",
        tone: warning?.tone ?? "done",
        type: "notified",
      },
    ]);

    expect(shown).toBe(selectionProblem(NOT_PUT_BACK));
  });
});

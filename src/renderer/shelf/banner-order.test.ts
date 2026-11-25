import { describe, expect, it } from "vitest";

import { bySeverity, nextNews, signature } from "./banner-order";

const KEYS = { id: "keys", text: "Allow Accessibility." } as const;
const SAVE = { id: "save", text: "The disk is full." } as const;
const PROBLEM = { id: "problem", text: "The capture failed." } as const;

describe(nextNews, () => {
  it("puts a banner that comes back after it cleared last again, as news", () => {
    const shown = nextNews([], [signature(SAVE), signature(KEYS)]);
    const cleared = nextNews(shown, [signature(KEYS)]);
    const back = nextNews(cleared, [signature(KEYS), signature(SAVE)]);

    expect({ back, cleared }).toStrictEqual({
      back: [signature(KEYS), signature(SAVE)],
      cleared: [signature(KEYS)],
    });
  });

  it("keeps the same list while nothing changes", () => {
    const news = [signature(KEYS)];

    expect(nextNews(news, [signature(KEYS)])).toBe(news);
  });
});

describe(bySeverity, () => {
  it("puts unsaved data first, then a failed capture, then a missing permission, whatever their order", () => {
    const entries = [KEYS, SAVE, PROBLEM];

    expect(
      bySeverity(entries, entries.map(signature)).map((each) => each.id)
    ).toStrictEqual(["save", "problem", "keys"]);
  });
});

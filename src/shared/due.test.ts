import { describe, expect, it } from "vitest";

import {
  dateText,
  dueBucket,
  dueChipText,
  dueFor,
  dueSuggestions,
  dueText,
  isoDay,
  isValidDay,
  matchesDue,
  parseSearch,
  weekStartDay,
} from "./due";

/** Local dates, as the shelf reads them: 2026-11-05 is a Thursday. */
const at = (day: string, hour = 12): Date => {
  const [year = 0, month = 1, date = 1] = day.split("-").map(Number);

  return new Date(year, month - 1, date, hour);
};

describe(isoDay, () => {
  it("keeps the local day just before midnight", () => {
    expect(isoDay(new Date(2026, 10, 5, 23, 59))).toBe("2026-11-05");
    expect(isoDay(new Date(2026, 10, 6, 0, 1))).toBe("2026-11-06");
  });
});

describe(isValidDay, () => {
  it("accepts real calendar days only", () => {
    expect(isValidDay("2026-02-28")).toBeTruthy();
    expect(isValidDay("2026-02-29")).toBeFalsy();
    expect(isValidDay("2028-02-29")).toBeTruthy();
    expect(isValidDay("2026-13-01")).toBeFalsy();
    expect(isValidDay("5 Nov")).toBeFalsy();
  });
});

describe(dueFor, () => {
  it("offers today and tomorrow, across a month end", () => {
    expect(dueFor("today", at("2026-11-05"))).toBe("2026-11-05");
    expect(dueFor("tomorrow", at("2026-11-30"))).toBe("2026-12-01");
  });

  it("reads this weekend as the coming Saturday, or today at the weekend", () => {
    expect(dueFor("weekend", at("2026-11-05"))).toBe("2026-11-07");
    expect(dueFor("weekend", at("2026-11-02"))).toBe("2026-11-07");
    expect(dueFor("weekend", at("2026-11-07"))).toBe("2026-11-07");
    expect(dueFor("weekend", at("2026-11-08"))).toBe("2026-11-08");
  });

  it("reads next week as the coming Monday, a week on from a Monday", () => {
    expect(dueFor("nextWeek", at("2026-11-05"))).toBe("2026-11-09");
    expect(dueFor("nextWeek", at("2026-11-08"))).toBe("2026-11-09");
    expect(dueFor("nextWeek", at("2026-11-09"))).toBe("2026-11-16");
    expect(dueFor("nextWeek", at("2026-12-28"))).toBe("2027-01-04");
  });
});

describe(dueBucket, () => {
  const now = at("2026-11-05", 23);

  it("buckets by whole local days", () => {
    expect(dueBucket("2026-11-04", now)).toBe("overdue");
    expect(dueBucket("2026-11-05", now)).toBe("today");
    expect(dueBucket("2026-11-06", now)).toBe("week");
    expect(dueBucket("2026-11-11", now)).toBe("week");
    expect(dueBucket("2026-11-12", now)).toBe("later");
  });
});

describe(dueText, () => {
  const now = at("2026-11-05");

  it.each([
    ["2026-11-05", "Today"],
    ["2026-11-06", "Tomorrow"],
    ["2026-11-04", "Yesterday"],
    ["2026-11-07", "Sat"],
    ["2026-11-11", "Wed"],
    ["2026-11-12", "Nov 12"],
    ["2027-01-20", "Jan 20, 2027"],
  ] as const)("says %s as %s in US English", (due, text) => {
    expect(dueText(due, now, "en-US")).toBe(text);
  });

  it("follows the system's language", () => {
    expect(dueText("2026-11-12", now, "en-GB")).toBe("12 Nov");
    expect(dueText("2026-11-07", now, "de-CH")).toBe("Sa");
  });
});

describe(dueChipText, () => {
  const now = at("2026-11-05");

  it("says overdue in words, not by colour alone", () => {
    expect(dueChipText("2026-11-03", now, "en-US")).toBe("Overdue · Nov 3");
    expect(dueChipText("2026-11-04", now, "en-US")).toBe("Overdue · Yesterday");
    expect(dueChipText("2026-11-05", now, "en-US")).toBe("Today");
  });
});

describe(dateText, () => {
  const now = at("2026-11-05");

  it("adds the weekday when asked, and the year only when it differs", () => {
    expect(
      dateText(at("2026-11-07"), now, { locale: "en-US", weekday: true })
    ).toBe("Sat, Nov 7");
    expect(dateText(at("2025-11-07"), now, { locale: "en-GB" })).toBe(
      "7 Nov 2025"
    );
  });
});

describe(weekStartDay, () => {
  it("starts the week on the locale's own first day", () => {
    expect(weekStartDay("en-US")).toBe(0);
    expect(weekStartDay("de-CH")).toBe(1);
    expect(weekStartDay("en-GB")).toBe(1);
    expect(weekStartDay("ar-EG")).toBe(6);
  });
});

describe(matchesDue, () => {
  const now = at("2026-11-05");

  it.each([
    ["2026-11-01", "overdue", true],
    ["2026-11-05", "overdue", false],
    ["2026-11-05", "today", true],
    ["2026-11-09", "week", true],
    ["2026-11-01", "week", true],
    ["2026-12-01", "week", false],
    [null, "any", false],
    [null, "none", true],
    ["2026-12-01", "none", false],
  ] as const)("due %s passes due:%s: %s", (due, filter, passes) => {
    expect(matchesDue(due, filter, now)).toBe(passes);
  });

  it.each([
    ["the past", "2026-11-04", ["overdue", "week", "any"]],
    ["today", "2026-11-05", ["today", "week", "any"]],
    ["in 6 days", "2026-11-11", ["week", "any"]],
    ["in 7 days", "2026-11-12", ["any"]],
  ] as const)(
    "puts a day %s in exactly the filters it belongs to",
    (_, due, filters) => {
      expect(
        (["today", "overdue", "week", "any", "none"] as const).filter(
          (filter) => matchesDue(due, filter, now)
        )
      ).toStrictEqual(filters);
    }
  );
});

describe(parseSearch, () => {
  it("takes a due filter out of the words", () => {
    expect(parseSearch("Quote  due:today chairs")).toStrictEqual({
      due: "today",
      pendingDue: null,
      terms: ["quote", "chairs"],
    });
  });

  it("holds back a due word still being typed instead of searching for it", () => {
    expect(parseSearch("chairs due:to")).toStrictEqual({
      due: null,
      pendingDue: "to",
      terms: ["chairs"],
    });
    expect(parseSearch("due:").pendingDue).toBe("");
  });
});

describe(dueSuggestions, () => {
  it("offers the filters a partial word may become", () => {
    expect(dueSuggestions("o")).toStrictEqual(["overdue"]);
    expect(dueSuggestions("")).toStrictEqual([
      "today",
      "overdue",
      "week",
      "any",
      "none",
    ]);
  });

  it("offers every filter when none fits", () => {
    expect(dueSuggestions("soon")).toHaveLength(5);
  });
});

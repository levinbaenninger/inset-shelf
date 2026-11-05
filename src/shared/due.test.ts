import { describe, expect, it } from "vitest";

import {
  dueBucket,
  dueFor,
  dueText,
  isoDay,
  isValidDay,
  matchesDue,
  parseSearch,
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
    ["2026-11-05", false, "Today"],
    ["2026-11-06", false, "Tomorrow"],
    ["2026-11-04", false, "Yesterday"],
    ["2026-11-07", false, "Sat"],
    ["2026-11-20", false, "Nov 20"],
    ["2026-11-07", true, "Sat, Nov 7"],
  ] as const)("shows %s (long: %s) as %s", (due, long, text) => {
    expect(dueText(due, now, long)).toBe(text);
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
});

describe(parseSearch, () => {
  it("takes a due filter out of the words", () => {
    expect(parseSearch("Quote  due:today chairs")).toStrictEqual({
      due: "today",
      terms: ["quote", "chairs"],
    });
  });

  it("searches an unknown due word as text", () => {
    expect(parseSearch("due:soon")).toStrictEqual({
      due: null,
      terms: ["due:soon"],
    });
  });
});

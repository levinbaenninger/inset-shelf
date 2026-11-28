import { describe, expect, it } from "vite-plus/test";

import { CodePlaceSchema, isCapturedText, textMark } from "./code-place";

describe("a stored code place", () => {
  it("keeps a whole path from the root", () => {
    expect(
      CodePlaceSchema.safeParse({
        file: "/Users/anna/p/straße.ts",
        line: null,
        root: "/Users/anna/p",
      }).success
    ).toBeTruthy();
  });

  it.each([
    ["half a character pair", "/Users/anna/p/a\uD83D.ts"],
    ["the second half of a pair alone", "/Users/anna/p/\uDE00a.ts"],
    ["a NUL", "/Users/anna/p/a\0.ts"],
  ])("refuses a path that holds %s, which no disk can name", (_, file) => {
    expect(
      CodePlaceSchema.safeParse({ file, line: null, root: null }).success
    ).toBeFalsy();
  });

  it("refuses a project folder that is not well-formed text", () => {
    expect(
      CodePlaceSchema.safeParse({
        file: "/Users/anna/p\uD83D/a.ts",
        line: null,
        root: "/Users/anna/p\uD83D",
      }).success
    ).toBeFalsy();
  });
});

describe(textMark, () => {
  it("gives the same text the same mark", () => {
    expect(textMark("retry();\n  again();")).toBe(
      textMark("retry();\n  again();")
    );
  });

  it.each([
    ["one letter changed", "retry();", "retrx();"],
    ["two letters swapped", "retry();", "rerty();"],
    ["a blank added at its end", "retry();", "retry(); "],
    ["another line ending", "a();\nb();", "a();\r\nb();"],
    ["an emoji changed", "done 😀", "done 😁"],
  ])("gives a text with %s another mark", (_, before, after) => {
    expect(textMark(after)).not.toBe(textMark(before));
  });

  it("holds nothing of the text, and is one the shelf keeps", () => {
    const place = {
      file: "/Users/anna/p/a.ts",
      line: null,
      mark: textMark("const secret = 42;".repeat(1000)),
      root: null,
    };

    expect(place.mark).toMatch(/^[0-9a-z.]{5,23}$/u);
    expect(CodePlaceSchema.parse(place)).toStrictEqual(place);
  });
});

describe(isCapturedText, () => {
  const place = { file: "/Users/anna/p/a.ts", line: null, root: null };

  it("knows the text a place was captured with, and no other", () => {
    const marked = { ...place, mark: textMark("retry();") };

    expect(isCapturedText(marked, "retry();")).toBeTruthy();
    expect(isCapturedText(marked, "other();")).toBeFalsy();
  });

  it("knows no text for a place without a mark", () => {
    expect(isCapturedText(place, "retry();")).toBeFalsy();
  });
});

import { describe, expect, it } from "vite-plus/test";

import { CodePlaceSchema } from "./code-place";

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

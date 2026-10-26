import { describe, expect, it } from "vitest";

import { withoutAppName } from "./window-title";

describe(withoutAppName, () => {
  it.each([
    ["Example Domain - Google Chrome", "Google Chrome", "Example Domain"],
    [
      "Fix the build · Pull Request #12 · a/b - Google Chrome",
      "Google Chrome",
      "Fix the build · Pull Request #12 · a/b",
    ],
    [
      "Example Domain - Microsoft\u200B Edge",
      "Microsoft Edge",
      "Example Domain",
    ],
    ["Example Domain — Mozilla Firefox", "Firefox", "Example Domain"],
    ["notes.txt - Notepad", "Notepad", "notes.txt"],
    [
      "index.ts - inset-shelf - Visual Studio Code",
      "Visual Studio Code",
      "index.ts - inset-shelf",
    ],
  ])("takes the app's name off %j", (title, app, expected) => {
    expect(withoutAppName(title, app)).toBe(expected);
  });

  it("keeps a title that is only the app's name or doesn't end in it", () => {
    expect(withoutAppName("T3 Code (Nightly)", "T3 Code (Nightly)")).toBe(
      "T3 Code (Nightly)"
    );
    expect(withoutAppName("Budget - Q4", "Excel")).toBe("Budget - Q4");
    expect(withoutAppName("Budget - Q4", null)).toBe("Budget - Q4");
  });
});

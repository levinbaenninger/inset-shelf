import { describe, expect, it } from "vite-plus/test";

import { appName, cleanTitle, withoutAppName } from "./window-title";

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

  // Read from this PC's windows (Windows 11, 2026-11-27): get-windows names Windows 11's Notepad by its program file.
  it("takes the name off a window of an app known by its program file", () => {
    expect(withoutAppName("explore-notes.txt - Notepad", "Notepad.exe")).toBe(
      "explore-notes.txt"
    );
  });

  // Edge ends every window's title with its profile, and counts the other tabs after the page's title.
  it.each([
    [
      "one tab",
      "Example Domain - Profile 1 - Microsoft\u200B Edge",
      "Example Domain",
    ],
    [
      "two tabs",
      "Example Domain and 1 more page - Profile 1 - Microsoft\u200B Edge",
      "Example Domain",
    ],
    [
      "three tabs, and a page title holding a dash",
      "Budget - Q4 and 2 more pages - Work - Microsoft\u200B Edge",
      "Budget - Q4",
    ],
  ])(
    "takes Edge's profile and other tabs off with %s",
    (_, title, expected) => {
      expect(withoutAppName(title, "Microsoft Edge")).toBe(expected);
    }
  );

  // Chrome 158 titles a window of two tabs "Example Domain - Google Chrome", as one: only Edge counts them.
  it("keeps the words of a Chrome page that read like Edge's count of tabs", () => {
    expect(
      withoutAppName(
        "Release notes and 2 more pages - Google Chrome",
        "Google Chrome"
      )
    ).toBe("Release notes and 2 more pages");
  });

  it("keeps a title that is only the app's name or doesn't end in it", () => {
    expect(withoutAppName("T3 Code (Nightly)", "T3 Code (Nightly)")).toBe(
      "T3 Code (Nightly)"
    );
    expect(withoutAppName("Budget - Q4", "Excel")).toBe("Budget - Q4");
    expect(withoutAppName("Budget - Q4", null)).toBe("Budget - Q4");
  });

  it("leaves an Edge window that isn't a browser tab, an installed app, as it is", () => {
    expect(withoutAppName("Outlook - Mail", "Microsoft Edge")).toBe(
      "Outlook - Mail"
    );
  });
});

describe(appName, () => {
  it("names an app known only by its program file without .exe", () => {
    expect(appName("Notepad.exe")).toBe("Notepad");
    expect(appName("notepad.EXE")).toBe("notepad");
  });

  it("keeps any other name", () => {
    expect(appName("Visual Studio Code")).toBe("Visual Studio Code");
    expect(appName("Microsoft Edge")).toBe("Microsoft Edge");
    expect(appName(null)).toBeNull();
  });
});

describe(cleanTitle, () => {
  it.each([
    ["Notepad's unsaved mark", "*explore-notes.txt - Notepad", "Notepad.exe"],
    ["the mark once the app's name is off", "*explore-notes.txt", "Notepad"],
    ["no mark", "explore-notes.txt - Notepad", "Notepad.exe"],
  ])("names a Notepad file the same with %s", (_, title, app) => {
    expect(cleanTitle(title, app)).toBe("explore-notes.txt");
  });

  it("names an Edge tab the same with one tab or two", () => {
    expect(
      cleanTitle(
        "Example Domain and 1 more page - Profile 1 - Microsoft\u200B Edge",
        "Microsoft Edge"
      )
    ).toBe(cleanTitle("Example Domain", "Microsoft Edge"));
  });

  it("is nothing for a title too short to name a place", () => {
    expect(cleanTitle("~", "Terminal")).toBeNull();
  });
});

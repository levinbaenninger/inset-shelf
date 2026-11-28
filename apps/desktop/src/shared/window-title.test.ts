import { describe, expect, it } from "vite-plus/test";

import {
  appName,
  cleanTitle,
  shownTitle,
  titleKeys,
  windowName,
} from "./window-title";

describe("a title read without the app's name", () => {
  it.each([
    ["Example Domain - Google Chrome", "Google Chrome", "Example Domain"],
    [
      "Fix the build · Pull Request #12 · a/b - Google Chrome",
      "Google Chrome",
      "Fix the build · Pull Request #12 · a/b",
    ],
    ["Example Domain - Microsoft​ Edge", "Microsoft Edge", "Example Domain"],
    ["Example Domain — Mozilla Firefox", "Firefox", "Example Domain"],
    ["notes.txt - Notepad", "Notepad", "notes.txt"],
    [
      "index.ts - inset-shelf - Visual Studio Code",
      "Visual Studio Code",
      "index.ts - inset-shelf",
    ],
  ])("takes the app's name off %j", (title, app, expected) => {
    expect(shownTitle(title, app)).toBe(expected);
  });

  // Read from this PC's windows (Windows 11, 2026-11-27): get-windows names Windows 11's Notepad by its program file.
  it("takes the name off a window of an app known by its program file", () => {
    expect(shownTitle("explore-notes.txt - Notepad", "Notepad.exe")).toBe(
      "explore-notes.txt"
    );
  });

  // Edge ends every browser window's title with its profile, and counts the other tabs after the page's title.
  it.each([
    [
      "one tab",
      "Example Domain - Profile 1 - Microsoft​ Edge",
      "Example Domain",
    ],
    [
      "two tabs",
      "Example Domain and 1 more page - Profile 1 - Microsoft​ Edge",
      "Example Domain",
    ],
    [
      "three tabs, and a page title holding a dash",
      "Budget - Q4 and 2 more pages - Work - Microsoft​ Edge",
      "Budget - Q4",
    ],
    [
      "a page named after Edge",
      "Edge release notes - Microsoft Edge - Profile 1 - Microsoft​ Edge",
      "Edge release notes - Microsoft Edge",
    ],
  ])(
    "takes Edge's profile and other tabs off with %s",
    (_, title, expected) => {
      expect(shownTitle(title, "Microsoft Edge")).toBe(expected);
    }
  );

  // Chrome 158 titles a window of two tabs "Example Domain - Google Chrome", as one: only Edge counts them.
  it("keeps the words of a Chrome page that read like Edge's count of tabs", () => {
    expect(
      shownTitle(
        "Release notes and 2 more pages - Google Chrome",
        "Google Chrome"
      )
    ).toBe("Release notes and 2 more pages");
  });

  it("keeps a title that doesn't end in the app's name", () => {
    expect(shownTitle("Budget - Q4", "Excel")).toBe("Budget - Q4");
    expect(shownTitle("Budget - Q4", null)).toBe("Budget - Q4");
  });

  // An installed web app is an Edge window without Edge's name, profile or count: its title is the page's own.
  it("leaves an Edge window that isn't a browser tab, an installed app, as it is", () => {
    expect(shownTitle("Outlook - Mail", "Microsoft Edge")).toBe(
      "Outlook - Mail"
    );
    expect(shownTitle("*Outlook - Mail", "Microsoft Edge")).toBe(
      "*Outlook - Mail"
    );
  });

  it("takes the profile off only after Edge's name, never from another browser", () => {
    expect(
      shownTitle("Budget - Q4 - Work - Google Chrome", "Google Chrome")
    ).toBe("Budget - Q4 - Work");
  });
});

describe(appName, () => {
  it("names Windows 11's Notepad, known by its program file, without .exe", () => {
    expect(appName("Notepad.exe")).toBe("Notepad");
    expect(appName("notepad.EXE")).toBe("Notepad");
  });

  // get-windows can name an app by its file's description: "Ledger.exe" is a name of its own, not Ledger.
  it("keeps any other name as it is, .exe too", () => {
    expect(appName("Ledger.exe")).toBe("Ledger.exe");
    expect(appName("Visual Studio Code")).toBe("Visual Studio Code");
    expect(appName("Microsoft Edge")).toBe("Microsoft Edge");
    expect(appName(null)).toBeNull();
  });
});

describe(cleanTitle, () => {
  it.each([
    ["Notepad.exe", "*recall-notes.txt - Notepad"],
    ["Notepad.exe", "recall-notes.txt - Notepad"],
    ["Notepad", "*recall-notes.txt - Notepad"],
  ])(
    "names a %s file the same with or without its unsaved mark: %j",
    (app, title) => {
      expect(cleanTitle(title, app)).toBe("recall-notes.txt");
    }
  );

  it("names an Edge tab the same with one tab or two", () => {
    expect(
      cleanTitle(
        "Example Domain and 1 more page - Profile 1 - Microsoft​ Edge",
        "Microsoft Edge"
      )
    ).toBe(cleanTitle("Example Domain", "Microsoft Edge"));
  });

  // Only Windows' Notepad marks unsaved changes first with an asterisk, and writes its name after the file's.
  it("keeps a leading asterisk where it isn't Notepad's mark", () => {
    expect(cleanTitle("*Budget.rtf", "TextEdit")).toBe("*Budget.rtf");
    expect(cleanTitle("*Budget.rtf", "Notepad")).toBe("*Budget.rtf");
    expect(cleanTitle("*Outlook - Mail", "Microsoft Edge")).toBe(
      "*Outlook - Mail"
    );
  });

  it("still drops Code's unsaved dot and a count of unread", () => {
    expect(cleanTitle("● index.ts - app - Visual Studio Code", "Code")).toBe(
      "index.ts - app - Visual Studio Code"
    );
    expect(cleanTitle("(3) Inbox", "Gmail")).toBe("Inbox");
  });

  it("is nothing for a title too short to name a place", () => {
    expect(cleanTitle("~", "Terminal")).toBeNull();
  });
});

describe(titleKeys, () => {
  // An Edge item kept by the build before this one holds "Example Domain - Profile 1": Edge's name gone, the profile still on.
  it("also names a title as the build before this one cleaned it", () => {
    const keys = titleKeys(
      "Example Domain - Profile 1 - Microsoft​ Edge",
      "Microsoft Edge"
    );

    expect(keys).toContain("Example Domain");
    expect(keys).toContain("Example Domain - Profile 1");
  });

  it("is one name for a title the app adds nothing to", () => {
    expect(titleKeys("Standup", "Notes")).toStrictEqual(["Standup"]);
  });

  it("is none for a title that names nothing", () => {
    expect(titleKeys("Slack", "Slack")).toStrictEqual([]);
    expect(titleKeys(null, "Slack")).toStrictEqual([]);
  });
});

describe(shownTitle, () => {
  it("keeps a short title, which still says what the window shows", () => {
    expect(shownTitle("Go - Notepad", "Notepad.exe")).toBe("Go");
  });

  it("is nothing for a title that only names the app", () => {
    expect(shownTitle("Notepad", "Notepad.exe")).toBeNull();
    expect(shownTitle("Slack", "Slack")).toBeNull();
  });
});

describe(windowName, () => {
  // The window link the hands-on test made from Code and Notepad (finding 18).
  it.each([
    [
      "Visual Studio Code",
      "app.ts - demo-proj - Visual Studio Code",
      "app.ts - demo-proj",
    ],
    ["Notepad.exe", "*explore-notes.txt - Notepad", "explore-notes.txt"],
  ])("names a %s window by its cleaned title", (app, title, expected) => {
    expect(windowName({ app, title })).toBe(expected);
  });

  it("falls back to the app's name, then to Window", () => {
    expect(windowName({ app: "Notepad.exe", title: null })).toBe("Notepad");
    expect(windowName({ app: "Slack", title: "Slack" })).toBe("Slack");
    expect(windowName({ app: null, title: null })).toBe("Window");
  });

  // The picker names a window by this too: a title that only names the app must not read otherwise there.
  it("names a window whose title is only an unread count and its app's name by the app", () => {
    expect(windowName({ app: "Slack", title: "(3) Slack" })).toBe("Slack");
  });
});

import { describe, expect, it, vi } from "vite-plus/test";

import { documentPath } from "./window-origin";

// Electron's native side doesn't load under Node; documentPath never touches it.
// oxlint-disable-next-line anti-slop/no-module-mocking, vitest/prefer-import-in-mock -- window-origin reads systemPreferences only when it asks a window, which these tests never do.
vi.mock("electron", () => ({ systemPreferences: {} }));

describe(documentPath, () => {
  it("makes a file address a path", () => {
    expect(documentPath("file:///Users/anna/dev/my%20proj/a%23b.ts")).toBe(
      "/Users/anna/dev/my proj/a#b.ts"
    );
  });

  it.each([
    ["a web page", "https://example.com/a.ts"],
    ["a path", "/Users/anna/a.ts"],
    ["nothing", ""],
    ["a file on another host", "file://server/share/a.ts"],
  ])("drops %s", (_, raw) => {
    expect(documentPath(raw)).toBeNull();
  });
});

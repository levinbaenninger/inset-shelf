import path from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { containedPath } from "./contained-path";

describe(containedPath, () => {
  const root = path.resolve("/tmp/Inset Shelf");

  it("joins a plain name", () => {
    expect(containedPath(root, "Report.txt")).toBe(
      path.join(root, "Report.txt")
    );
    expect(containedPath(root, "sub/Report.txt")).toBe(
      path.join(root, "sub", "Report.txt")
    );
  });

  it("refuses names that leave the folder or are the folder", () => {
    const escaped = [
      "..",
      "../evil",
      "a/../../evil",
      "/etc/passwd",
      ".",
      "",
    ].flatMap((name) => containedPath(root, name) ?? []);

    expect(escaped).toStrictEqual([]);
  });
});

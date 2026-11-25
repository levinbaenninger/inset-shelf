import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SRC = path.resolve(import.meta.dirname, "..");

/** Every way the app's code could change the clipboard, in main, a preload or a page. */
const CLIPBOARD_WRITE =
  /\bclipboard\.(?:write\w*|clear)\b|navigator\.clipboard|\.write(?:Text|Image|HTML|RTF|Bookmark|Buffer|FindText)\(|execCommand\(\s*["']copy|contents\.copy\(\)/u;

const sourceFiles = (): readonly string[] =>
  readdirSync(SRC, { encoding: "utf-8", recursive: true })
    .filter(
      (file) =>
        /\.tsx?$/u.test(file) &&
        !/\.test\.tsx?$/u.test(file) &&
        !file.endsWith(".d.ts")
    )
    .map((file) => file.split(path.sep).join("/"))
    .toSorted((a, b) => a.localeCompare(b));

describe("clipboard writers", () => {
  it("leaves every clipboard write to the copy gate", () => {
    const writers = sourceFiles().filter((file) =>
      CLIPBOARD_WRITE.test(readFileSync(path.join(SRC, file), "utf-8"))
    );

    expect(writers).toStrictEqual(["main/copy-gate.ts"]);
  });

  it("reads every source folder", () => {
    const folders = new Set(
      sourceFiles().map((file) => file.split("/")[0] ?? "")
    );

    expect([...folders].toSorted((a, b) => a.localeCompare(b))).toStrictEqual([
      "main",
      "preload",
      "renderer",
      "shared",
    ]);
  });
});

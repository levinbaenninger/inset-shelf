import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { TEXT_MAX } from "@shared/shelf";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { lineInFile } from "./code-line";
import { quietDisk } from "./quiet-disk";

// A home folder of the test's own, in a temp folder: its Documents is a folder of the test's too.
const folder = realpathSync(mkdtempSync(path.join(tmpdir(), "code-line-")));
const home = path.join(folder, "home");

const disk = quietDisk({ home });

/** A file of `count` lines, each naming its own number, with `lines` put in at their 1-based number. */
const source = (count: number, lines: Readonly<Record<number, string>> = {}) =>
  `${Array.from(
    { length: count },
    (_, index) =>
      lines[index + 1] ?? `export const value${index + 1} = ${index + 1};`
  ).join("\n")}\n`;

/** Writes `text` at `name` under the home folder: its path. */
const saved = (name: string, text: string): string => {
  const at = path.join(home, name);

  mkdirSync(path.dirname(at), { recursive: true });
  writeFileSync(at, text);

  return at;
};

const LINE_12 = "export const value12 = 12;";

/** The largest file searched for a line: 512 KB. */
const READ_MAX = 512 * 1024;

describe(lineInFile, () => {
  afterAll(() => {
    rmSync(folder, { force: true, recursive: true });
  });

  it("finds the line the captured text begins on in the saved file", async () => {
    const file = saved("dev/proj/a.ts", source(40));

    await expect(lineInFile(file, LINE_12, disk)).resolves.toBe(12);
  });

  it("finds the text again after it moved 10 lines down", async () => {
    const file = saved(
      "dev/proj/moved.ts",
      `${"// a new line above\n".repeat(10)}${source(40)}`
    );

    await expect(lineInFile(file, LINE_12, disk)).resolves.toBe(22);
  });

  it.each([
    ["in the file twice", source(40, { 30: LINE_12 })],
    ["not in the file", source(40, { 12: "// rewritten" })],
  ])("gives no line for text %s", async (_, text) => {
    const file = saved("dev/proj/b.ts", text);

    await expect(lineInFile(file, LINE_12, disk)).resolves.toBeNull();
  });

  it.each([
    ["at its start", `${LINE_12}\n${"x".repeat(READ_MAX)}`],
    ["at its end", `${"x".repeat(READ_MAX)}\n${LINE_12}\n`],
  ])(
    "gives no line in a file larger than 512 KB that holds the text %s",
    async (_, text) => {
      const file = saved("dev/proj/large.ts", text);

      await expect(lineInFile(file, LINE_12, disk)).resolves.toBeNull();
    }
  );

  it("finds a line in a file of exactly 512 KB", async () => {
    const head = `${LINE_12}\n`;

    const file = saved(
      "dev/proj/full.ts",
      `${head}${"x".repeat(READ_MAX - head.length)}`
    );

    await expect(lineInFile(file, LINE_12, disk)).resolves.toBe(1);
  });

  it("gives no line in a file under Documents, where macOS would ask for access", async () => {
    const file = saved("Documents/proj/a.ts", source(40));

    await expect(lineInFile(file, LINE_12, disk)).resolves.toBeNull();
  });

  it.each([
    ["has vanished", path.join(home, "dev/proj/gone.ts")],
    ["now holds a folder", path.join(home, "dev/proj")],
  ])("gives no line for a path that %s", async (_, file) => {
    await expect(lineInFile(file, LINE_12, disk)).resolves.toBeNull();
  });

  it("looks for no text longer than the shelf keeps", async () => {
    const long = "x".repeat(TEXT_MAX + 1);
    const file = saved("dev/proj/long.ts", `${long}\n`);

    await expect(lineInFile(file, long, disk)).resolves.toBeNull();
  });
});

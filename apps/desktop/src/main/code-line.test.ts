import type { CodePlace } from "@shared/code-place";
import { describe, expect, it } from "vite-plus/test";

import { lineInFile, lineToOpen } from "./code-line";
import type { SourceReader } from "./code-line";

const HOME = "/Users/anna";
const FILE = "/Users/anna/Developer/proj/src/a.ts";

/** A file of `count` lines, each naming its own number, with `lines` put in at their 1-based number. */
const source = (count: number, lines: Readonly<Record<number, string>> = {}) =>
  Array.from(
    { length: count },
    (_, index) =>
      lines[index + 1] ?? `export const value${index + 1} = ${index + 1};`
  ).join("\n");

/** A disk holding `files`, which notes every path it was asked to look at or read. */
const disk = (
  files: Readonly<Record<string, string>>,
  folders: readonly string[] = []
): SourceReader & { readonly looked: string[]; readonly read: string[] } => {
  const looked: string[] = [];
  const read: string[] = [];

  return {
    home: HOME,
    looked,
    platform: "darwin",
    read,
    readFile: async (file) => {
      read.push(file);
      const text = files[file];

      if (text === undefined) {
        throw Object.assign(new Error("gone"), { code: "ENOENT" });
      }

      return await Promise.resolve(text);
    },
    stat: async (file) => {
      looked.push(file);
      const text = files[file];

      if (text === undefined && !folders.includes(file)) {
        throw Object.assign(new Error("gone"), { code: "ENOENT" });
      }

      return await Promise.resolve({
        isFile: () => text !== undefined,
        size: text === undefined ? 0 : new TextEncoder().encode(text).length,
      });
    },
  };
};

const LINE_12 = "export const value12 = 12;";

describe(lineInFile, () => {
  it("finds the line the captured text begins on in the saved file", async () => {
    await expect(
      lineInFile(FILE, LINE_12, disk({ [FILE]: source(40) }))
    ).resolves.toBe(12);
  });

  it("gives no line for text that is in the file twice", async () => {
    const twice = source(40, { 12: "retry();", 30: "retry();" });

    await expect(
      lineInFile(FILE, "retry();", disk({ [FILE]: twice }))
    ).resolves.toBeNull();
  });

  it("gives no line for text that is not in the file", async () => {
    await expect(
      lineInFile(FILE, "a thought from no file", disk({ [FILE]: source(40) }))
    ).resolves.toBeNull();
  });

  it("never reads a file larger than 2 MB, even one that holds the text", async () => {
    const large = `${LINE_12}\n${"x".repeat(3 * 1024 * 1024)}`;
    const reader = disk({ [FILE]: large });

    await expect(lineInFile(FILE, LINE_12, reader)).resolves.toBeNull();
    expect(reader.read).toStrictEqual([]);
  });

  it("never looks at a file under ~/Documents, where macOS would ask for access", async () => {
    const file = "/Users/anna/Documents/proj/a.ts";
    const reader = disk({ [file]: source(40) });

    await expect(lineInFile(file, LINE_12, reader)).resolves.toBeNull();
    expect([...reader.looked, ...reader.read]).toStrictEqual([]);
  });

  it("gives no line for a file that has vanished", async () => {
    await expect(lineInFile(FILE, LINE_12, disk({}))).resolves.toBeNull();
  });

  it("reads nothing at a path that now holds a folder", async () => {
    const reader = disk({}, [FILE]);

    await expect(lineInFile(FILE, LINE_12, reader)).resolves.toBeNull();
    expect(reader.read).toStrictEqual([]);
  });

  it("gives no line for a file the system won't let it read", async () => {
    const reader: SourceReader = {
      ...disk({ [FILE]: source(40) }),
      readFile: async () =>
        await Promise.reject(
          Object.assign(new Error("no"), { code: "EACCES" })
        ),
    };

    await expect(lineInFile(FILE, LINE_12, reader)).resolves.toBeNull();
  });
});

describe(lineToOpen, () => {
  const place: CodePlace = { file: FILE, line: 12, root: null };

  it("finds the text again after it moved 10 lines down", async () => {
    const moved = source(40, { 22: LINE_12, 12: "// a new line above" });

    await expect(
      lineToOpen(place, LINE_12, disk({ [FILE]: moved }))
    ).resolves.toBe(22);
  });

  it.each([
    ["gone from the file", source(40, { 12: "// rewritten" })],
    ["in the file twice", source(40, { 30: LINE_12 })],
  ])("opens at the stored line when the text is %s", async (_, now) => {
    await expect(
      lineToOpen(place, LINE_12, disk({ [FILE]: now }))
    ).resolves.toBe(12);
  });

  it("opens at the stored line when the file has vanished", async () => {
    await expect(lineToOpen(place, LINE_12, disk({}))).resolves.toBe(12);
  });

  it("reads nothing for an item without words to look for", async () => {
    const reader = disk({ [FILE]: source(40) });

    await expect(lineToOpen(place, null, reader)).resolves.toBe(12);
    expect(reader.looked).toStrictEqual([]);
  });
});

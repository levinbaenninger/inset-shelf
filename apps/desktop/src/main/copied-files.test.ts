import { describe, expect, it } from "vite-plus/test";

import { copiedFilePaths } from "./copied-files";

const item = (data: Record<string, string>) => ({
  getType: async (type: string) =>
    await Promise.resolve(new Blob([data[type] ?? ""])),
  types: Object.keys(data),
});

const isWindows = process.platform === "win32";

describe(copiedFilePaths, () => {
  it.runIf(isWindows)(
    "reads every file Explorer copied, in order, from the URI list",
    async () => {
      await expect(
        copiedFilePaths([
          item({
            "text/uri-list":
              "file:///C:/Users/me/chart%20sample.png\r\nfile:///C:/Users/me/notes.txt",
          }),
        ])
      ).resolves.toStrictEqual([
        String.raw`C:\Users\me\chart sample.png`,
        String.raw`C:\Users\me\notes.txt`,
      ]);
    }
  );

  it.skipIf(isWindows)(
    "reads each file Finder copied, one per pasteboard item",
    async () => {
      const fileUrl =
        'electron application/osclipboard;format="public.file-url"';

      await expect(
        copiedFilePaths([
          item({
            [fileUrl]: "file:///Users/me/chart%20sample.png",
            "text/plain": "chart sample.png",
          }),
          item({ [fileUrl]: "file:///Users/me/notes.txt" }),
        ])
      ).resolves.toStrictEqual([
        "/Users/me/chart sample.png",
        "/Users/me/notes.txt",
      ]);
    }
  );

  it("skips the URI list's comments, its web addresses and repeats", async () => {
    const file = isWindows ? "file:///C:/a.txt" : "file:///a.txt";

    await expect(
      copiedFilePaths([
        item({
          "text/uri-list": `# copied\r\n${file}\r\nhttps://example.com/\r\n${file}\r\n`,
        }),
      ])
    ).resolves.toStrictEqual([isWindows ? String.raw`C:\a.txt` : "/a.txt"]);
  });

  it("is empty for a copy of text", async () => {
    await expect(
      copiedFilePaths([item({ "text/plain": "file:///C:/a.txt" })])
    ).resolves.toStrictEqual([]);
  });
});

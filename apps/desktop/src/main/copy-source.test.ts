import { describe, expect, it } from "vitest";

import { copySource, decodeSource } from "./copy-source";
import type { ClipboardEntry } from "./copy-source";

const CHROMIUM =
  'electron application/osclipboard;format="Chromium internal source URL"';

const FIREFOX = 'electron application/osclipboard;format="text/x-moz-url-priv"';

const entry = (data: Record<string, Blob>): ClipboardEntry => ({
  getType: async (type) => await Promise.resolve(data[type] ?? new Blob([])),
  types: Object.keys(data),
});

describe(decodeSource, () => {
  it("drops the closing NUL", () => {
    expect(
      decodeSource(new TextEncoder().encode("https://example.com/\0"), "utf-8")
    ).toBe("https://example.com/");
  });
});

describe(copySource, () => {
  it("reads the page Chromium noted beside the copied text", async () => {
    await expect(
      copySource([
        entry({
          [CHROMIUM]: new Blob(["https://github.com/a/b/pull/1\0"]),
          "text/plain": new Blob(["See the PR"]),
        }),
      ])
    ).resolves.toBe("https://github.com/a/b/pull/1");
  });

  it("reads Firefox's note, which is UTF-16", async () => {
    await expect(
      copySource([
        entry({
          [FIREFOX]: new Blob([
            Buffer.from("https://example.com/\0", "utf16le"),
          ]),
          "text/plain": new Blob(["Example"]),
        }),
      ])
    ).resolves.toBe("https://example.com/");
  });

  it("is empty when no browser noted a page", async () => {
    await expect(
      copySource([entry({ "text/plain": new Blob(["From Notepad"]) })])
    ).resolves.toBe("");
  });
});

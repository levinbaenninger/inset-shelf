import { describe, expect, it } from "vitest";

import { captureSelection } from "./selection";
import type { SelectionDeps } from "./selection";

type Snapshot = readonly Record<string, Blob>[];

const fakeClipboard = (
  initial: string,
  copied: string | null,
  copiedHtml = ""
) => {
  let content = initial;
  let html = "";
  const restoredWith: Snapshot[] = [];
  const snapshot: Snapshot = [{ "text/plain": new Blob([initial]) }];

  const deps: SelectionDeps<Snapshot> = {
    clear: () => {
      content = "";
      html = "";
    },
    copy: () => {
      if (copied !== null) {
        content = copied;
        html = copiedHtml;
      }
    },
    readHtml: async () => await Promise.resolve(html),
    readText: async () => await Promise.resolve(content),
    restore: async (saved) => {
      restoredWith.push(saved);
      content = initial;
      html = "";
      await Promise.resolve();
    },
    snapshot: async () => await Promise.resolve(snapshot),
    wait: async () => {
      await Promise.resolve();
    },
  };

  return { content: () => content, deps, restoredWith, snapshot };
};

describe(captureSelection, () => {
  it("returns the copied selection and restores the clipboard", async () => {
    const clip = fakeClipboard("earlier", "Total ignores the discount");

    await expect(captureSelection(clip.deps)).resolves.toStrictEqual({
      html: null,
      kind: "text",
      restored: true,
      text: "Total ignores the discount",
    });
    expect(clip.restoredWith).toStrictEqual([clip.snapshot]);
    expect(clip.content()).toBe("earlier");
  });

  it("reports nothing when the app copied nothing, even if the clipboard held text", async () => {
    const clip = fakeClipboard("earlier", null);

    await expect(captureSelection(clip.deps)).resolves.toStrictEqual({
      kind: "none",
      restored: true,
    });
    expect(clip.content()).toBe("earlier");
  });

  it("keeps the HTML copied with the selection, read before the clipboard goes back", async () => {
    const clip = fakeClipboard(
      "earlier",
      "See the PR",
      '<a href="https://github.com/a/b/pull/1">See the PR</a>'
    );

    await expect(captureSelection(clip.deps)).resolves.toMatchObject({
      html: '<a href="https://github.com/a/b/pull/1">See the PR</a>',
      text: "See the PR",
    });
  });

  it("keeps Windows line breaks as plain line feeds", async () => {
    const clip = fakeClipboard("earlier", "Selection test\r\nThe second line");

    await expect(captureSelection(clip.deps)).resolves.toMatchObject({
      text: "Selection test\nThe second line",
    });
  });

  it("says when the clipboard could not be put back", async () => {
    const clip = fakeClipboard("earlier", "x");

    await expect(
      captureSelection({
        ...clip.deps,
        restore: async () => {
          await Promise.reject(new Error("busy"));
        },
      })
    ).resolves.toMatchObject({ restored: false });
  });
});

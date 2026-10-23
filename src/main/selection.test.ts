import { describe, expect, it } from "vitest";

import { captureSelection } from "./selection";
import type { SelectionDeps } from "./selection";

type Snapshot = readonly Record<string, Blob>[];

const fakeClipboard = (initial: string, copied: string | null) => {
  let content = initial;
  const restoredWith: Snapshot[] = [];
  const snapshot: Snapshot = [{ "text/plain": new Blob([initial]) }];

  const deps: SelectionDeps<Snapshot> = {
    clear: () => {
      content = "";
    },
    copy: () => {
      if (copied !== null) {
        content = copied;
      }
    },
    readText: async () => await Promise.resolve(content),
    restore: async (saved) => {
      restoredWith.push(saved);
      content = initial;
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

import { describe, expect, it } from "vitest";

import { sameClipboard } from "./clipboard-match";
import { captureSelection } from "./selection";
import type { SelectionDeps } from "./selection";

type Snapshot = readonly Record<string, Blob>[];

const fakeClipboard = (
  initial: string,
  copied: string | null,
  copiedHtml = "",
  copiedSource = "",
  /** How many writes back another app's hold on the clipboard swallows, as Windows does without an error: the selection stays. */
  heldFor = 0
) => {
  let content = initial;
  let html = "";
  let source = "";
  let held = heldFor;
  const restoredWith: Snapshot[] = [];

  const snapshot: Snapshot =
    initial === "" ? [] : [{ "text/plain": new Blob([initial]) }];

  const readSnapshot = async (): Promise<Snapshot> => {
    if (content === "") {
      return [];
    }

    const item = { "text/plain": new Blob([content]) };

    return await Promise.resolve([
      html === "" ? item : { ...item, "text/html": new Blob([html]) },
    ]);
  };

  const deps: SelectionDeps<Snapshot> = {
    clear: () => {
      content = "";
      html = "";
      source = "";
    },
    copy: () => {
      if (copied !== null) {
        content = copied;
        html = copiedHtml;
        source = copiedSource;
      }
    },
    holds: async () => await Promise.resolve(content === initial),
    readHtml: async () => await Promise.resolve(html),
    readSource: async () => await Promise.resolve(source),
    readText: async () => await Promise.resolve(content),
    restore: async (saved) => {
      restoredWith.push(saved);

      if (held > 0) {
        held -= 1;
      } else {
        content = initial;
        html = "";
        source = "";
      }

      await Promise.resolve();
    },
    snapshot: readSnapshot,
    unchanged: async (copiedSnapshot) =>
      await sameClipboard(copiedSnapshot, await readSnapshot()),
    wait: async () => {
      await Promise.resolve();
    },
  };

  return {
    content: () => content,
    deps,
    replace: (text: string, markup = "") => {
      content = text;
      html = markup;
    },
    restoredWith,
    snapshot,
  };
};

describe(captureSelection, () => {
  it("returns the copied selection and restores the clipboard", async () => {
    const clip = fakeClipboard("earlier", "Total ignores the discount");

    await expect(captureSelection(clip.deps)).resolves.toStrictEqual({
      html: null,
      kind: "text",
      restored: true,
      source: null,
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

  it("keeps the page the browser noted it copied from", async () => {
    const clip = fakeClipboard(
      "earlier",
      "See the PR",
      "",
      "https://github.com/a/b/pull/1"
    );

    await expect(captureSelection(clip.deps)).resolves.toMatchObject({
      source: "https://github.com/a/b/pull/1",
    });
    expect(clip.content()).toBe("earlier");
  });

  it("keeps Windows line breaks as plain line feeds", async () => {
    const clip = fakeClipboard("earlier", "Selection test\r\nThe second line");

    await expect(captureSelection(clip.deps)).resolves.toMatchObject({
      text: "Selection test\nThe second line",
    });
  });

  it("puts the clipboard back again while another app holds it, until it takes", async () => {
    const clip = fakeClipboard("earlier", "x", "", "", 2);

    await expect(captureSelection(clip.deps)).resolves.toMatchObject({
      restored: true,
      text: "x",
    });
    expect(clip.restoredWith).toHaveLength(3);
    expect(clip.content()).toBe("earlier");
  });

  it("says the clipboard could not be put back when it never takes", async () => {
    const clip = fakeClipboard("earlier", "x", "", "", 1000);

    await expect(captureSelection(clip.deps)).resolves.toMatchObject({
      restored: false,
    });
    expect(clip.content()).toBe("x");
  });

  it("preserves a newer copy made while waiting to retry restoration", async () => {
    const clip = fakeClipboard("earlier", "x", "", "", 1);

    await expect(
      captureSelection({
        ...clip.deps,
        wait: async (ms) => {
          if (ms === 250) {
            clip.replace("new user copy");
          }

          await Promise.resolve();
        },
      })
    ).resolves.toMatchObject({ restored: false, text: "x" });
    expect(clip.restoredWith).toHaveLength(1);
    expect(clip.content()).toBe("new user copy");
  });

  it("preserves a newer copy with the same text but different HTML", async () => {
    const clip = fakeClipboard("earlier", "x", "<b>x</b>", "", 1);

    await expect(
      captureSelection({
        ...clip.deps,
        wait: async (ms) => {
          if (ms === 250) {
            clip.replace("x", "<i>x</i>");
          }

          await Promise.resolve();
        },
      })
    ).resolves.toMatchObject({ restored: false, text: "x" });
    expect(clip.restoredWith).toHaveLength(1);
    await expect(clip.deps.readHtml()).resolves.toBe("<i>x</i>");
  });

  it("does not retry when the clipboard cannot be checked for a newer copy", async () => {
    const clip = fakeClipboard("earlier", "x", "", "", 1);

    await expect(
      captureSelection({
        ...clip.deps,
        unchanged: async () =>
          await Promise.reject(new Error("clipboard unavailable")),
      })
    ).resolves.toMatchObject({ restored: false });
    expect(clip.restoredWith).toHaveLength(1);
  });

  it("preserves a newer copy when the captured clipboard was empty", async () => {
    const clip = fakeClipboard("earlier", null, "", "", 1);

    await expect(
      captureSelection({
        ...clip.deps,
        wait: async (ms) => {
          if (ms === 250) {
            clip.replace("new user copy");
          }

          await Promise.resolve();
        },
      })
    ).resolves.toStrictEqual({ kind: "none", restored: false });
    expect(clip.restoredWith).toHaveLength(1);
    expect(clip.content()).toBe("new user copy");
  });

  it("still attempts restoration if the captured clipboard cannot be snapshotted", async () => {
    const clip = fakeClipboard("earlier", "x", "", "", 1);
    let snapshots = 0;

    await expect(
      captureSelection({
        ...clip.deps,
        snapshot: async () => {
          snapshots += 1;

          return snapshots === 1
            ? await clip.deps.snapshot()
            : await Promise.reject(new Error("clipboard unavailable"));
        },
      })
    ).resolves.toMatchObject({ restored: false });
    expect(clip.restoredWith).toHaveLength(1);
  });

  it("leaves an empty clipboard empty, putting nothing back again", async () => {
    const clip = fakeClipboard("", null);

    await expect(captureSelection(clip.deps)).resolves.toStrictEqual({
      kind: "none",
      restored: true,
    });
    expect(clip.restoredWith).toStrictEqual([[]]);
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

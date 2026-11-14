import { describe, expect, it } from "vitest";

import { readableClipboard, sameClipboard } from "./clipboard-match";
import { captureSelection } from "./selection";
import type { SelectionDeps } from "./selection";

type Snapshot = readonly Record<string, Blob>[];

/** What Electron reads while another app has the clipboard open, as measured on Windows: one empty text. */
const HELD_READ: Snapshot = [{ "text/plain": new Blob([]) }];

const fakeClipboard = (
  initial: string,
  copied: string | null,
  copiedHtml = "",
  copiedSource = "",
  /** How many writes back another app's hold on the clipboard swallows, as Windows does without an error: the selection stays. */
  heldFor = 0,
  /**
   * Another app holds the clipboard from `from` to `to` ms after the capture
   * starts: reads come back as one empty text, and writes do nothing.
   */
  hold: { readonly from: number; readonly to: number } | null = null
) => {
  let content = initial;
  let html = "";
  let source = "";
  let held = heldFor;
  let time = 0;
  let cleared = 0;
  const restoredWith: Snapshot[] = [];

  const holding = (): boolean =>
    hold !== null && time >= hold.from && time < hold.to;

  const snapshot: Snapshot =
    initial === "" ? [] : [{ "text/plain": new Blob([initial]) }];

  // A read takes a moment, and about 350 ms while another app holds the clipboard (measured on Windows).
  const readSnapshot = async (): Promise<Snapshot> => {
    const wasHeld = holding();

    time += wasHeld ? 350 : 5;

    if (wasHeld) {
      return await Promise.resolve(HELD_READ);
    }

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
      cleared += 1;
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
    holds: async () => await Promise.resolve(!holding() && content === initial),
    now: () => time,
    readable: readableClipboard,
    readHtml: async () => await Promise.resolve(html),
    readSource: async () => await Promise.resolve(source),
    readText: async () => await Promise.resolve(content),
    restore: async (saved) => {
      restoredWith.push(saved);

      if (held > 0) {
        held -= 1;
      } else if (!holding()) {
        content = initial;
        html = "";
        source = "";
      }

      await Promise.resolve();
    },
    same: sameClipboard,
    snapshot: readSnapshot,
    wait: async (ms) => {
      time += ms;
      await Promise.resolve();
    },
  };

  return {
    cleared: () => cleared,
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

          await clip.deps.wait(ms);
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

          await clip.deps.wait(ms);
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
        same: async () =>
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

          await clip.deps.wait(ms);
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

  it("waits out another app's hold during the put back, instead of taking its empty read for a newer copy", async () => {
    // Held from between the capture and the put back until 1.5 s in, as in the Windows run.
    const clip = fakeClipboard("earlier", "x", "", "", 0, {
      from: 35,
      to: 1500,
    });

    await expect(captureSelection(clip.deps)).resolves.toMatchObject({
      restored: true,
      text: "x",
    });
    expect(clip.content()).toBe("earlier");
  });

  it("says the clipboard could not be put back when another app holds it past the retries", async () => {
    const clip = fakeClipboard("earlier", "x", "", "", 0, {
      from: 35,
      to: 10_000,
    });

    await expect(captureSelection(clip.deps)).resolves.toMatchObject({
      restored: false,
      text: "x",
    });
    expect(clip.deps.now()).toBeLessThan(4000);
  });

  it("waits briefly for a clipboard another app holds, then copies as usual", async () => {
    const clip = fakeClipboard("earlier", "x", "", "", 0, { from: 0, to: 400 });

    await expect(captureSelection(clip.deps)).resolves.toMatchObject({
      restored: true,
      text: "x",
    });
    expect(clip.content()).toBe("earlier");
  });

  it("leaves a clipboard it can't read alone, rather than empty one it couldn't save", async () => {
    const clip = fakeClipboard("earlier", "x", "", "", 0, {
      from: 0,
      to: 10_000,
    });

    await expect(captureSelection(clip.deps)).resolves.toStrictEqual({
      kind: "busy",
    });
    expect({
      cleared: clip.cleared(),
      restored: clip.restoredWith.length,
    }).toStrictEqual({ cleared: 0, restored: 0 });
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

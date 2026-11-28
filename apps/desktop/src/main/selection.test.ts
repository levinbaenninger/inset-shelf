import { describe, expect, it } from "vite-plus/test";

import { readableClipboard, sameClipboard } from "./clipboard-match";
import { ConcealedClipboardError } from "./clipboard-privacy";
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
    content: async (read) => ({
      html: (await read[0]?.["text/html"]?.text()) ?? "",
      text: (await read[0]?.["text/plain"]?.text()) ?? "",
    }),
    holds: async (saved, current) => await sameClipboard(saved, current),
    now: () => time,
    readable: readableClipboard,
    readSelection: async () => {
      const wasHeld = holding();

      time += wasHeld ? 350 : 1;

      return await Promise.resolve(
        wasHeld
          ? { html: "", source: "", text: "" }
          : { html, source, text: content }
      );
    },
    restore: async (saved) => {
      restoredWith.push(saved);
      // The write is decided as it starts; it takes a moment.
      time += 2;

      if (held > 0) {
        held -= 1;
      } else if (
        !(hold !== null && time - 2 >= hold.from && time - 2 < hold.to)
      ) {
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
    html: () => html,
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
      unchecked: false,
    });
    expect(clip.restoredWith).toStrictEqual([clip.snapshot]);
    expect(clip.content()).toBe("earlier");
  });

  it("reports nothing when the app copied nothing, even if the clipboard held text", async () => {
    const clip = fakeClipboard("earlier", null);

    await expect(captureSelection(clip.deps)).resolves.toStrictEqual({
      kind: "none",
      restored: true,
      unchecked: false,
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

  it.each([
    { markup: "", text: "new user copy" },
    { markup: "<i>x</i>", text: "x" },
    { markup: "", text: "" },
  ])(
    "preserves a newer copy after a held first snapshot: $text $markup",
    async ({ markup, text }) => {
      const clip = fakeClipboard("earlier", "x", "<b>x</b>");
      let snapshots = 0;

      await expect(
        captureSelection({
          ...clip.deps,
          snapshot: async () => {
            snapshots += 1;

            if (snapshots === 2) {
              // The read started under a hold; the other app copies before it returns.
              await clip.deps.wait(350);
              clip.replace(text, markup);

              return HELD_READ;
            }

            return await clip.deps.snapshot();
          },
        })
      ).resolves.toMatchObject({ restored: false, text: "x" });
      expect(clip.restoredWith).toHaveLength(0);
      expect(clip.content()).toBe(text);
      expect(clip.html()).toBe(markup);
    }
  );

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
    expect(clip.html()).toBe("<i>x</i>");
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
    ).resolves.toStrictEqual({
      kind: "none",
      restored: false,
      unchecked: false,
    });
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

  it("puts the clipboard back after a hold over the capture, when what comes back is exactly what was copied", async () => {
    // The first read after the copy runs into the hold; afterwards the clipboard is still the selection, text and HTML.
    const clip = fakeClipboard("earlier", "x", "", "", 0, {
      from: 31,
      to: 1500,
    });

    await expect(captureSelection(clip.deps)).resolves.toMatchObject({
      restored: true,
      text: "x",
    });
    expect(clip.restoredWith).toHaveLength(1);
    expect(clip.content()).toBe("earlier");
  });

  it("says it couldn't check the put back when another app holds the clipboard past the deadline", async () => {
    const clip = fakeClipboard("earlier", "x", "", "", 0, {
      from: 35,
      to: 30_000,
    });

    await expect(captureSelection(clip.deps)).resolves.toMatchObject({
      restored: false,
      text: "x",
      unchecked: true,
    });
    // About ten seconds after the copy, with the last held read.
    expect(clip.deps.now()).toBeLessThan(10_700);
  });

  it("waits out a hold of several seconds between the selection's read and the put back, then puts the clipboard back", async () => {
    // As in the Windows run: the hold opens right after the text read and lasts 4 s.
    const clip = fakeClipboard("earlier", "x", "", "", 0, {
      from: 31,
      to: 4000,
    });

    await expect(captureSelection(clip.deps)).resolves.toMatchObject({
      restored: true,
      text: "x",
      unchecked: false,
    });
    expect(clip.content()).toBe("earlier");
  });

  it("says the clipboard wasn't put back, not that it couldn't be checked, when a hold kept the put back from being tried", async () => {
    const clip = fakeClipboard("earlier", "x", "", "", 0, {
      from: 31,
      to: 30_000,
    });

    await expect(captureSelection(clip.deps)).resolves.toMatchObject({
      restored: false,
      text: "x",
      unchecked: false,
    });
    expect(clip.restoredWith).toHaveLength(0);
  });

  it("confirms a put back that landed just before another app took the clipboard", async () => {
    // The write goes through at 36 ms; the hold starts right after it and lasts to 1.5 s.
    const clip = fakeClipboard("earlier", "x", "", "", 0, {
      from: 37,
      to: 1500,
    });

    await expect(captureSelection(clip.deps)).resolves.toMatchObject({
      restored: true,
      text: "x",
      unchecked: false,
    });
    expect(clip.restoredWith).toHaveLength(1);
  });

  it("says it couldn't check a put back that landed when another app then holds the clipboard past the deadline", async () => {
    const clip = fakeClipboard("earlier", "x", "", "", 0, {
      from: 37,
      to: 30_000,
    });

    await expect(captureSelection(clip.deps)).resolves.toMatchObject({
      restored: false,
      unchecked: true,
    });
  });

  it("confirms a put back from the clipboard it read, when another app takes the clipboard just after that read", async () => {
    // Put back at 36–38 ms, read back at 38–43 ms; the hold starts right after that read.
    const clip = fakeClipboard("earlier", "x", "", "", 0, {
      from: 43,
      to: 1500,
    });

    await expect(captureSelection(clip.deps)).resolves.toMatchObject({
      restored: true,
      text: "x",
      unchecked: false,
    });
  });

  it.each([
    { markup: "", text: "new user copy" },
    { markup: "<b>new user copy</b>", text: "new user copy" },
    { markup: "", text: "" },
  ])(
    "preserves a newer copy when a hold kept the selection unreadable: $text $markup",
    async ({ markup, text }) => {
      const clip = fakeClipboard("earlier", "x", "", "", 0, {
        from: 20,
        to: 10_400,
      });

      await expect(
        captureSelection({
          ...clip.deps,
          snapshot: async () => {
            const read = await clip.deps.snapshot();

            if (clip.deps.now() >= 10_000 && !clip.deps.readable(read)) {
              // The holder copies before releasing, during the last held read.
              clip.replace(text, markup);
            }

            return read;
          },
        })
      ).resolves.toStrictEqual({
        kind: "busy",
        restored: false,
        unchecked: false,
      });
      expect(clip.restoredWith).toHaveLength(0);
      expect(clip.content()).toBe(text);
      expect(clip.html()).toBe(markup);
    }
  );

  it("leaves unknown clipboard content alone after a hold over the whole copy", async () => {
    // The selection was never read, so what comes back after the hold can't be told from a newer copy.
    // The hold ends just after the deadline, as in the Windows run.
    const clip = fakeClipboard("earlier", "x", "", "", 0, {
      from: 20,
      to: 10_400,
    });

    await expect(captureSelection(clip.deps)).resolves.toStrictEqual({
      kind: "busy",
      restored: false,
      unchecked: false,
    });
    expect(clip.restoredWith).toHaveLength(0);
    expect(clip.content()).toBe("x");
  });

  it("puts the clipboard back when the read after the copy was cut short by a hold, its raw formats empty", async () => {
    // As in the Windows run: that read got the text before the hold and the raw formats under it; the put back is
    // written under the hold and dropped, and what comes back after the hold is still the capture.
    const clip = fakeClipboard("earlier", "x", "", "", 0, {
      from: 36,
      to: 4000,
    });

    const raw = 'electron application/osclipboard;format="DataObject"';
    let snapshots = 0;

    await expect(
      captureSelection({
        ...clip.deps,
        snapshot: async () => {
          snapshots += 1;

          const read = await clip.deps.snapshot();
          const [first] = read;

          if (first === undefined || !("text/plain" in first)) {
            return read;
          }

          return [
            { ...first, [raw]: new Blob(snapshots === 2 ? [] : ["raw"]) },
          ];
        },
      })
    ).resolves.toMatchObject({ restored: true, text: "x" });
    expect(clip.content()).toBe("earlier");
  });

  it("keeps reading the selection while another app holds the clipboard, then copies it", async () => {
    const clip = fakeClipboard("earlier", "x", "", "", 0, {
      from: 20,
      to: 1500,
    });

    await expect(captureSelection(clip.deps)).resolves.toMatchObject({
      restored: true,
      text: "x",
    });
    expect(clip.content()).toBe("earlier");
  });

  it("says the clipboard was busy when another app holds it through the copy, never that nothing was selected", async () => {
    const clip = fakeClipboard("earlier", "x", "", "", 0, {
      from: 20,
      to: 30_000,
    });

    // Held from before the text read to past the deadline: the put back was never tried, and is reported as not done.
    await expect(captureSelection(clip.deps)).resolves.toMatchObject({
      kind: "busy",
      restored: false,
      unchecked: false,
    });
    expect(clip.restoredWith).toHaveLength(0);
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
      restored: true,
      unchecked: false,
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
      unchecked: false,
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

describe("captureSelection with a private clipboard", () => {
  it("stops at the first private read of the original clipboard, without waiting", async () => {
    const clip = fakeClipboard("secret", "x");
    let snapshots = 0;

    await expect(
      captureSelection({
        ...clip.deps,
        snapshot: async () => {
          snapshots += 1;

          return await Promise.reject(new ConcealedClipboardError());
        },
      })
    ).resolves.toStrictEqual({
      kind: "concealed",
      restored: true,
      unchecked: false,
      which: "original",
    });
    expect(snapshots).toBe(1);
    expect(clip.cleared()).toBe(0);
  });

  it("stops polling at a private selection and puts the original clipboard back", async () => {
    const clip = fakeClipboard("earlier", "hunter2");
    let reads = 0;

    await expect(
      captureSelection({
        ...clip.deps,
        readSelection: async () => {
          reads += 1;

          return await Promise.reject(new ConcealedClipboardError());
        },
      })
    ).resolves.toStrictEqual({
      kind: "concealed",
      restored: true,
      unchecked: false,
      which: "selection",
    });
    expect(reads).toBe(1);
    expect(clip.restoredWith).toStrictEqual([clip.snapshot]);
  });

  it("says the private selection may still be on the clipboard when putting it back fails", async () => {
    const clip = fakeClipboard("earlier", "hunter2");

    await expect(
      captureSelection({
        ...clip.deps,
        readSelection: async () =>
          await Promise.reject(new ConcealedClipboardError()),
        restore: async () => {
          await Promise.reject(new Error("busy"));
        },
      })
    ).resolves.toStrictEqual({
      kind: "concealed",
      restored: false,
      unchecked: false,
      which: "selection",
    });
  });

  it("says the private selection may still be on the clipboard when the put back didn't take", async () => {
    const clip = fakeClipboard("earlier", "hunter2");
    let snapshots = 0;

    await expect(
      captureSelection({
        ...clip.deps,
        readSelection: async () =>
          await Promise.reject(new ConcealedClipboardError()),
        // The write is dropped without an error: the private selection is still there.
        restore: async () => {
          await Promise.resolve();
        },
        snapshot: async () => {
          snapshots += 1;

          return snapshots === 1
            ? await clip.deps.snapshot()
            : await Promise.reject(new ConcealedClipboardError());
        },
      })
    ).resolves.toMatchObject({ kind: "concealed", restored: false });
  });

  it("keeps a normal capture when a password manager conceals the clipboard during the restore", async () => {
    const clip = fakeClipboard("earlier", "Total ignores the discount");
    let snapshots = 0;

    await expect(
      captureSelection({
        ...clip.deps,
        snapshot: async () => {
          snapshots += 1;

          // The first read is the original clipboard; every later one meets the new secret.
          return snapshots === 1
            ? await clip.deps.snapshot()
            : await Promise.reject(new ConcealedClipboardError());
        },
      })
    ).resolves.toMatchObject({
      kind: "text",
      text: "Total ignores the discount",
    });
  });
});

import { describe, expect, it } from "vite-plus/test";

import {
  clipboardContent,
  holdsAgainIn,
  readableClipboard,
  sameClipboard,
} from "./clipboard-match";
import { copiedFilePaths } from "./copied-files";
import { captureSelection } from "./selection";
import type { SelectionDeps } from "./selection";

type Snapshot = readonly Record<string, Blob>[];

/** One clipboard item as plain words per format. */
type Item = Readonly<Record<string, string>>;

const HELD_READ: Snapshot = [{ "text/plain": new Blob([]) }];

const A = "file:///Users/me/a.pdf";
const B = "file:///Users/me/b.pdf";
const list = (url: string) => ({ "text/uri-list": url });

/** How Windows notes a copy or a cut of files beside their list: a 32-bit flag set, 1 to copy and 2 to move. */
const DROP_EFFECT =
  'electron application/osclipboard;format="Preferred DropEffect"';

const copyOf = (url: string) => ({
  ...list(url),
  [DROP_EFFECT]: "\u0001\0\0\0",
});

const cutOf = (url: string) => ({
  ...list(url),
  [DROP_EFFECT]: "\u0002\0\0\0",
});

const toSnapshot = (items: readonly Item[]): Snapshot =>
  items.map((item) =>
    Object.fromEntries(
      Object.entries(item).map(([type, value]) => [type, new Blob([value])])
    )
  );

const toItems = async (snapshot: Snapshot): Promise<Item[]> =>
  await Promise.all(
    snapshot.map(async (item) =>
      Object.fromEntries(
        await Promise.all(
          Object.entries(item).map(
            async ([type, blob]) => [type, await blob.text()] as const
          )
        )
      )
    )
  );

/**
 * A clipboard with Explorer's and Finder's formats, read as the app reads it:
 * `held` lists the numbers of the snapshot reads that run into another app's
 * hold, `before` what the user does just before a numbered read, `swallow`
 * how many writes back a hold swallows without an error, `rejected` the
 * snapshot reads that fail, `filesHeld` the file-list reads that come back
 * empty (as Chromium does when it can't open the clipboard), and `halfRead`
 * the snapshot reads a hold cuts short: the files' list comes back empty.
 */
const clipboard = (options: {
  readonly initial: readonly Item[];
  readonly copied: readonly Item[];
  readonly held?: readonly number[];
  readonly before?: Readonly<Record<number, readonly Item[]>>;
  readonly swallow?: number;
  readonly rejected?: readonly number[];
  readonly filesHeld?: readonly number[];
  readonly halfRead?: readonly number[];
}) => {
  let items = options.initial;
  let reads = 0;
  let fileReads = 0;
  let time = 0;
  let swallow = options.swallow ?? 0;
  const restored: Snapshot[] = [];

  const deps: SelectionDeps<Snapshot> = {
    clear: () => {
      items = [];
    },
    content: clipboardContent,
    copy: () => {
      items = options.copied;
    },
    holds: holdsAgainIn,
    now: () => time,
    readable: readableClipboard,
    readFiles: async () => {
      fileReads += 1;

      if (options.filesHeld?.includes(fileReads) === true) {
        return [];
      }

      return await copiedFilePaths(
        toSnapshot(items).map((item) => ({
          getType: async (type: string) =>
            await Promise.resolve(item[type] ?? new Blob([])),
          types: Object.keys(item),
        }))
      );
    },
    readHtml: async () =>
      await Promise.resolve(
        items.find((item) => "text/html" in item)?.["text/html"] ?? ""
      ),
    readSource: async () => await Promise.resolve(""),
    readText: async () => {
      time += 1;

      return await Promise.resolve(
        items.find((item) => "text/plain" in item)?.["text/plain"] ?? ""
      );
    },
    restore: async (saved) => {
      restored.push(saved);
      time += 2;

      if (swallow > 0) {
        swallow -= 1;

        return;
      }

      items = await toItems(saved);
    },
    same: sameClipboard,
    snapshot: async () => {
      reads += 1;
      time += 5;
      items = options.before?.[reads] ?? items;

      if (options.rejected?.includes(reads) === true) {
        throw new Error("clipboard unavailable");
      }

      if (options.halfRead?.includes(reads) === true) {
        return toSnapshot(
          items.map((item) => ({
            ...item,
            "text/uri-list": "",
          }))
        );
      }

      return await Promise.resolve(
        options.held?.includes(reads) === true ? HELD_READ : toSnapshot(items)
      );
    },
    wait: async (ms) => {
      time += ms;
      await Promise.resolve();
    },
  };

  return { deps, items: () => items, restored };
};

const EARLIER = { "text/plain": "earlier" };

describe("a file copy followed by the user's own copy of another file", () => {
  // Explorer copies files with no text: the baseline's text and HTML are empty, as a newer file copy's are.
  it("leaves the clipboard alone when the next file is copied while another app holds it", async () => {
    const clip = clipboard({
      before: { 3: [list(B)] },
      copied: [list(A)],
      held: [2],
      initial: [EARLIER],
    });

    await expect(captureSelection(clip.deps)).resolves.toMatchObject({
      kind: "files",
      paths: ["/Users/me/a.pdf"],
      restored: false,
    });
    expect(clip.restored).toStrictEqual([]);
    expect(clip.items()).toStrictEqual([list(B)]);
  });

  it("leaves the clipboard alone when the next file is copied before the restore is read", async () => {
    const clip = clipboard({
      before: { 2: [list(B)] },
      copied: [list(A)],
      initial: [EARLIER],
    });

    await expect(captureSelection(clip.deps)).resolves.toMatchObject({
      kind: "files",
      restored: false,
    });
    expect(clip.restored).toStrictEqual([]);
    expect(clip.items()).toStrictEqual([list(B)]);
  });

  it("leaves the clipboard alone when the next file is copied and the clipboard can't be read after the capture, and puts it back when it still lists the capture's file", async () => {
    const newer = clipboard({
      before: { 2: [list(B)] },
      copied: [list(A)],
      initial: [EARLIER],
      rejected: [2],
    });

    const same = clipboard({
      copied: [list(A)],
      initial: [EARLIER],
      rejected: [2],
    });

    await expect(captureSelection(newer.deps)).resolves.toMatchObject({
      kind: "files",
      restored: false,
    });
    await expect(captureSelection(same.deps)).resolves.toMatchObject({
      kind: "files",
      restored: true,
    });
    expect([newer.restored, newer.items(), same.items()]).toStrictEqual([
      [],
      [list(B)],
      [EARLIER],
    ]);
  });

  it("puts the clipboard back when nothing was copied meanwhile", async () => {
    const clip = clipboard({
      copied: [list(A)],
      initial: [EARLIER],
    });

    await expect(captureSelection(clip.deps)).resolves.toMatchObject({
      kind: "files",
      restored: true,
    });
    expect(clip.items()).toStrictEqual([EARLIER]);
  });
});

describe("a text selection that sits beside a file URL", () => {
  it("saves the selected text, not the file, when the text isn't the file's name", async () => {
    const clip = clipboard({
      copied: [
        {
          "text/plain": "See draft",
          "text/uri-list": "file:///Users/me/draft.pdf",
        },
      ],
      initial: [EARLIER],
    });

    await expect(captureSelection(clip.deps)).resolves.toMatchObject({
      kind: "text",
      text: "See draft",
    });
  });

  it("saves the file when the text is its name, as Finder copies it", async () => {
    const clip = clipboard({
      copied: [
        {
          "text/plain": "draft.pdf",
          "text/uri-list": "file:///Users/me/draft.pdf",
        },
      ],
      initial: [EARLIER],
    });

    await expect(captureSelection(clip.deps)).resolves.toMatchObject({
      kind: "files",
      paths: ["/Users/me/draft.pdf"],
    });
  });

  it("saves the files when the text is their names, one to a line", async () => {
    const clip = clipboard({
      copied: [
        { "text/plain": "a.pdf\r\nb.pdf", "text/uri-list": `${A}\r\n${B}` },
      ],
      initial: [EARLIER],
    });

    await expect(captureSelection(clip.deps)).resolves.toMatchObject({
      kind: "files",
      paths: ["/Users/me/a.pdf", "/Users/me/b.pdf"],
    });
  });

  it("saves the files when there is no text at all, as Explorer copies them", async () => {
    const clip = clipboard({ copied: [list(A)], initial: [EARLIER] });

    await expect(captureSelection(clip.deps)).resolves.toMatchObject({
      kind: "files",
    });
  });
});

describe("restoring a clipboard that held files", () => {
  it("tries again when a swallowed write left another file list there", async () => {
    const clip = clipboard({
      copied: [list(B)],
      initial: [list(A)],
      swallow: 1,
    });

    await expect(captureSelection(clip.deps)).resolves.toMatchObject({
      kind: "files",
      restored: true,
    });
    expect(clip.restored).toHaveLength(2);
    expect(clip.items()).toStrictEqual([list(A)]);
  });
});

describe("a hold that starts while the capture checks the files it copied", () => {
  // A clipboard manager opens the clipboard after the capture's snapshot is read: Chromium then lists no files.
  it("puts the clipboard back when the file-list read after the snapshot comes back empty", async () => {
    const clip = clipboard({
      copied: [list(A)],
      filesHeld: [2],
      initial: [EARLIER],
    });

    await expect(captureSelection(clip.deps)).resolves.toMatchObject({
      kind: "files",
      paths: ["/Users/me/a.pdf"],
      restored: true,
    });
    expect(clip.items()).toStrictEqual([EARLIER]);
  });

  it("puts the clipboard back when the hold came back for the file-list read that follows a held snapshot", async () => {
    const clip = clipboard({
      copied: [list(A)],
      filesHeld: [2],
      held: [2],
      initial: [EARLIER],
    });

    await expect(captureSelection(clip.deps)).resolves.toMatchObject({
      kind: "files",
      restored: true,
    });
    expect(clip.items()).toStrictEqual([EARLIER]);
  });
});

describe("a clipboard that can't be read after the capture", () => {
  it("leaves the next file copy alone when the read after the capture fails", async () => {
    // The user copied B before the failing read: a write from the old clipboard would replace it.
    const clip = clipboard({
      before: { 2: [list(B)] },
      copied: [list(A)],
      initial: [EARLIER],
      rejected: [2],
    });

    await expect(captureSelection(clip.deps)).resolves.toMatchObject({
      kind: "files",
      restored: false,
    });
    expect(clip.restored).toStrictEqual([]);
    expect(clip.items()).toStrictEqual([list(B)]);
  });

  it("writes nothing and says it wasn't put back when the clipboard can't be read before time runs out", async () => {
    const clip = clipboard({
      copied: [list(A)],
      initial: [EARLIER],
      rejected: Array.from({ length: 200 }, (_, at) => at + 2),
    });

    await expect(captureSelection(clip.deps)).resolves.toMatchObject({
      kind: "files",
      restored: false,
      unchecked: false,
    });
    expect(clip.restored).toStrictEqual([]);
    expect(clip.items()).toStrictEqual([list(A)]);
  });
});

describe("a read the capture can't judge", () => {
  const FINDER = {
    "text/plain": "a.pdf",
    "text/uri-list": A,
  };

  it("reads again, not a newer copy, when a hold cut the snapshot's file list short", async () => {
    // Finder's text came back and the list behind it came back with nothing in it.
    const clip = clipboard({
      copied: [FINDER],
      halfRead: [2],
      initial: [EARLIER],
    });

    await expect(captureSelection(clip.deps)).resolves.toMatchObject({
      kind: "files",
      restored: true,
    });
    expect(clip.items()).toStrictEqual([EARLIER]);
  });

  it("calls a read with another file list, or with text beside no files, a newer copy", async () => {
    const copiedB = clipboard({
      before: { 2: [list(B)] },
      copied: [list(A)],
      initial: [EARLIER],
    });

    const copiedText = clipboard({
      before: { 2: [{ "text/plain": "another copy" }] },
      copied: [list(A)],
      initial: [EARLIER],
    });

    await captureSelection(copiedB.deps);
    await captureSelection(copiedText.deps);

    expect(copiedB.restored).toStrictEqual([]);
    expect(copiedText.restored).toStrictEqual([]);
    expect(copiedText.items()).toStrictEqual([
      { "text/plain": "another copy" },
    ]);
  });

  it("leaves the clipboard as it is, and says it wasn't put back, when every read stays unclear until time runs out", async () => {
    const clip = clipboard({
      copied: [FINDER],
      halfRead: Array.from({ length: 200 }, (_, at) => at + 2),
      initial: [EARLIER],
    });

    await expect(captureSelection(clip.deps)).resolves.toMatchObject({
      kind: "files",
      restored: false,
      unchecked: false,
    });
    expect(clip.restored).toStrictEqual([]);
    expect(clip.items()).toStrictEqual([FINDER]);
  });
});

describe("a cut and a copy of the same file", () => {
  it("leaves a cut made after the capture alone, though its list is the capture's", async () => {
    const clip = clipboard({
      before: { 2: [cutOf(A)] },
      copied: [copyOf(A)],
      initial: [EARLIER],
    });

    await expect(captureSelection(clip.deps)).resolves.toMatchObject({
      kind: "files",
      restored: false,
    });
    expect(clip.restored).toStrictEqual([]);
    expect(clip.items()).toStrictEqual([cutOf(A)]);
  });

  it("puts the clipboard back at once when files are listed with no effect, as an app that never notes one copies them", async () => {
    const clip = clipboard({
      copied: [list(A)],
      initial: [EARLIER],
    });

    await expect(captureSelection(clip.deps)).resolves.toMatchObject({
      kind: "files",
      restored: true,
    });
    expect(clip.items()).toStrictEqual([EARLIER]);
  });

  it("reads again when the effect is listed but came back with no bytes, until the cut shows", async () => {
    const clip = clipboard({
      before: { 2: [{ ...list(A), [DROP_EFFECT]: "" }], 3: [cutOf(A)] },
      copied: [copyOf(A)],
      initial: [EARLIER],
    });

    await captureSelection(clip.deps);

    expect(clip.restored).toStrictEqual([]);
    expect(clip.items()).toStrictEqual([cutOf(A)]);
  });

  it("writes nothing and says it wasn't put back when the effect stays hidden until time runs out", async () => {
    const clip = clipboard({
      before: { 2: [{ ...list(A), [DROP_EFFECT]: "" }] },
      copied: [copyOf(A)],
      initial: [EARLIER],
    });

    await expect(captureSelection(clip.deps)).resolves.toMatchObject({
      kind: "files",
      restored: false,
      unchecked: false,
    });
    expect(clip.restored).toStrictEqual([]);
    expect(clip.items()).toStrictEqual([{ ...list(A), [DROP_EFFECT]: "" }]);
  });

  it("tries again when a swallowed write left a copy of the file where the clipboard held it cut", async () => {
    const clip = clipboard({
      copied: [copyOf(A)],
      initial: [cutOf(A)],
      swallow: 1,
    });

    await expect(captureSelection(clip.deps)).resolves.toMatchObject({
      kind: "files",
      restored: true,
    });
    expect(clip.restored).toHaveLength(2);
    expect(clip.items()).toStrictEqual([cutOf(A)]);
  });

  it("tries again when a swallowed write left file URLs beside the text the clipboard held alone", async () => {
    const draft = { "text/plain": "draft" };

    const clip = clipboard({
      copied: [{ ...draft, ...list(A) }],
      initial: [draft],
      swallow: 1,
    });

    await expect(captureSelection(clip.deps)).resolves.toMatchObject({
      kind: "text",
      restored: true,
    });
    expect(clip.restored).toHaveLength(2);
    expect(clip.items()).toStrictEqual([draft]);
  });
});

describe("a read the capture can't open", () => {
  it("leaves the clipboard as it is, and says it wasn't put back, when what a read holds can't be listed", async () => {
    const clip = clipboard({ copied: [list(A)], initial: [EARLIER] });

    await expect(
      captureSelection({
        ...clip.deps,
        content: async () =>
          await Promise.reject(new Error("clipboard unavailable")),
      })
    ).resolves.toMatchObject({ kind: "files", restored: false });
    expect(clip.restored).toStrictEqual([]);
    expect(clip.items()).toStrictEqual([list(A)]);
  });
});

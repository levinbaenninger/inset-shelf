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
const list = (url: string): Item => ({ "text/uri-list": url });

const toSnapshot = (items: readonly Item[]): Snapshot =>
  items.map((item) =>
    Object.fromEntries(
      Object.entries(item).map(([type, value]) => [type, new Blob([value])])
    )
  );

const toItems = async (snapshot: Snapshot): Promise<Item[]> =>
  await Promise.all(
    snapshot.map(
      async (item) =>
        Object.fromEntries(
          await Promise.all(
            Object.entries(item).map(
              async ([type, blob]) => [type, await blob.text()] as const
            )
          )
        ) as Item
    )
  );

/**
 * A clipboard with Explorer's and Finder's formats, read as the app reads it:
 * `held` lists the numbers of the snapshot reads that run into another app's
 * hold, `before` what the user does just before a numbered read, and `swallow`
 * how many writes back a hold swallows without an error.
 */
const clipboard = (options: {
  readonly initial: readonly Item[];
  readonly copied: readonly Item[];
  readonly held?: readonly number[];
  readonly before?: Readonly<Record<number, readonly Item[]>>;
  readonly swallow?: number;
}) => {
  let items = options.initial;
  let reads = 0;
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
    readFiles: async () =>
      await copiedFilePaths(
        toSnapshot(items).map((item) => ({
          getType: async (type: string) =>
            await Promise.resolve(item[type] as Blob),
          types: Object.keys(item),
        }))
      ),
    readHtml: async () =>
      await Promise.resolve(items.find((item) => "text/html" in item)?.["text/html"] ?? ""),
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

      return await Promise.resolve(
        options.held?.includes(reads) === true
          ? HELD_READ
          : toSnapshot(items)
      );
    },
    wait: async (ms) => {
      time += ms;
      await Promise.resolve();
    },
  };

  return { deps, items: () => items, restored };
};

const EARLIER: Item = { "text/plain": "earlier" };

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
      copied: [{ "text/plain": "See draft", "text/uri-list": "file:///Users/me/draft.pdf" }],
      initial: [EARLIER],
    });

    await expect(captureSelection(clip.deps)).resolves.toMatchObject({
      kind: "text",
      text: "See draft",
    });
  });

  it("saves the file when the text is its name, as Finder copies it", async () => {
    const clip = clipboard({
      copied: [{ "text/plain": "draft.pdf", "text/uri-list": "file:///Users/me/draft.pdf" }],
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

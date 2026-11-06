import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  emptyShelf,
  ItemIdSchema,
  SectionIdSchema,
  ShelfDocSchema,
  NO_META,
  WindowIdSchema,
} from "@shared/shelf";
import type { ShelfDoc, WindowRef } from "@shared/shelf";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { failNextWrite, nodeStoreFs, openShelfStore } from "./shelf-store";
import type { StoreFs } from "./shelf-store";
import { windowRef } from "./window-ref";

const SECTION = SectionIdSchema.parse("3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1b01");

const options = {
  fs: nodeStoreFs,
  newSectionId: () => SECTION,
  now: () => new Date("2026-10-22T10:00:00.000Z"),
};

const withNote = (doc: ShelfDoc, text: string): ShelfDoc => ({
  ...doc,
  items: [
    ...doc.items,
    {
      ...NO_META,
      color: null,
      context: null,
      createdAt: "2026-10-22T10:00:00.000Z",
      done: false,
      id: ItemIdSchema.parse(
        `3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1b${String(doc.items.length + 10)}`
      ),
      html: null,
      kind: "text",
      links: [],
      sectionId: SECTION,
      text,
      via: "typed",
    },
  ],
});

const PICTURE = "3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1c01.png";
const REPORT = "3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1c02.pdf";
const STRAY = "3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1c03.png";

const captured = {
  app: "Safari",
  appPath: "/Applications/Safari.app",
  document: null,
  thumb: { file: PICTURE, heightPx: 720, pixelsPerDip: 1, widthPx: 1152 },
  title: "Trip planning",
  url: "https://example.com/",
};

const WINDOW_ID = WindowIdSchema.parse("3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1c09");

const withWindow = (doc: ShelfDoc, window: WindowRef): ShelfDoc => ({
  ...doc,
  items: doc.items.map((item) => ({ ...item, windows: [window] })),
});

/** A shelf naming a picture and a file, whose one window title is longer than the saved file allows. */
const unreadableShelf = (): string => {
  const doc = withWindow(withNote(emptyShelf(SECTION), "Trip notes"), {
    ...windowRef(captured, WINDOW_ID, options.now()),
    title: "t".repeat(600),
  });

  return JSON.stringify({
    ...doc,
    items: [
      ...doc.items,
      {
        ...NO_META,
        color: null,
        context: null,
        createdAt: "2026-10-22T10:00:00.000Z",
        done: false,
        file: { bytes: 3, name: "Report.pdf", stored: REPORT },
        id: ItemIdSchema.parse("3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1b90"),
        kind: "file",
        note: "",
        sectionId: SECTION,
        title: null,
      },
    ],
  });
};

const attachmentsIn = async (dir: string): Promise<string[]> => {
  const names = await readdir(path.join(dir, "attachments"));

  return names.toSorted();
};

describe(openShelfStore, () => {
  let dir = "";

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "shelf-store-"));
  });

  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  it("starts empty and reads back what it saved", async () => {
    const store = await openShelfStore(dir, options);

    expect(store.initial).toStrictEqual(emptyShelf(SECTION));
    await expect(
      store.save(withNote(store.initial, "keep"))
    ).resolves.toStrictEqual({ ok: true });

    const again = await openShelfStore(dir, options);

    expect(
      again.initial.items.map((item) => item.kind === "text" && item.text)
    ).toStrictEqual(["keep"]);
  });

  it("writes only the newest of several queued documents", async () => {
    const store = await openShelfStore(dir, options);
    const a = withNote(store.initial, "a");
    const b = withNote(a, "b");
    const c = withNote(b, "c");

    await Promise.all([store.save(a), store.save(b), store.save(c)]);

    const saved = ShelfDocSchema.parse(
      JSON.parse(await readFile(path.join(dir, "shelf.json"), "utf-8"))
    );

    const names = await readdir(dir);

    expect(saved.items).toHaveLength(3);
    expect(names.filter((name) => name.endsWith(".tmp"))).toStrictEqual([]);
  });

  it("sets an unreadable file aside and says so", async () => {
    await writeFile(path.join(dir, "shelf.json"), "{ not json");

    const store = await openShelfStore(dir, options);

    expect(store.initial.items).toStrictEqual([]);
    expect(store.recovered).toContain(
      "shelf.unreadable-2026-10-22T10-00-00.000Z.json"
    );
    await expect(readdir(dir)).resolves.toContain(
      "shelf.unreadable-2026-10-22T10-00-00.000Z.json"
    );
  });

  it("reports a failed write and keeps the previous file", async () => {
    const first = await openShelfStore(dir, options);

    await first.save(withNote(first.initial, "kept"));

    const store = await openShelfStore(dir, {
      ...options,
      fs: failNextWrite(nodeStoreFs),
    });

    const result = await store.save(withNote(store.initial, "lost"));

    const reopened = await openShelfStore(dir, options);

    expect(result).toStrictEqual({ message: "The disk is full.", ok: false });
    expect(reopened.initial.items).toHaveLength(1);
  });

  it("deletes attachments the document no longer names, and nothing else", async () => {
    const store = await openShelfStore(dir, options);
    const file = await store.writeAttachment(new Uint8Array([1, 2, 3]));

    await mkdir(path.join(dir, "attachments"), { recursive: true });
    await writeFile(path.join(dir, "attachments", "notes.txt"), "mine");
    await openShelfStore(dir, options);

    await expect(readdir(path.join(dir, "attachments"))).resolves.toStrictEqual(
      ["notes.txt"]
    );
    expect(store.attachmentPath(file)).toBe(
      path.join(dir, "attachments", file)
    );
    expect(store.attachmentPath("../shelf.json")).toBeNull();
  });

  it("copies an added file under a generated name with its extension", async () => {
    const store = await openShelfStore(dir, options);
    const source = path.join(dir, "Quarterly report.pdf");

    await writeFile(source, "pdf bytes");

    const stored = await store.copyAttachment(source, "pdf");
    const copy = await readFile(path.join(dir, "attachments", stored), "utf-8");

    expect(stored).toMatch(/^[0-9a-f-]{36}\.pdf$/u);
    expect(copy).toBe("pdf bytes");
  });

  describe("when shelf.json can't be read", () => {
    beforeEach(async () => {
      await mkdir(path.join(dir, "attachments"), { recursive: true });
      await Promise.all(
        [PICTURE, REPORT, STRAY].map(async (name) => {
          await writeFile(path.join(dir, "attachments", name), name);
        })
      );
    });

    it("keeps its pictures and files on this launch and every later one", async () => {
      const raw = unreadableShelf();

      await writeFile(path.join(dir, "shelf.json"), raw);

      const store = await openShelfStore(dir, options);

      expect(store.initial.items).toStrictEqual([]);
      expect(store.recovered).toContain("shelf.unreadable-");
      await expect(attachmentsIn(dir)).resolves.toStrictEqual(
        [PICTURE, REPORT, STRAY].toSorted()
      );
      await expect(
        readFile(
          path.join(dir, "shelf.unreadable-2026-10-22T10-00-00.000Z.json"),
          "utf-8"
        )
      ).resolves.toBe(raw);

      await store.save(withNote(store.initial, "after"));
      await openShelfStore(dir, options);

      await expect(attachmentsIn(dir)).resolves.toStrictEqual(
        [PICTURE, REPORT].toSorted()
      );
    });

    it("never writes over a file it could neither read nor set aside", async () => {
      const raw = unreadableShelf();

      await writeFile(path.join(dir, "shelf.json"), raw);

      const store = await openShelfStore(dir, {
        ...options,
        fs: {
          ...nodeStoreFs,
          rename: async () => {
            await Promise.reject(new Error("EBUSY"));
          },
        },
      });

      const result = await store.save(withNote(store.initial, "new"));

      expect(store.recovered).toContain("could not be read or set aside");
      expect(result.ok).toBeFalsy();
      await expect(
        readFile(path.join(dir, "shelf.json"), "utf-8")
      ).resolves.toBe(raw);
      await expect(attachmentsIn(dir)).resolves.toStrictEqual(
        [PICTURE, REPORT, STRAY].toSorted()
      );
    });

    it("never writes over a file it was not allowed to open", async () => {
      await writeFile(path.join(dir, "shelf.json"), "kept as it is");

      const denied: StoreFs = {
        ...nodeStoreFs,
        readFile: async (file) => {
          if (file.endsWith("shelf.json")) {
            throw Object.assign(new Error("permission denied"), {
              code: "EACCES",
            });
          }

          return await nodeStoreFs.readFile(file);
        },
      };

      const store = await openShelfStore(dir, { ...options, fs: denied });
      const result = await store.save(withNote(store.initial, "new"));

      expect(store.recovered).toContain("could not be opened (EACCES)");
      expect(result.ok).toBeFalsy();
      await expect(
        readFile(path.join(dir, "shelf.json"), "utf-8")
      ).resolves.toBe("kept as it is");
      await expect(attachmentsIn(dir)).resolves.toStrictEqual(
        [PICTURE, REPORT, STRAY].toSorted()
      );
    });
  });

  it("refuses to save a shelf it could not read back, keeping the last one", async () => {
    const store = await openShelfStore(dir, options);

    await store.save(withNote(store.initial, "kept"));

    const saved = await readFile(path.join(dir, "shelf.json"), "utf-8");

    const result = await store.save(
      withWindow(withNote(store.initial, "too long"), {
        ...windowRef(captured, WINDOW_ID, options.now()),
        title: "t".repeat(600),
      })
    );

    expect(result.ok).toBeFalsy();
    await expect(readFile(path.join(dir, "shelf.json"), "utf-8")).resolves.toBe(
      saved
    );
  });

  it("saves and reopens a window whose title was longer than the file keeps", async () => {
    const store = await openShelfStore(dir, options);

    const window = windowRef(
      { ...captured, title: "t".repeat(600) },
      WINDOW_ID,
      options.now()
    );

    const result = await store.save(
      withWindow(withNote(store.initial, "Long title"), window)
    );

    const reopened = await openShelfStore(dir, options);

    expect(result).toStrictEqual({ ok: true });
    expect(reopened.recovered).toBeNull();
    expect(reopened.initial.items[0]?.windows[0]?.title).toBe(
      `${"t".repeat(499)}…`
    );
  });
});

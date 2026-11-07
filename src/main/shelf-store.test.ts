import { once } from "node:events";
import {
  mkdtemp,
  readdir,
  readFile,
  rename,
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
  NO_META,
  WindowIdSchema,
} from "@shared/shelf";
import type { ShelfDoc, WindowRef } from "@shared/shelf";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createShelfController } from "./shelf-controller";
import { failNextWrite, nodeStoreFs, openShelfStore } from "./shelf-store";
import type { ShelfStore, StoreFs } from "./shelf-store";
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

  it("keeps the shelf from before each write and renames it back on request, on a disk too full to write", async () => {
    const store = await openShelfStore(dir, options);
    const kept = withNote(store.initial, "kept");

    await store.save(kept);
    await store.save(withNote(kept, "discarded"));

    const full = await openShelfStore(dir, {
      ...options,
      fs: {
        ...nodeStoreFs,
        writeTemp: () => {
          throw Object.assign(new Error("full"), { code: "ENOSPC" });
        },
      },
    });

    const restored = await full.restorePrevious();
    const reopened = await openShelfStore(dir, options);
    const names = await readdir(dir);

    expect({
      names: names.filter((name) => name.startsWith("shelf")),
      restored,
      texts: reopened.initial.items.map(
        (item) => item.kind === "text" && item.text
      ),
    }).toStrictEqual({
      names: ["shelf.json"],
      restored: true,
      texts: ["kept"],
    });
  });

  it("drops a write that is no longer current before it replaces the file, and leaves no temporary file", async () => {
    const store = await openShelfStore(dir, options);

    await store.save(withNote(store.initial, "kept"));

    const result = await store.save(
      withNote(store.initial, "stale"),
      () => false
    );

    const reopened = await openShelfStore(dir, options);
    const names = await readdir(dir);

    expect({
      names: names.filter((name) => name.startsWith("shelf")),
      result,
      texts: reopened.initial.items.map(
        (item) => item.kind === "text" && item.text
      ),
    }).toStrictEqual({
      names: ["shelf.json"],
      result: { dropped: true, ok: false },
      texts: ["kept"],
    });
  });

  it("opens the shelf from before the last write when a write stopped before its new file took the shelf's place", async () => {
    const store = await openShelfStore(dir, options);

    await store.save(withNote(store.initial, "kept"));
    await rename(
      path.join(dir, "shelf.json"),
      path.join(dir, "shelf.json.prev")
    );

    const reopened = await openShelfStore(dir, options);

    expect(
      reopened.initial.items.map((item) => item.kind === "text" && item.text)
    ).toStrictEqual(["kept"]);
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

const fsError = (code: string): Error =>
  Object.assign(new Error(code), { code });

/** The real controller on a store, as main runs it, with ids the test can read. */
const controllerOn = (store: ShelfStore) => {
  let next = 10;

  return createShelfController({
    deleteAttachment: store.deleteAttachment,
    env: {
      newItemId: () =>
        ItemIdSchema.parse(
          `3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1d${String((next += 1))}`
        ),
      newSectionId: () => SECTION,
      now: options.now,
    },
    initial: store.initial,
    restore: store.restorePrevious,
    save: store.save,
    setTimer: () => () => {},
    status: {
      floatOnTop: true,
      keys: "granted",
      problem: null,
      quitPrompt: null,
      readOnly: store.readOnly,
      saveError: null,
      selectionCapture: true,
    },
  });
};

const texts = (doc: ShelfDoc): string[] =>
  doc.items.map((entry) => (entry.kind === "text" ? entry.text : entry.kind));

describe("the store under Discard changes and failing file operations (red-team round 8)", () => {
  let dir = "";

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "shelf-discard-"));
  });

  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  /**
   * A Retry of a failed save, with Discard changes coming after the
   * `at`-th file operation that finished, and the shelf the next launch
   * would open read after each operation from then on, as if the app died
   * there.
   */
  const discardDuringRetry = async (at: number) => {
    const runDir = path.join(dir, `discard-after-${String(at)}`);
    const crash = { armed: false, discard: (): void => {}, point: 0 };
    const reopened: string[] = [];
    let discarded = false;
    let full = false;

    const crashPoint = async (): Promise<void> => {
      if (!crash.armed) {
        return;
      }

      if (crash.point === at) {
        discarded = true;
        crash.discard();
      }

      crash.point += 1;

      if (discarded) {
        const next = await openShelfStore(runDir, options);

        reopened.push(...texts(next.initial));
      }
    };

    const fs: StoreFs = {
      ...nodeStoreFs,
      rename: async (from, to) => {
        await nodeStoreFs.rename(from, to);
        await crashPoint();
      },
      writeTemp: async (file, data) => {
        if (full) {
          throw fsError("ENOSPC");
        }

        const temp = await nodeStoreFs.writeTemp(file, data);

        await crashPoint();

        return temp;
      },
    };

    await mkdir(runDir);
    const store = await openShelfStore(runDir, { ...options, fs });
    const controller = controllerOn(store);
    const id = controller.apply({ text: "SAVED WORDS", type: "compose" });

    if (id === null) {
      throw new Error("not added");
    }

    await controller.flush();
    full = true;
    controller.apply({ id, text: "DISCARDED WORDS", type: "editText" });
    await controller.flush();
    full = false;
    crash.armed = true;

    crash.discard = () => {
      controller.discard(id);
    };

    await controller.flush();
    crash.armed = false;

    const last = await openShelfStore(runDir, options);

    return { discarded, last: texts(last.initial), reopened };
  };

  it("never puts the discarded words in the shelf's place, wherever in a Retry's write the Discard comes and the app then dies", async () => {
    const runs = await Promise.all([0, 1, 2, 3].map(discardDuringRetry));
    const discardedRuns = runs.filter((run) => run.discarded);

    expect({
      first: runs[0]?.discarded,
      last: [...new Set(discardedRuns.flatMap((run) => run.last))],
      reopened: [...new Set(discardedRuns.flatMap((run) => run.reopened))],
    }).toStrictEqual({
      first: true,
      last: ["SAVED WORDS"],
      reopened: ["SAVED WORDS"],
    });
  });

  /** Kept, then a failed save of Drop, so the item offers Discard changes; the next write's temp file is held once written. */
  const failedThenHeld = async (fs: StoreFs) => {
    const store = await openShelfStore(dir, { ...options, fs });
    const controller = controllerOn(store);
    const id = controller.apply({ text: "KEPT", type: "compose" });

    if (id === null) {
      throw new Error("not added");
    }

    await controller.flush();

    return { controller, id };
  };

  it("saves again after a temporary file of a dropped write couldn't be deleted", async () => {
    const gate = new EventTarget();
    const written = new EventTarget();
    const disk = { deny: false, failOnce: false, hold: false };

    const app = await failedThenHeld({
      ...nodeStoreFs,
      remove: async (file) => {
        if (disk.deny && file.endsWith(".tmp")) {
          throw fsError("EPERM");
        }

        await nodeStoreFs.remove(file);
      },
      writeTemp: async (file, data) => {
        if (disk.failOnce) {
          disk.failOnce = false;
          throw fsError("ENOSPC");
        }

        const temp = await nodeStoreFs.writeTemp(file, data);

        if (disk.hold) {
          disk.hold = false;
          written.dispatchEvent(new Event("written"));
          await once(gate, "release");
        }

        return temp;
      },
    });

    disk.failOnce = true;
    app.controller.apply({ id: app.id, text: "DROP", type: "editText" });
    await app.controller.flush();
    const offered = app.controller.view().notSaved;

    disk.hold = true;
    const tempWritten = once(written, "written");
    const retry = app.controller.flush();

    await tempWritten;
    app.controller.discard(app.id);
    disk.deny = true;
    gate.dispatchEvent(new Event("release"));
    const first = await retry;

    disk.deny = false;
    app.controller.apply({
      id: app.id,
      text: "NEW VALID EDIT",
      type: "editText",
    });
    const second = await app.controller.flush();
    const reopened = await openShelfStore(dir, options);

    expect({
      first,
      offered,
      reopened: texts(reopened.initial),
      second,
    }).toStrictEqual({
      first: { ok: true },
      offered: [{ id: app.id, undo: "discard" }],
      reopened: ["NEW VALID EDIT"],
      second: { ok: true },
    });
  });

  it("saves again after a picture a write let go of couldn't be deleted", async () => {
    let deny = false;

    const store = await openShelfStore(dir, {
      ...options,
      fs: {
        ...nodeStoreFs,
        remove: async (file) => {
          if (deny) {
            throw fsError("EBUSY");
          }

          await nodeStoreFs.remove(file);
        },
      },
    });

    const controller = controllerOn(store);
    const before = await store.writeAttachment(new Uint8Array([1, 2, 3]));
    const after = await store.writeAttachment(new Uint8Array([4, 5, 6]));
    const image = { heightPx: 3, pixelsPerDip: 1, widthPx: 4 };

    const id = controller.apply({
      context: null,
      image: { ...image, file: before },
      pins: [],
      source: null,
      type: "addImage",
      via: "area",
    });

    if (id === null) {
      throw new Error("not added");
    }

    await controller.flush();
    deny = true;
    controller.apply({
      id,
      image: { ...image, file: after },
      type: "replaceImage",
    });
    const replaced = await controller.flush();

    deny = false;
    controller.apply({ text: "written afterwards", type: "compose" });
    const later = await controller.flush();
    const reopened = await openShelfStore(dir, options);

    expect({
      later,
      reopened: texts(reopened.initial),
      replaced,
    }).toStrictEqual({
      later: { ok: true },
      reopened: ["image", "written afterwards"],
      replaced: { ok: true },
    });
  });

  it("opens when a picture no shelf names can't be deleted, and keeps it for a later launch", async () => {
    await mkdir(path.join(dir, "attachments"));
    await writeFile(path.join(dir, "attachments", STRAY), STRAY);

    const store = await openShelfStore(dir, {
      ...options,
      fs: {
        ...nodeStoreFs,
        remove: async () => {
          await Promise.reject(fsError("EBUSY"));
        },
      },
    });

    expect({
      files: await attachmentsIn(dir),
      readOnly: store.readOnly,
    }).toStrictEqual({ files: [STRAY], readOnly: false });
  });

  it("forgets the failure of a write Discard changes made stale while its temporary file was written", async () => {
    const gate = new EventTarget();
    const written = new EventTarget();
    const disk = { failOnce: false, hold: false };

    const app = await failedThenHeld({
      ...nodeStoreFs,
      writeTemp: async (file, data) => {
        if (disk.failOnce) {
          disk.failOnce = false;
          throw fsError("ENOSPC");
        }

        if (disk.hold) {
          disk.hold = false;
          written.dispatchEvent(new Event("writing"));
          await once(gate, "release");
          throw fsError("ENOSPC");
        }

        return await nodeStoreFs.writeTemp(file, data);
      },
    });

    disk.failOnce = true;
    app.controller.apply({ id: app.id, text: "DROP", type: "editText" });
    await app.controller.flush();
    disk.hold = true;
    const writing = once(written, "writing");
    const retry = app.controller.flush();

    await writing;
    app.controller.discard(app.id);
    gate.dispatchEvent(new Event("release"));
    const result = await retry;
    const reopened = await openShelfStore(dir, options);

    expect({
      error: app.controller.view().status.saveError,
      notSaved: app.controller.view().notSaved,
      reopened: texts(reopened.initial),
      result,
      unsaved: app.controller.unsaved(),
    }).toStrictEqual({
      error: null,
      notSaved: [],
      reopened: ["KEPT"],
      result: { ok: true },
      unsaved: 0,
    });
  });
});

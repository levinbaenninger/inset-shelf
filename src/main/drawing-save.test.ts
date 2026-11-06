import { once } from "node:events";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setImmediate } from "node:timers/promises";

import type { QuitPrompt } from "@shared/contracts";
import { ItemIdSchema, SectionIdSchema } from "@shared/shelf";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDrawingSaves } from "./drawing-save";
import { createQuitHold, drawingMarks } from "./quit-hold";
import { createShelfController } from "./shelf-controller";
import { nodeStoreFs, openShelfStore } from "./shelf-store";
import type { StoreFs } from "./shelf-store";

const uuid = (n: number) =>
  `5b7e2c1d-8f3a-4d6b-9e0c-2a4f6d8b1c${String(n).padStart(2, "0")}`;

const SECTION = SectionIdSchema.parse(uuid(1));

const PNG = new Uint8Array([137, 80, 78, 71]);

const fullDisk = (): Error =>
  Object.assign(new Error("no space left"), { code: "ENOSPC" });

/**
 * Main's drawing saves on the real controller, store (in a temporary
 * folder) and quit hold. The disk can hold the next shelf.json write back
 * or fill up; the drawing window and its page are stand-ins that save as
 * the page does when a held quit's Retry asks.
 */
/** `blocked`: shelf.json can't be read at launch, so nothing is saved this session. */
const setup = async (dir: string, blocked = false) => {
  const disk = { attachmentsFull: false, full: false };
  let hold: Promise<unknown> | null = null;
  const writeStarted = new EventTarget();

  const fs: StoreFs = {
    ...nodeStoreFs,
    readFile: async (file) => {
      if (blocked && file.endsWith("shelf.json")) {
        throw Object.assign(new Error("denied"), { code: "EACCES" });
      }

      return await nodeStoreFs.readFile(file);
    },
    writeAtomic: async (file, data) => {
      if (disk.attachmentsFull) {
        throw fullDisk();
      }

      await nodeStoreFs.writeAtomic(file, data);
    },
    writeTemp: async (file, data) => {
      if (file.endsWith("shelf.json")) {
        const held = hold;

        hold = null;
        writeStarted.dispatchEvent(new Event("start"));
        await held;

        if (disk.full) {
          throw fullDisk();
        }
      }

      return await nodeStoreFs.writeTemp(file, data);
    },
  };

  const options = {
    newSectionId: () => SECTION,
    now: () => new Date("2026-11-06T10:00:00.000Z"),
  };

  const store = await openShelfStore(dir, { ...options, fs });
  let nextId = 10;

  const controller = createShelfController({
    deleteAttachment: store.deleteAttachment,
    env: {
      newItemId: () => ItemIdSchema.parse(uuid((nextId += 1))),
      newSectionId: () => SectionIdSchema.parse(uuid((nextId += 1))),
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

  /** The drawing window: open with marks the page reports as unsaved. */
  const window = { dirty: true, visible: true };
  const settledSave = new EventTarget();
  const pageSaves: Promise<unknown>[] = [];

  const saves = createDrawingSaves({
    added: () => {},
    clearStaging: () => {},
    close: () => {
      window.visible = false;
      window.dirty = false;
      settledSave.dispatchEvent(new Event("settled"));
    },
    controller,
    copies: {
      copy: async () => await Promise.resolve({ ok: true }),
      copyDrawing: async () => await Promise.resolve({ ok: true }),
    },
    decode: (png) => ({ heightPx: 3, png, widthPx: 4 }),
    ended: () => {
      settledSave.dispatchEvent(new Event("settled"));
    },
    readFile: async () => await Promise.resolve(null),
    show: () => {},
    store,
  });

  saves.open(null);

  const shown: QuitPrompt[] = [];
  let prompt: QuitPrompt | null = null;
  const finished: string[] = [];

  const quitHold = createQuitHold({
    ask: async () => await Promise.resolve("cancel"),
    flush: controller.flush,
    pageDrafts: () => 0,
    prompt: (next) => {
      prompt = next;

      if (next !== null) {
        shown.push(next);
      }
    },
    quitting: () => {},
    // As main does: the page saves its marks, as its Save button would, and the hold waits for that save to end.
    saveDrawing: async (stop) => {
      const ended = window.dirty
        ? once(settledSave, "settled")
        : Promise.resolve();

      saves.forQuit(stop);
      pageSaves.push(
        saves.save({ copy: false, forQuit: true, pins: [], png: PNG })
      );
      await ended;
    },
    settlePage: async () => await Promise.resolve(true),
    setTimer: () => () => {},
    state: () => {
      const marks = saves.state();

      return {
        drawing: drawingMarks(window.dirty, marks.onShelf),
        drawingError: marks.error,
        readOnly: store.readOnly,
        saveError: controller.view().status.saveError,
        unsaved: controller.unsaved(),
      };
    },
  });

  return {
    /** The shelf as the next launch opens it, and its pictures. */
    reopened: async () => {
      const again = await openShelfStore(dir, { ...options, fs: nodeStoreFs });
      const files = await readdir(path.join(dir, "attachments"));

      return { files, items: again.initial.items };
    },
    controller,
    disk,
    finished,
    /** The next shelf.json write waits until the returned function runs; `started` resolves once it is on its way. */
    holdNextWrite: () => {
      const gate = new EventTarget();

      hold = once(gate, "release");

      return {
        release: (): void => {
          gate.dispatchEvent(new Event("release"));
        },
        started: once(writeStarted, "start"),
      };
    },
    pageSaves,
    prompt: () => prompt,
    quit: async () => {
      quitHold.request(() => {
        finished.push("quit");
      });
      await vi.waitFor(() => {
        expect(prompt !== null || finished.length > 0).toBeTruthy();
      });
    },
    quitHold,
    saves,
    store,
    window,
  };
};

/** An image on the shelf, open in Annotate, its picture read from the disk as main reads it. */
const annotating = async (app: Awaited<ReturnType<typeof setup>>) => {
  const original = new Uint8Array([1, 2, 3]);
  const file = await app.store.writeAttachment(original);

  const id = app.controller.apply({
    context: null,
    image: { file, heightPx: 3, pixelsPerDip: 1, widthPx: 4 },
    pins: [],
    source: null,
    type: "addImage",
    via: "area",
  });

  if (id === null) {
    throw new Error("not added");
  }

  await app.controller.flush();

  const saves = createDrawingSaves({
    added: () => {},
    clearStaging: () => {},
    close: () => {},
    controller: app.controller,
    copies: {
      copy: async () => await Promise.resolve({ ok: true }),
      copyDrawing: async () => await Promise.resolve({ ok: true }),
    },
    decode: (png) => ({ heightPx: 3, png, widthPx: 4 }),
    ended: () => {},
    readFile: async (at) => new Uint8Array(await readFile(at)),
    show: () => {},
    store: app.store,
  });

  saves.open(id);

  /** The image as the next launch opens it: its picture's bytes and its pins. */
  const reopened = async () => {
    const { files, items } = await app.reopened();
    const [image] = items;

    if (image?.kind !== "image") {
      throw new Error("no image");
    }

    const at = app.store.attachmentPath(image.image.file) ?? "";

    return {
      files: files.length,
      picture: [...(await readFile(at))],
      pins: image.pins,
    };
  };

  return { original: [...original], reopened, saves };
};

describe(createDrawingSaves, () => {
  let dir = "";

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "drawing-save-"));
  });

  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  it("keeps the drawing open with its marks when Cancel comes while shelf.json is still being written", async () => {
    const app = await setup(dir);

    await app.quit();
    const write = app.holdNextWrite();

    app.quitHold.answer("retry");
    await write.started;
    app.quitHold.answer("cancel");
    const cancelled = { ...app.window };

    write.release();
    await Promise.all(app.pageSaves);
    await app.controller.flush();

    // The disk holds the drawing now, so quitting again loses nothing.
    await app.quit();
    const { items } = await app.reopened();

    expect({
      afterWrite: { ...app.window },
      cancelled,
      finished: app.finished,
      items: items.map((item) => item.kind),
    }).toStrictEqual({
      afterWrite: { dirty: true, visible: true },
      cancelled: { dirty: true, visible: true },
      finished: ["quit"],
      items: ["image"],
    });
  });

  it("tells the close confirm what the shelf holds of a new drawing: nothing, the drawing as it is once a held quit saved it, then an earlier version (Opus and Sol round 8)", async () => {
    const app = await setup(dir);
    const before = app.saves.kept();

    await app.quit();
    const write = app.holdNextWrite();

    app.quitHold.answer("retry");
    await write.started;
    app.quitHold.answer("cancel");
    write.release();
    await Promise.all(app.pageSaves);
    await app.controller.flush();
    const saved = app.saves.kept();

    app.saves.changed();
    const changed = app.saves.kept();

    const [made] = app.controller.view().doc.items;

    if (made === undefined) {
      throw new Error("the drawing is not on the shelf");
    }

    app.controller.apply({ id: made.id, type: "remove" });

    expect({
      before,
      changed,
      removed: app.saves.kept(),
      saved,
    }).toStrictEqual({
      before: "none",
      changed: "earlier",
      removed: "none",
      saved: "asIs",
    });
  });

  it("stays open and unsaved until shelf.json holds the drawing, and puts it on the shelf once however often Retry runs", async () => {
    const app = await setup(dir);

    await app.quit();
    app.disk.full = true;
    app.quitHold.answer("retry");
    await vi.waitFor(() => {
      expect(app.prompt()?.state).toBe("stillFailing");
    });

    const failed = {
      items: app.controller.view().doc.items.length,
      prompt: app.prompt(),
      window: { ...app.window },
    };

    app.disk.full = false;
    app.quitHold.answer("retry");
    await vi.waitFor(() => {
      expect(app.finished).toStrictEqual(["quit"]);
    });
    await Promise.all(app.pageSaves);
    const { files, items } = await app.reopened();

    expect({
      failed,
      files: files.length,
      items: items.length,
      window: app.window,
    }).toStrictEqual({
      failed: {
        items: 1,
        prompt: {
          count: 1,
          message: "The disk is full.",
          state: "stillFailing",
        },
        window: { dirty: true, visible: true },
      },
      files: 1,
      items: 1,
      window: { dirty: false, visible: false },
    });
  });

  it("says why the drawing's own save failed in the held quit prompt", async () => {
    const app = await setup(dir);

    await app.quit();
    const asking = app.prompt();

    app.disk.attachmentsFull = true;
    app.quitHold.answer("retry");
    await vi.waitFor(() => {
      expect(app.prompt()?.state).toBe("stillFailing");
    });

    expect({ asking, retried: app.prompt(), window: app.window }).toStrictEqual(
      {
        asking: {
          count: 1,
          message: "Your drawing isn’t on the shelf yet.",
          state: "asking",
        },
        retried: {
          count: 1,
          message: "The disk is full. Your drawing isn’t on the shelf yet.",
          state: "stillFailing",
        },
        window: { dirty: true, visible: true },
      }
    );
  });

  it("counts the drawing again once its marks change after a held quit put them on the shelf", async () => {
    const app = await setup(dir);

    await app.quit();
    app.disk.full = true;
    app.quitHold.answer("retry");
    await vi.waitFor(() => {
      expect(app.prompt()?.state).toBe("stillFailing");
    });
    app.quitHold.answer("cancel");
    const { onShelf } = app.saves.state();

    app.saves.changed();
    await app.quit();

    expect({ onShelf, prompt: app.prompt() }).toStrictEqual({
      onShelf: true,
      prompt: {
        count: 2,
        message: "The disk is full. Your drawing isn’t on the shelf yet.",
        state: "asking",
      },
    });
  });

  it("counts the drawing again once the item a held quit put it on is deleted from the shelf", async () => {
    const app = await setup(dir);

    await app.quit();
    app.disk.full = true;
    app.quitHold.answer("retry");
    await vi.waitFor(() => {
      expect(app.prompt()?.state).toBe("stillFailing");
    });
    app.quitHold.answer("cancel");

    const [made] = app.controller.view().doc.items;

    if (made === undefined) {
      throw new Error("the drawing is not on the shelf");
    }

    app.controller.apply({ id: made.id, type: "remove" });
    await app.quit();

    expect({
      finished: app.finished,
      prompt: app.prompt(),
      window: app.window,
    }).toStrictEqual({
      finished: [],
      prompt: {
        count: 1,
        message: "The disk is full. Your drawing isn’t on the shelf yet.",
        state: "asking",
      },
      window: { dirty: true, visible: true },
    });
  });

  it("holds the quit after Retry in a session that saves nothing, with the drawing still open", async () => {
    const app = await setup(dir, true);

    await app.quit();
    app.quitHold.answer("retry");
    await vi.waitFor(() => {
      expect(app.prompt()?.state).toBe("stillFailing");
    });

    expect({
      finished: app.finished,
      prompt: app.prompt(),
      window: app.window,
    }).toStrictEqual({
      finished: [],
      prompt: {
        count: 1,
        message:
          "Nothing is saved this session, so the shelf file that could not be opened stays as it was. Your drawing isn’t on the shelf yet.",
        state: "stillFailing",
      },
      window: { dirty: true, visible: true },
    });
  });

  it("saves the picture the window shows once Undo takes out a stroke a held quit's save drew in (red-team round 8)", async () => {
    const app = await setup(dir);
    const image = await annotating(app);

    image.saves.forQuit(new AbortController().signal);
    app.disk.full = true;

    const stroked = await image.saves.save({
      copy: false,
      forQuit: true,
      pins: [],
      png: PNG,
    });

    // Cancel keeps the window open; Undo takes the stroke out and a pin goes on, so the page sends only pins.
    image.saves.changed();
    app.disk.full = false;
    image.saves.forQuit(new AbortController().signal);

    const pinned = await image.saves.save({
      copy: false,
      forQuit: true,
      pins: [{ x: 1, y: 2 }],
      png: null,
    });

    const saved = await image.reopened();

    expect({ pinned, saved, stroked }).toStrictEqual({
      pinned: { ok: true },
      saved: { files: 1, picture: image.original, pins: [{ x: 1, y: 2 }] },
      stroked: { message: "The disk is full.", ok: false },
    });
  });

  it("writes no new picture when only the pins of an image change", async () => {
    const app = await setup(dir);
    const image = await annotating(app);

    image.saves.forQuit(new AbortController().signal);

    const pinned = await image.saves.save({
      copy: false,
      forQuit: true,
      pins: [{ x: 1, y: 2 }],
      png: null,
    });

    expect({ pinned, saved: await image.reopened() }).toStrictEqual({
      pinned: { ok: true },
      saved: { files: 1, picture: image.original, pins: [{ x: 1, y: 2 }] },
    });
  });

  it("annotates the picture the window opened on, however often a held quit saves it", async () => {
    const app = await setup(dir);
    const original = new Uint8Array([1, 2, 3]);

    const other = await openShelfStore(dir, {
      fs: nodeStoreFs,
      newSectionId: () => SECTION,
      now: () => new Date(),
    });

    const file = await other.writeAttachment(original);

    const id = app.controller.apply({
      context: null,
      image: { file, heightPx: 3, pixelsPerDip: 1, widthPx: 4 },
      pins: [],
      source: null,
      type: "addImage",
      via: "area",
    });

    if (id === null) {
      throw new Error("not added");
    }

    await app.controller.flush();
    const reads: string[] = [];

    const saves = createDrawingSaves({
      added: () => {},
      clearStaging: () => {},
      close: () => {},
      controller: app.controller,
      copies: {
        copy: async () => await Promise.resolve({ ok: true }),
        copyDrawing: async () => await Promise.resolve({ ok: true }),
      },
      decode: (png) => ({ heightPx: 3, png, widthPx: 4 }),
      ended: () => {},
      readFile: async (at) => {
        reads.push(path.basename(at));

        return await Promise.resolve(original);
      },
      show: () => {},
      store: {
        attachmentPath: (name) => path.join(dir, "attachments", name),
        deleteAttachment: async () => {},
        writeAttachment: async () => await Promise.resolve(`${uuid(99)}.png`),
      },
    });

    saves.open(id);
    saves.forQuit(new AbortController().signal);
    app.disk.full = true;
    await saves.save({ copy: false, forQuit: true, pins: [], png: PNG });
    const image = await saves.image();
    await setImmediate();

    expect({ image, reads }).toStrictEqual({ image: original, reads: [file] });
  });
});

import { once } from "node:events";

import {
  emptyShelf,
  itemDetailsText,
  ItemIdSchema,
  SectionIdSchema,
  UNDO_MAX,
  WindowIdSchema,
} from "@shared/shelf";
import type { ShelfDoc, WindowRef } from "@shared/shelf";
import { describe, expect, it, vi } from "vitest";

import { createShelfController, EDIT_SAVE_DELAY_MS } from "./shelf-controller";
import type { WriteResult } from "./shelf-store";

const uuid = (n: number) =>
  `3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1b${String(n).padStart(2, "0")}`;

const SECTION = SectionIdSchema.parse(uuid(1));

/** `hold` keeps every save on the disk until it resolves. */
const setup = (
  results: WriteResult[] = [],
  hold: Promise<void> = Promise.resolve()
) => {
  let next = 10;
  const saved: ShelfDoc[] = [];
  const deleted: string[] = [];
  const timers: { run: () => void; ms: number }[] = [];

  const controller = createShelfController({
    deleteAttachment: async (file) => {
      deleted.push(file);
      await Promise.resolve();
    },
    env: {
      newItemId: () => ItemIdSchema.parse(uuid((next += 1))),
      newSectionId: () => SectionIdSchema.parse(uuid((next += 1))),
      now: () => new Date("2026-10-22T10:00:00.000Z"),
    },
    initial: emptyShelf(SECTION),
    restore: async () => await Promise.resolve(false),
    save: async (doc) => {
      saved.push(doc);
      await hold;

      return results.shift() ?? { ok: true };
    },
    setTimer: (run, ms) => {
      const timer = { ms, run };

      timers.push(timer);

      return () => {
        timers.splice(timers.indexOf(timer), 1);
      };
    },
    status: {
      floatOnTop: true,
      keys: "granted",
      problem: null,
      quitPrompt: null,
      readOnly: false,
      saveError: null,
      selectionCapture: true,
    },
  });

  return { controller, deleted, saved, timers };
};

const image = {
  file: `${uuid(90)}.png`,
  heightPx: 10,
  pixelsPerDip: 1,
  widthPx: 10,
};

/** A window linked to an item, for the undo of its removal. */
const linked = (n: number): WindowRef => ({
  app: "Safari",
  appPath: "/Applications/Safari.app",
  capturedAt: "2026-10-22T10:00:00.000Z",
  description: "",
  document: null,
  id: WindowIdSchema.parse(uuid(n)),
  thumb: null,
  title: `Window ${n}`,
  url: null,
});

describe(createShelfController, () => {
  it("saves additions at once and note edits after a pause", async () => {
    const { controller, saved, timers } = setup();

    const id = controller.apply({
      image,
      pins: [],
      source: null,
      context: null,
      type: "addImage",
      via: "area",
    });

    await controller.flush();
    expect(saved).toHaveLength(1);

    if (id === null) {
      throw new Error("no id");
    }

    controller.apply({ id, note: "a", type: "editNote" });
    controller.apply({ id, note: "ab", type: "editNote" });
    expect(timers).toStrictEqual([
      expect.objectContaining({ ms: EDIT_SAVE_DELAY_MS }),
    ]);

    await controller.flush();
    expect(saved.at(-1)?.items[0]).toMatchObject({ note: "ab" });
    expect(saved).toHaveLength(2);
  });

  it("copies what was just typed while its save still waits for a pause", () => {
    const { controller, timers } = setup();

    const id = controller.apply({
      image,
      pins: [],
      source: null,
      context: null,
      type: "addImage",
      via: "area",
    });

    if (id === null) {
      throw new Error("no id");
    }

    controller.apply({ id, note: "Call Rieder", type: "editNote" });
    controller.apply({
      description: "Before Friday",
      id,
      type: "setDescription",
    });

    const item = controller.item(id);

    expect(timers).toHaveLength(1);
    expect(item === undefined ? null : itemDetailsText(item)).toBe(
      "Call Rieder\n\nBefore Friday"
    );
  });

  it("deletes an image file only once it falls off the undo list", async () => {
    const { controller, deleted } = setup();

    const first = controller.apply({
      image,
      pins: [],
      source: null,
      context: null,
      type: "addImage",
      via: "area",
    });

    const notes = Array.from({ length: UNDO_MAX }, (_, n) =>
      controller.apply({ text: `note ${n}`, type: "compose" })
    );

    if (first === null || notes.includes(null)) {
      throw new Error("no id");
    }

    controller.apply({ id: first, type: "remove" });

    for (const note of notes.slice(0, -1)) {
      if (note !== null) {
        controller.apply({ id: note, type: "remove" });
      }
    }

    await controller.flush();
    expect(deleted).toStrictEqual([]);
    expect(controller.view().canUndo).toBeTruthy();

    const last = notes.at(-1);

    if (last !== null && last !== undefined) {
      controller.apply({ id: last, type: "remove" });
    }

    await controller.flush();
    expect(deleted).toStrictEqual([image.file]);
  });

  it("restores the last removal", async () => {
    const { controller } = setup();
    const id = controller.apply({ text: "keep me", type: "compose" });

    if (id === null) {
      throw new Error("no id");
    }

    controller.apply({ id, type: "remove" });
    controller.apply({ type: "undoRemove" });
    await controller.flush();
    expect(controller.view()).toMatchObject({
      canUndo: false,
      doc: { items: [{ id }] },
    });
  });

  it("shows a failed save and clears it after the next one succeeds", async () => {
    const { controller } = setup([{ message: "disk full", ok: false }]);

    controller.apply({ text: "one", type: "compose" });
    await controller.flush();
    expect(controller.view().status.saveError).toBe("disk full");

    controller.apply({ text: "two", type: "compose" });
    await controller.flush();
    expect(controller.view().status.saveError).toBeNull();
  });

  it("keeps reporting a failed save until a retry reaches the disk", async () => {
    const { controller, saved } = setup([
      { message: "disk full", ok: false },
      { message: "disk full", ok: false },
    ]);

    controller.apply({ text: "one", type: "compose" });

    await expect(controller.flush()).resolves.toStrictEqual({
      message: "disk full",
      ok: false,
    });
    // No edit since, and no timer waiting: the flush still tries again.
    await expect(controller.flush()).resolves.toStrictEqual({
      message: "disk full",
      ok: false,
    });
    await expect(controller.flush()).resolves.toStrictEqual({ ok: true });
    expect(saved).toHaveLength(3);
    expect(controller.view().status.saveError).toBeNull();
  });

  it("writes nothing when the disk already holds every change", async () => {
    const { controller, saved } = setup();

    controller.apply({ text: "one", type: "compose" });

    await expect(controller.flush()).resolves.toStrictEqual({ ok: true });
    await expect(controller.flush()).resolves.toStrictEqual({ ok: true });
    expect(saved).toHaveLength(1);
  });

  it("writes a typed edit still waiting for its pause before saying it is saved", async () => {
    const { controller, saved, timers } = setup();
    const id = controller.apply({ text: "one", type: "compose" });

    if (id === null) {
      throw new Error("no id");
    }

    await controller.flush();
    controller.apply({ id, text: "one more", type: "editText" });
    expect(timers).toHaveLength(1);

    await expect(controller.flush()).resolves.toStrictEqual({ ok: true });
    expect(timers).toHaveLength(0);
    expect(saved.at(-1)?.items[0]).toMatchObject({ text: "one more" });
  });

  it("stays saved when an edit lands while the flush waits for the disk", async () => {
    const disk = new EventTarget();

    const written = (async () => {
      await once(disk, "written");
    })();

    const { controller, saved, timers } = setup([], written);
    const id = controller.apply({ text: "one", type: "compose" });

    if (id === null) {
      throw new Error("no id");
    }

    const flushed = controller.flush();

    await vi.waitFor(() => {
      expect(saved).toHaveLength(1);
    });
    controller.apply({ id, text: "one more", type: "editText" });
    disk.dispatchEvent(new Event("written"));

    await expect(flushed).resolves.toStrictEqual({ ok: true });
    expect(saved).toHaveLength(1);
    expect(saved[0]?.items[0]).toMatchObject({ text: "one" });
    expect(timers).toHaveLength(1);
  });

  it("waits for a write already holding a revision instead of writing the edit made after it", async () => {
    const disk = new EventTarget();

    const written = (async () => {
      await once(disk, "written");
    })();

    const { controller, saved } = setup([], written);
    const id = controller.apply({ text: "one", type: "compose" });

    if (id === null) {
      throw new Error("no id");
    }

    await vi.waitFor(() => {
      expect(saved).toHaveLength(1);
    });

    const persisting = controller.persisted(controller.snapshot().rev);

    controller.apply({ id, text: "one more", type: "editText" });
    disk.dispatchEvent(new Event("written"));

    await expect(persisting).resolves.toStrictEqual({ ok: true });
    expect(
      saved.map((doc) => doc.items[0]?.kind === "text" && doc.items[0].text)
    ).toStrictEqual(["one"]);
    expect(controller.item(id)).toMatchObject({ text: "one more" });
  });

  it("keeps every edit a failed save left unwritten and writes them all once the disk takes them", async () => {
    const { controller, saved } = setup([
      { ok: true },
      { message: "disk full", ok: false },
    ]);

    const id = controller.apply({ text: "one", type: "compose" });

    if (id === null) {
      throw new Error("no id");
    }

    await controller.flush();
    controller.apply({ id, text: "one, edited", type: "editText" });
    controller.apply({
      description: "Before Friday",
      id,
      type: "setDescription",
    });

    await expect(controller.flush()).resolves.toStrictEqual({
      message: "disk full",
      ok: false,
    });
    expect(controller.view().doc.items[0]).toMatchObject({
      description: "Before Friday",
      text: "one, edited",
    });

    await expect(controller.flush()).resolves.toStrictEqual({ ok: true });
    expect(saved.at(-1)?.items[0]).toMatchObject({
      description: "Before Friday",
      text: "one, edited",
    });
  });

  it("counts the items the disk doesn't hold yet", async () => {
    const { controller } = setup([
      { ok: true },
      { message: "disk full", ok: false },
    ]);

    const add = (text: string) => {
      const id = controller.apply({ text, type: "compose" });

      if (id === null) {
        throw new Error("no id");
      }

      return id;
    };

    const one = add("one");
    const two = add("two");
    const three = add("three");

    await controller.flush();
    const clean = controller.unsaved();

    controller.apply({ id: one, text: "one, edited", type: "editText" });
    controller.apply({ id: two, text: "two, edited", type: "editText" });
    const typed = controller.unsaved();

    controller.apply({ id: three, type: "remove" });
    await controller.flush();
    const failed = controller.unsaved();

    await controller.flush();

    expect([clean, typed, failed, controller.unsaved()]).toStrictEqual([
      0, 2, 3, 0,
    ]);
  });

  it("marks the focused item with a new sequence each time", () => {
    const { controller } = setup();
    const id = controller.apply({ text: "x", type: "compose" });

    if (id === null) {
      throw new Error("no id");
    }

    controller.focus(id);
    controller.focus(id);
    expect(controller.view().focus).toStrictEqual({ id, seq: 2 });
  });

  it("puts a window removed in details back where it was, once", () => {
    const { controller } = setup();

    const [a, b, c] = [linked(60), linked(61), linked(62)];

    const id = controller.apply({
      context: null,
      html: null,
      text: "Quote",
      type: "addText",
      via: "typed",
      windows: [a, b, c],
    });

    if (id === null) {
      throw new Error("not added");
    }

    const order = () =>
      controller.item(id)?.windows.map((window) => window.title);

    controller.apply({ id, type: "removeWindow", windowId: b.id });
    controller.apply({ id, type: "restoreWindow", windowId: b.id });
    controller.apply({ id, type: "restoreWindow", windowId: b.id });

    expect(order()).toStrictEqual(["Window 60", "Window 61", "Window 62"]);
  });
});

const textOf = (doc: ShelfDoc | undefined, id: string) => {
  const item = doc?.items.find((candidate) => candidate.id === id);

  return item?.kind === "text" ? item.text : undefined;
};

const DISK_FULL: WriteResult = { message: "The disk is full.", ok: false };

/**
 * The real controller on a disk that fills up on request and can hold the
 * next write back. Like the store, a write asks whether it is still current
 * just before it replaces the file, and `restore` renames the file from
 * before the last write back.
 */
const onDisk = (readOnly = false) => {
  const disk = { full: readOnly, renamesBack: true };
  // What the shelf file held after each write that replaced it; the last is the file now.
  const writes: ShelfDoc[] = [];
  const deleted: string[] = [];

  let restores = 0;
  // Set by hold(): the next write tells it has started, then waits for the test's outcome.

  let held: {
    readonly signal: EventTarget;
    readonly replaced: boolean;
  } | null = null;

  let outcome: WriteResult = { ok: true };
  let next = 10;

  const controller = createShelfController({
    deleteAttachment: async (file) => {
      deleted.push(file);
      await Promise.resolve();
    },
    env: {
      newItemId: () => ItemIdSchema.parse(uuid((next += 1))),
      newSectionId: () => SectionIdSchema.parse(uuid((next += 1))),
      now: () => new Date("2026-11-06T10:00:00.000Z"),
    },
    initial: emptyShelf(SECTION),
    restore: async () => {
      await Promise.resolve();
      restores += 1;

      if (!disk.renamesBack) {
        return false;
      }

      writes.pop();

      return true;
    },
    save: async (doc, current) => {
      const hold = held;
      let result: WriteResult = disk.full ? DISK_FULL : { ok: true };

      held = null;

      // A held write that already replaced the file: only a rename puts the old one back.
      if (hold?.replaced === true) {
        writes.push(doc);
      }

      if (hold !== null) {
        const finished = once(hold.signal, "finish");

        hold.signal.dispatchEvent(new Event("start"));
        await finished;
        result = outcome;
      }

      if (hold?.replaced === true) {
        if (!result.ok) {
          writes.pop();
        }

        return result;
      }

      if (result.ok && !current()) {
        return { dropped: true, ok: false };
      }

      if (result.ok) {
        writes.push(doc);
      }

      return result;
    },
    setTimer: () => () => {},
    status: {
      floatOnTop: true,
      keys: "granted",
      problem: null,
      quitPrompt: null,
      readOnly,
      saveError: null,
      selectionCapture: true,
    },
  });

  const add = (text: string) => {
    const id = controller.apply({ text, type: "compose" });

    if (id === null) {
      throw new Error("not added");
    }

    return id;
  };

  return {
    add,
    controller,
    deleted,
    disk,
    /**
     * The next write waits until `finish`; `started` resolves once it is on
     * its way. `replaced`: it has already taken the file's place by then.
     */
    hold: (options: { readonly replaced?: boolean } = {}) => {
      const signal = new EventTarget();

      held = { replaced: options.replaced === true, signal };

      return {
        finish: (result: WriteResult): void => {
          outcome = result;
          signal.dispatchEvent(new Event("finish"));
        },
        started: once(signal, "start"),
      };
    },
    restores: () => restores,
    shown: (id: string) => textOf(controller.view().doc, id),
    stored: (id: string) => textOf(writes.at(-1), id),
    writes,
  };
};

describe("Discard changes and each item's saved version", () => {
  it("puts back only the discarded item and keeps every other unsaved change and new capture", async () => {
    const { add, controller, disk, shown } = onDisk();
    const a = add("A as saved");
    const b = add("B as saved");

    await controller.flush();
    disk.full = true;
    controller.apply({ id: a, text: "A, typed", type: "editText" });
    controller.apply({ id: b, text: "B, typed", type: "editText" });
    const capture = add("A new capture");

    await controller.flush();

    expect(controller.view().notSaved).toStrictEqual([
      { undo: "discard", id: a },
      { undo: "discard", id: b },
      { undo: "delete", id: capture },
    ]);

    expect(controller.discard(a)).toBeTruthy();

    expect({
      a: shown(a),
      b: shown(b),
      capture: shown(capture),
      discarded: controller.view().discarded,
      notSaved: controller.view().notSaved,
      unsaved: controller.unsaved(),
    }).toStrictEqual({
      a: "A as saved",
      b: "B, typed",
      capture: "A new capture",
      discarded: { id: a, seq: 1 },
      notSaved: [
        { undo: "discard", id: b },
        { undo: "delete", id: capture },
      ],
      unsaved: 2,
    });
  });

  it("has no Discard for a capture the disk has never held", async () => {
    const { add, controller, disk, shown } = onDisk();

    disk.full = true;
    const capture = add("Never saved");

    await controller.flush();

    expect(controller.discard(capture)).toBeFalsy();
    expect(shown(capture)).toBe("Never saved");
  });

  it("is clean again, with no write and no error, once the last unsaved change is discarded or its new capture deleted", async () => {
    const { add, controller, disk, writes } = onDisk();
    const a = add("A as saved");

    await controller.flush();
    disk.full = true;
    controller.apply({ id: a, text: "A, typed", type: "editText" });
    const capture = add("Never saved");

    await controller.flush();
    const written = writes.length;

    controller.discard(a);
    controller.apply({ id: capture, type: "remove" });
    await controller.flush();

    expect({
      error: controller.view().status.saveError,
      notSaved: controller.view().notSaved,
      unsaved: controller.unsaved(),
      writes: writes.length - written,
    }).toStrictEqual({ error: null, notSaved: [], unsaved: 0, writes: 0 });
  });

  it("drops a write of the discarded words that hasn't replaced the file yet, and writes nothing to undo it", async () => {
    const { add, controller, disk, hold, restores, shown, stored, writes } =
      onDisk();

    const a = add("A as saved");

    await controller.flush();
    disk.full = true;
    controller.apply({ id: a, text: "Discard me", type: "editText" });
    await controller.flush();

    // Retry is on its way with the words when the user picks Discard changes.
    disk.full = false;
    const write = hold();
    const retry = controller.flush();

    await write.started;
    controller.discard(a);
    write.finish({ ok: true });
    await retry;
    await controller.flush();

    expect({
      restores: restores(),
      shown: shown(a),
      stored: stored(a),
      unsaved: controller.unsaved(),
      writes: writes.length,
    }).toStrictEqual({
      restores: 0,
      shown: "A as saved",
      stored: "A as saved",
      unsaved: 0,
      writes: 1,
    });
  });

  it("renames the file from before back when the write of the discarded words already replaced it, even on a full disk", async () => {
    const { add, controller, disk, hold, restores, shown, stored, writes } =
      onDisk();

    const a = add("A as saved");

    await controller.flush();
    disk.full = true;
    controller.apply({ id: a, text: "Discard me", type: "editText" });
    await controller.flush();

    disk.full = false;
    const write = hold({ replaced: true });
    const retry = controller.flush();

    await write.started;
    controller.discard(a);
    // The disk fills up again: a write could not put the saved words back now, a rename can.
    disk.full = true;
    write.finish({ ok: true });
    await retry;
    await controller.flush();

    expect({
      error: controller.view().status.saveError,
      notSaved: controller.view().notSaved,
      restores: restores(),
      shown: shown(a),
      stored: stored(a),
      unsaved: controller.unsaved(),
      writes: writes.length,
    }).toStrictEqual({
      error: null,
      notSaved: [],
      restores: 1,
      shown: "A as saved",
      stored: "A as saved",
      unsaved: 0,
      writes: 1,
    });
  });

  it("writes the other items' changes once a Discard dropped the write holding them, and Retry answers for that write", async () => {
    const { add, controller, disk, hold, stored } = onDisk();
    const a = add("A as saved");
    const b = add("B as saved");

    await controller.flush();
    disk.full = true;
    controller.apply({ id: a, text: "A, typed", type: "editText" });
    controller.apply({ id: b, text: "B, typed", type: "editText" });
    await controller.flush();

    disk.full = false;
    const write = hold();
    const retry = controller.flush();

    await write.started;
    controller.discard(a);
    write.finish({ ok: true });

    await expect(retry).resolves.toStrictEqual({ ok: true });
    expect({
      a: stored(a),
      b: stored(b),
      error: controller.view().status.saveError,
      notSaved: controller.view().notSaved,
    }).toStrictEqual({
      a: "A as saved",
      b: "B, typed",
      error: null,
      notSaved: [],
    });
  });

  it("stays failed while it is edited again, until a write holding it succeeds", async () => {
    const { add, controller, disk } = onDisk();
    const a = add("A as saved");

    await controller.flush();
    disk.full = true;
    controller.apply({ id: a, text: "A, typed", type: "editText" });
    await controller.flush();
    controller.apply({ id: a, text: "A, typed more", type: "editText" });
    const edited = controller.copyState([a], controller.snapshot().doc);

    disk.full = false;
    await controller.flush();

    expect({
      after: controller.copyState([a], controller.snapshot().doc),
      edited,
      notSaved: controller.view().notSaved,
    }).toStrictEqual({
      after: { kind: "saved" },
      edited: { kind: "failed", message: "The disk is full." },
      notSaved: [],
    });
  });

  it("stays failed, with its error, when a Retry holding an older version lands while the newest is still to be written", async () => {
    const { add, controller, disk, hold } = onDisk();
    const a = add("A as saved");

    await controller.flush();
    disk.full = true;
    controller.apply({ id: a, text: "A, typed", type: "editText" });
    await controller.flush();
    disk.full = false;

    const older = hold();
    const retry = controller.flush();

    await older.started;
    controller.apply({ id: a, text: "A, typed more", type: "editText" });
    const newest = hold();
    const latest = controller.flush();

    older.finish({ ok: true });
    await retry;

    const between = {
      copy: controller.copyState([a], controller.snapshot().doc),
      error: controller.view().status.saveError,
      notSaved: controller.view().notSaved,
    };

    newest.finish({ ok: true });
    await latest;

    expect({
      after: controller.view().notSaved,
      afterError: controller.view().status.saveError,
      between,
    }).toStrictEqual({
      after: [],
      afterError: null,
      between: {
        copy: { kind: "failed", message: "The disk is full." },
        error: "The disk is full.",
        notSaved: [{ id: a, undo: "discard" }],
      },
    });
  });

  it("keeps an image's saved picture when the drawing made since is discarded", async () => {
    const { controller, deleted, disk } = onDisk();

    const id = controller.apply({
      context: null,
      image,
      pins: [],
      source: null,
      type: "addImage",
      via: "area",
    });

    if (id === null) {
      throw new Error("not added");
    }

    await controller.flush();
    disk.full = true;
    controller.apply({
      id,
      image: { ...image, file: `${uuid(91)}.png` },
      type: "replaceImage",
    });
    await controller.flush();
    controller.discard(id);
    disk.full = false;
    controller.apply({ text: "Anything", type: "compose" });
    await controller.flush();

    expect(deleted).toStrictEqual([`${uuid(91)}.png`]);
    expect(controller.item(id)).toMatchObject({ image });
  });

  it("keeps the saved picture Discard puts back while a Retry holding the new drawing is on its way", async () => {
    const { controller, deleted, disk, hold } = onDisk();
    const drawn = { ...image, file: `${uuid(91)}.png` };

    const id = controller.apply({
      context: null,
      image,
      pins: [],
      source: null,
      type: "addImage",
      via: "area",
    });

    if (id === null) {
      throw new Error("not added");
    }

    await controller.flush();
    disk.full = true;
    controller.apply({ id, image: drawn, type: "replaceImage" });
    await controller.flush();
    disk.full = false;

    const write = hold({ replaced: true });
    const retry = controller.flush();

    await write.started;
    controller.discard(id);
    write.finish({ ok: true });
    await retry;
    const afterDiscard = [...deleted];

    // The drawn picture goes with the next write that doesn't name it.
    controller.apply({ text: "Anything", type: "compose" });
    await controller.flush();

    expect({ afterDiscard, deleted, shown: controller.item(id) }).toMatchObject(
      { afterDiscard: [], deleted: [drawn.file], shown: { image } }
    );
  });

  it("keeps what the user kept when the file can't be renamed back, and the write replacing the discarded words fails", async () => {
    const { add, controller, disk, hold, shown } = onDisk();
    const a = add("A as saved");

    await controller.flush();
    disk.full = true;
    controller.apply({ id: a, text: "Discard me", type: "editText" });
    await controller.flush();

    // Retry's write has replaced the file when Discard changes is picked; the rename back fails, and so does the write after it.
    disk.renamesBack = false;
    const write = hold({ replaced: true });
    const retry = controller.flush();

    await write.started;
    controller.discard(a);
    write.finish({ ok: true });
    await retry;
    await controller.flush();

    const afterFailure = {
      notSaved: controller.view().notSaved,
      offered: controller.discard(a),
      shown: shown(a),
    };

    controller.apply({ id: a, text: "Typed again", type: "editText" });
    controller.discard(a);

    expect({ afterFailure, again: shown(a) }).toStrictEqual({
      afterFailure: {
        notSaved: [{ id: a, undo: null }],
        offered: false,
        shown: "A as saved",
      },
      again: "A as saved",
    });
  });

  it("offers no Retry or Discard in a session that saves nothing, and keeps its banner", async () => {
    const { add, controller } = onDisk(true);

    controller.setStatus({ saveError: "Nothing is saved this session." });
    const a = add("Typed");

    await controller.flush();
    const typed = controller.view().notSaved;

    controller.apply({ id: a, type: "remove" });
    await controller.flush();

    expect({
      saveError: controller.view().status.saveError,
      typed,
    }).toStrictEqual({
      saveError: "The disk is full.",
      typed: [],
    });
  });

  it("gives a captured selection its formatting back when Escape puts its words back after they were sent", () => {
    const { controller } = onDisk();

    const id = controller.apply({
      context: null,
      html: "<p>Quote <b>CHF 280</b> over</p>",
      text: "Quote **CHF 280** over",
      type: "addText",
      via: "selection",
    });

    if (id === null) {
      throw new Error("not added");
    }

    controller.apply({
      id,
      text: "Quote **CHF 280** over, ask Marco",
      type: "editText",
    });
    const typed = controller.item(id);

    controller.apply({ id, text: "Quote **CHF 280** over", type: "editText" });
    const back = controller.item(id);

    expect({
      back: back?.kind === "text" ? back.html : undefined,
      typed: typed?.kind === "text" ? typed.html : undefined,
    }).toStrictEqual({
      back: "<p>Quote <b>CHF 280</b> over</p>",
      typed: null,
    });
  });
});

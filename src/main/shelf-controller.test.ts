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

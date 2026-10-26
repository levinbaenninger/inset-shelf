import {
  emptyShelf,
  ItemIdSchema,
  SectionIdSchema,
  UNDO_MAX,
} from "@shared/shelf";
import type { ShelfDoc } from "@shared/shelf";
import { describe, expect, it } from "vitest";

import { createShelfController, EDIT_SAVE_DELAY_MS } from "./shelf-controller";
import type { WriteResult } from "./shelf-store";

const uuid = (n: number) =>
  `3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1b${String(n).padStart(2, "0")}`;

const SECTION = SectionIdSchema.parse(uuid(1));

const setup = (results: WriteResult[] = []) => {
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
      await Promise.resolve();

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

describe(createShelfController, () => {
  it("saves additions at once and note edits after a pause", async () => {
    const { controller, saved, timers } = setup();

    const id = controller.apply({
      image,
      pin: null,
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

  it("deletes an image file only once it falls off the undo list", async () => {
    const { controller, deleted } = setup();

    const first = controller.apply({
      image,
      pin: null,
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
});

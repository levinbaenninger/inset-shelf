import { emptyShelf, ItemIdSchema, SectionIdSchema } from "@shared/shelf";
import { describe, expect, it } from "vitest";

import { createShelfController } from "./shelf-controller";
import type { WriteResult } from "./shelf-store";
import { createWhySave } from "./why-save";

const uuid = (n: number) =>
  `3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1b${String(n).padStart(2, "0")}`;

const FULL: WriteResult = { message: "The disk is full.", ok: false };

/** A shelf holding one captured item, on a disk that answers each write after it with the next of `results`. */
const setup = async (results: WriteResult[]) => {
  let next = 10;
  const disk: (string | undefined)[] = [];

  const controller = createShelfController({
    deleteAttachment: async () => {
      await Promise.resolve();
    },
    env: {
      newItemId: () => ItemIdSchema.parse(uuid((next += 1))),
      newSectionId: () => SectionIdSchema.parse(uuid((next += 1))),
      now: () => new Date("2026-11-25T10:00:00.000Z"),
    },
    initial: emptyShelf(SectionIdSchema.parse(uuid(1))),
    restore: async () => await Promise.resolve(false),
    save: async (doc) => {
      const result = results.shift() ?? { ok: true };

      if (result.ok) {
        disk.push(doc.items[0]?.description);
      }

      return await Promise.resolve(result);
    },
    setTimer: () => () => {},
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

  const written = async () =>
    await controller.persisted(controller.snapshot().rev);

  const item = controller.apply({
    context: null,
    html: null,
    text: "the selection",
    type: "addText",
    via: "selection",
  });

  if (item === null) {
    throw new Error("the capture made no item");
  }

  await written();

  const saveWhy = createWhySave({
    describe: (id, description) => {
      controller.apply({ description, id, type: "setDescription" });
    },
    item: controller.item,
    written,
  });

  return {
    controller,
    /** The item's description in the newest file the disk took. */
    onDisk: () => disk.at(-1),
    saveWhy: async (text: string) => await saveWhy(item, text),
    item,
  };
};

describe("saving a why", () => {
  it("puts the words on the item and answers once the disk holds them", async () => {
    const { onDisk, saveWhy } = await setup([{ ok: true }]);

    await expect(saveWhy("because")).resolves.toStrictEqual({ kind: "saved" });
    expect(onDisk()).toBe("because");
  });

  it("holds the line once when the first write failed and the same words are tried again", async () => {
    const { controller, item, onDisk, saveWhy } = await setup([
      { ok: true },
      FULL,
      FULL,
    ]);

    await expect(saveWhy("because")).resolves.toStrictEqual({
      kind: "failed",
      message: "The disk is full.",
    });
    await expect(saveWhy("because")).resolves.toMatchObject({ kind: "failed" });
    await expect(saveWhy("because")).resolves.toStrictEqual({ kind: "saved" });
    expect(controller.item(item)?.description).toBe("because");
    expect(onDisk()).toBe("because");
  });

  it("puts the words back when Discard changes took them off before the second try", async () => {
    const { controller, item, onDisk, saveWhy } = await setup([
      { ok: true },
      FULL,
    ]);

    await saveWhy("because");
    controller.discard(item);

    await expect(saveWhy("because")).resolves.toStrictEqual({ kind: "saved" });
    expect(onDisk()).toBe("because");
  });

  it("adds a second why on its own line", async () => {
    const { onDisk, saveWhy } = await setup([]);

    await saveWhy("because");
    await saveWhy("because");

    expect(onDisk()).toBe("because\nbecause");
  });

  it("stores nothing for an item deleted meanwhile", async () => {
    const { controller, item, saveWhy } = await setup([]);

    controller.apply({ id: item, type: "remove" });

    await expect(saveWhy("because")).resolves.toStrictEqual({ kind: "gone" });
  });
});

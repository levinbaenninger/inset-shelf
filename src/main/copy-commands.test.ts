import type { ActionResult } from "@shared/contracts";
import { emptyShelf, ItemIdSchema, SectionIdSchema } from "@shared/shelf";
import type { ItemId } from "@shared/shelf";
import { describe, expect, it } from "vitest";

import { createCopyCommands } from "./copy-commands";
import type { CopyCommands } from "./copy-commands";
import { createCopyGate } from "./copy-gate";
import type { ClipboardContents } from "./copy-gate";
import { createShelfController } from "./shelf-controller";

const uuid = (n: number) =>
  `5b2e8c1a-7d3f-4c62-8e1b-2a9f0c4d6e${String(n).padStart(2, "0")}`;

interface Items {
  readonly text: ItemId;
  readonly image: ItemId;
  readonly file: ItemId;
}

/**
 * Every copy the app offers, keyed by the command, so a new one fails to
 * compile until it is listed here.
 */
const ENTRY_POINTS: Record<
  keyof CopyCommands,
  (commands: CopyCommands, items: Items) => Promise<ActionResult>
> = {
  copy: async (commands, items) => await commands.copy(items.text),
  copyDetails: async (commands, items) =>
    await commands.copyDetails(items.text),
  copyList: async (commands, items) =>
    await commands.copyList([items.text, items.image, items.file]),
  copyScreenshot: async (commands) =>
    await commands.copyScreenshot(new Uint8Array([1, 2, 3])),
  copyWithLink: async (commands, items) =>
    await commands.copyWithLink(items.text),
};

/** The words on the clipboard, format by format. */
const formats = async (
  item: ClipboardContents | undefined
): Promise<Record<string, string>> => {
  const entries = await Promise.all(
    Object.entries(item ?? {}).map(
      async ([type, data]): Promise<[string, string]> => [
        type,
        data instanceof Blob ? await data.text() : JSON.stringify(data),
      ]
    )
  );

  return Object.fromEntries(entries);
};

const added = (id: ItemId | null): ItemId => {
  if (id === null) {
    throw new Error("not added");
  }

  return id;
};

/** A shelf with a text, an image and a file, the real controller saving to a disk that can fill up, and a clipboard that records. */
const setup = async () => {
  const disk = { full: false };
  const events: string[] = [];
  const written: ClipboardContents[][] = [];
  const copied: string[] = [];
  const timers: (() => void)[] = [];
  let next = 10;

  const controller = createShelfController({
    deleteAttachment: async () => {
      await Promise.resolve();
    },
    env: {
      newItemId: () => ItemIdSchema.parse(uuid((next += 1))),
      newSectionId: () => SectionIdSchema.parse(uuid((next += 1))),
      now: () => new Date("2026-11-05T10:00:00.000Z"),
    },
    initial: emptyShelf(SectionIdSchema.parse(uuid(1))),
    save: async () => {
      events.push("save");
      await Promise.resolve();

      return disk.full ? { message: "disk full", ok: false } : { ok: true };
    },
    setTimer: (run) => {
      timers.push(run);

      return () => {
        timers.splice(timers.indexOf(run), 1);
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

  const gate = createCopyGate<ClipboardContents>({
    clipboard: {
      clear: () => {
        events.push("clear");
      },
      write: async (items) => {
        events.push("write");
        written.push(items);
        await Promise.resolve();
      },
    },
    flush: controller.flush,
    onWrite: () => {},
    toItem: (data) => data,
  });

  const commands = createCopyCommands({
    exportImage: () => ({ png: Buffer.from("PNG"), widthPx: 40 }),
    gate,
    item: controller.item,
    mac: true,
    onCopied: (items, kind) => {
      copied.push(`${kind}:${items.length}`);
    },
    stageFile: (item) => `/tmp/staged/${item.file.name}`,
  });

  const text = added(
    controller.apply({ text: "Call Rieder", type: "compose" })
  );

  const image = added(
    controller.apply({
      context: null,
      image: {
        file: `${uuid(90)}.png`,
        heightPx: 10,
        pixelsPerDip: 1,
        widthPx: 40,
      },
      pins: [],
      source: null,
      type: "addImage",
      via: "area",
    })
  );

  const file = added(
    controller.apply({
      context: null,
      file: { bytes: 3, name: "plan.pdf", stored: `${uuid(91)}.pdf` },
      type: "addFile",
    })
  );

  controller.apply({
    description: "Before Friday",
    id: text,
    type: "setDescription",
  });
  await controller.flush();
  events.length = 0;

  return {
    commands,
    controller,
    copied,
    disk,
    events,
    items: { file, image, text },
    timers,
    written,
  };
};

describe(createCopyCommands, () => {
  it("copies nothing from any entry point while the shelf can't be saved", async () => {
    const { commands, controller, copied, disk, items, written } =
      await setup();

    disk.full = true;
    controller.apply({
      id: items.text,
      text: "Call Rieder at 9",
      type: "editText",
    });

    for (const [name, run] of Object.entries(ENTRY_POINTS)) {
      // oxlint-disable-next-line no-await-in-loop -- each entry point on its own.
      const result = await run(commands, items);

      expect({ name, result }).toStrictEqual({
        name,
        result: { message: "Not copied. disk full", ok: false },
      });
    }

    expect(written).toStrictEqual([]);
    expect(copied).toStrictEqual([]);
    expect(controller.view().status.saveError).toBe("disk full");
  });

  it("copies from every entry point once the disk holds the change", async () => {
    const { commands, controller, disk, items, written } = await setup();

    disk.full = true;
    controller.apply({
      id: items.text,
      text: "Call Rieder at 9",
      type: "editText",
    });
    await expect(commands.copy(items.text)).resolves.toMatchObject({
      ok: false,
    });

    disk.full = false;

    for (const [name, run] of Object.entries(ENTRY_POINTS)) {
      // oxlint-disable-next-line no-await-in-loop -- each entry point on its own.
      const result = await run(commands, items);

      expect({ name, result }).toStrictEqual({ name, result: { ok: true } });
    }

    expect(written).toHaveLength(Object.keys(ENTRY_POINTS).length);
    expect(controller.view().status.saveError).toBeNull();
  });

  it("writes a note still being typed to the disk before it copies it", async () => {
    const { commands, controller, events, items, timers, written } =
      await setup();

    controller.apply({
      id: items.text,
      text: "Call Rieder at 9",
      type: "editText",
    });
    expect(timers).toHaveLength(1);

    await expect(commands.copy(items.text)).resolves.toStrictEqual({
      ok: true,
    });
    expect(events).toStrictEqual(["save", "write"]);
    await expect(formats(written[0]?.[0])).resolves.toStrictEqual({
      "text/plain": "Call Rieder at 9",
    });
  });

  it("puts each format on the clipboard as before", async () => {
    const { commands, copied, items, written } = await setup();

    await commands.copy(items.file);
    await commands.copyDetails(items.text);
    await commands.copyList([items.text, items.image]);

    await expect(formats(written[0]?.[0])).resolves.toStrictEqual({
      'electron application/osclipboard;format="public.file-url"':
        "file:///tmp/staged/plan.pdf",
      "text/plain": "plan.pdf",
    });
    await expect(formats(written[1]?.[0])).resolves.toStrictEqual({
      "text/plain": "Call Rieder\n\nBefore Friday",
    });
    await expect(formats(written[2]?.[0])).resolves.toStrictEqual({
      "text/html": `<ol><li>Call Rieder<br>Before Friday</li></ol><p><img src="data:image/png;base64,${Buffer.from("PNG").toString("base64")}" width="40" alt="Image"></p>`,
      "text/plain": "1. Call Rieder\n   Before Friday",
    });
    expect(copied).toStrictEqual(["item:1", "list:2"]);
  });

  it("says when the item has gone and copies nothing", async () => {
    const { commands, controller, items, written } = await setup();

    controller.apply({ id: items.text, type: "remove" });

    await expect(commands.copy(items.text)).resolves.toStrictEqual({
      message: "This item no longer exists.",
      ok: false,
    });
    expect(written).toStrictEqual([]);
  });
});

describe(createCopyGate, () => {
  it("puts back the clipboard a selection copy replaced, or empties it, without waiting for a save", async () => {
    const written: ClipboardContents[][] = [];
    let cleared = 0;
    let flushed = 0;

    const gate = createCopyGate<ClipboardContents>({
      clipboard: {
        clear: () => {
          cleared += 1;
        },
        write: async (items) => {
          written.push(items);
          await Promise.resolve();
        },
      },
      flush: async () => {
        flushed += 1;
        await Promise.resolve();

        return { message: "disk full", ok: false };
      },
      onWrite: () => {},
      toItem: (data) => data,
    });

    const saved = { "text/plain": new Blob(["before"]) };

    await gate.restore([saved]);
    await gate.restore([]);

    expect(written).toStrictEqual([[saved]]);
    expect(cleared).toBe(1);
    expect(flushed).toBe(0);
  });
});

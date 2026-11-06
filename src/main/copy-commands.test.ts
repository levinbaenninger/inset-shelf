import { once } from "node:events";

import type { ActionResult } from "@shared/contracts";
import { emptyShelf, ItemIdSchema, SectionIdSchema } from "@shared/shelf";
import type { ImageItem, ItemId, ShelfDoc } from "@shared/shelf";
import { describe, expect, it } from "vitest";

import { createCopyCommands } from "./copy-commands";
import type { CopyCommands } from "./copy-commands";
import { createCopyGate } from "./copy-gate";
import type { ClipboardContents } from "./copy-gate";
import { createShelfController } from "./shelf-controller";
import { openShelfStore } from "./shelf-store";
import type { SaveResult, StoreFs, WriteResult } from "./shelf-store";

const uuid = (n: number) =>
  `5b2e8c1a-7d3f-4c62-8e1b-2a9f0c4d6e${String(n).padStart(2, "0")}`;

interface Items {
  readonly text: ItemId;
  readonly image: ItemId;
  readonly file: ItemId;
  /** The image as a new drawing hands it over, just added. */
  readonly drawing: ImageItem;
}

interface EntryPoint {
  /** Whether it copies shelf items, and so waits for the disk; the screenshot card and a new drawing carry their own picture. */
  readonly waitsForSave: boolean;
  readonly run: (commands: CopyCommands, items: Items) => Promise<ActionResult>;
}

/**
 * Every copy the app offers, keyed by the command, so a new one fails to
 * compile until it is listed here and says whether it waits for the disk.
 */
const ENTRY_POINTS: Record<keyof CopyCommands, EntryPoint> = {
  copy: {
    run: async (commands, items) => await commands.copy(items.text),
    waitsForSave: true,
  },
  copyDetails: {
    run: async (commands, items) => await commands.copyDetails(items.text),
    waitsForSave: true,
  },
  copyDrawing: {
    run: async (commands, items) => await commands.copyDrawing(items.drawing),
    waitsForSave: false,
  },
  copyList: {
    run: async (commands, items) =>
      await commands.copyList([items.text, items.image, items.file]),
    waitsForSave: true,
  },
  copyScreenshot: {
    run: async (commands) =>
      await commands.copyScreenshot(new Uint8Array([80, 78, 71])),
    waitsForSave: false,
  },
  copyWithLink: {
    run: async (commands, items) => await commands.copyWithLink(items.text),
    waitsForSave: true,
  },
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

/** How a copy of items is refused while what it would copy isn't on the disk. */
const NOT_SAVED = {
  message: "Couldn’t save your changes, so nothing was copied. disk full",
  ok: false,
  retrySave: true,
};

const added = (id: ItemId | null): ItemId => {
  if (id === null) {
    throw new Error("not added");
  }

  return id;
};

/** A save the test lets reach the disk when it chooses, with the outcome it chooses. */
interface HeldSave {
  readonly started: Promise<void>;
  readonly release: (result: WriteResult) => void;
}

interface Hold {
  readonly start: () => void;
  readonly outcome: Promise<WriteResult>;
}

/**
 * A shelf with a text, an image and a file, the real controller saving to a
 * disk that can fill up or hold a save back, and a clipboard that records.
 * `save` and `readOnly` stand in for a real store.
 */
const setup = async (
  store: {
    readonly save?: (doc: ShelfDoc) => Promise<SaveResult>;
    readonly readOnly?: boolean;
  } = {}
) => {
  const disk = { full: false };
  const events: string[] = [];
  const written: ClipboardContents[][] = [];
  const copied: string[] = [];
  const timers: (() => void)[] = [];
  const onDisk: ShelfDoc[] = [];
  const holds: Hold[] = [];
  let next = 10;

  const save = async (doc: ShelfDoc): Promise<WriteResult> => {
    events.push("save");

    const hold = holds.shift();

    if (hold !== undefined) {
      hold.start();
    }

    const result =
      hold === undefined
        ? await Promise.resolve<WriteResult>(
            disk.full ? { message: "disk full", ok: false } : { ok: true }
          )
        : await hold.outcome;

    if (result.ok) {
      onDisk.push(doc);
    }

    return result;
  };

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
    restore: async () => await Promise.resolve(false),
    save: store.save ?? save,
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
      quitPrompt: null,
      readOnly: store.readOnly ?? false,
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
    copyState: controller.copyState,
    discards: controller.discards,
    onWrite: () => {},
    persisted: controller.persisted,
    readOnly: store.readOnly ?? false,
    snapshot: controller.snapshot,
    toItem: (data) => data,
  });

  const commands = createCopyCommands({
    exportImage: () => ({ png: Buffer.from("PNG"), widthPx: 40 }),
    gate,
    mac: true,
    onCopied: (ids, kind) => {
      copied.push(`${kind}:${ids.length}`);
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

  const drawing = controller.item(image);

  if (drawing?.kind !== "image") {
    throw new Error("no image");
  }

  /** The next save waits until the test releases it. */
  const holdNextSave = (): HeldSave => {
    const signal = new EventTarget();
    let result: WriteResult = { ok: true };

    const started = (async () => {
      await once(signal, "started");
    })();

    const outcome = (async () => {
      await once(signal, "released");

      return result;
    })();

    holds.push({
      outcome,
      start: () => {
        signal.dispatchEvent(new Event("started"));
      },
    });

    return {
      release: (chosen) => {
        result = chosen;
        signal.dispatchEvent(new Event("released"));
      },
      started,
    };
  };

  /** The words of an item in the last shelf the disk took. */
  const savedText = (id: ItemId): string | undefined => {
    const item = onDisk.at(-1)?.items.find((candidate) => candidate.id === id);

    if (item === undefined) {
      return undefined;
    }

    return item.kind === "text" ? item.text : item.note;
  };

  return {
    commands,
    controller,
    copied,
    disk,
    events,
    holdNextSave,
    items: { drawing, file, image, text },
    savedText,
    timers,
    written,
  };
};

describe(createCopyCommands, () => {
  it("copies no shelf item while the shelf can't be saved, but still copies a screenshot or a new drawing", async () => {
    const { commands, controller, copied, disk, events, items, written } =
      await setup();

    disk.full = true;
    controller.apply({
      id: items.text,
      text: "Call Rieder at 9",
      type: "editText",
    });

    const results = [];

    for (const [name, entry] of Object.entries(ENTRY_POINTS)) {
      // oxlint-disable-next-line no-await-in-loop -- each entry point on its own.
      results.push({ name, result: await entry.run(commands, items) });
    }

    expect(results).toStrictEqual([
      { name: "copy", result: NOT_SAVED },
      { name: "copyDetails", result: NOT_SAVED },
      { name: "copyDrawing", result: { ok: true } },
      { name: "copyList", result: NOT_SAVED },
      { name: "copyScreenshot", result: { ok: true } },
      { name: "copyWithLink", result: NOT_SAVED },
    ]);
    // The first copy wrote the edit still waiting for its pause; once that failed, no copy writes again.
    expect(events.filter((event) => event === "save")).toStrictEqual(["save"]);
    await expect(
      Promise.all(written.map(async (contents) => await formats(contents[0])))
    ).resolves.toStrictEqual([{ "image/png": "PNG" }, { "image/png": "PNG" }]);
    // Only the drawing is an item; the setting may check it off.
    expect(copied).toStrictEqual(["item:1"]);
    expect(controller.view().status.saveError).toBe("disk full");
  });

  it("refuses a failed edit at once even when the disk has room again, and copies from every entry point once Retry has saved it", async () => {
    const { commands, controller, disk, events, items, savedText, written } =
      await setup();

    disk.full = true;
    controller.apply({
      id: items.text,
      text: "Call Rieder at 9",
      type: "editText",
    });
    await expect(controller.flush()).resolves.toMatchObject({ ok: false });

    disk.full = false;
    events.length = 0;

    await expect(commands.copy(items.text)).resolves.toStrictEqual(NOT_SAVED);
    expect({ events, onDisk: savedText(items.text), written }).toStrictEqual({
      events: [],
      onDisk: "Call Rieder",
      written: [],
    });

    // Retry, in the refusal's toast or the banner.
    await expect(controller.flush()).resolves.toStrictEqual({ ok: true });

    for (const [name, entry] of Object.entries(ENTRY_POINTS)) {
      // oxlint-disable-next-line no-await-in-loop -- each entry point on its own.
      const result = await entry.run(commands, items);

      expect({ name, result }).toStrictEqual({ name, result: { ok: true } });
    }

    expect({
      copies: written.length,
      saveError: controller.view().status.saveError,
      saves: events.filter((event) => event === "save"),
    }).toStrictEqual({
      copies: Object.keys(ENTRY_POINTS).length,
      saveError: null,
      saves: ["save"],
    });
  });

  it("copies an item the disk holds at once, with no write, while another item's save has failed", async () => {
    const { commands, controller, disk, events, items, written } =
      await setup();

    disk.full = true;
    controller.apply({ id: items.image, note: "Floor plan", type: "editNote" });
    await controller.flush();
    events.length = 0;

    await expect(commands.copyWithLink(items.text)).resolves.toStrictEqual({
      ok: true,
    });
    await expect(
      commands.copyList([items.text, items.image])
    ).resolves.toStrictEqual(NOT_SAVED);
    expect(events).toStrictEqual(["write"]);
    await expect(formats(written[0]?.[0])).resolves.toStrictEqual({
      "text/plain": "Call Rieder\n\nBefore Friday",
    });
  });

  it("copies an item as the disk holds it once its changes are discarded", async () => {
    const { commands, controller, disk, events, items, written } =
      await setup();

    disk.full = true;
    controller.apply({ id: items.text, text: "Lost words", type: "editText" });
    await controller.flush();
    events.length = 0;

    expect(controller.discard(items.text)).toBeTruthy();
    await expect(commands.copy(items.text)).resolves.toStrictEqual({
      ok: true,
    });
    expect(events).toStrictEqual(["write"]);
    await expect(formats(written[0]?.[0])).resolves.toStrictEqual({
      "text/plain": "Call Rieder",
    });
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

  it("copies the edit it waited for, not a second one typed during the wait", async () => {
    const { commands, controller, holdNextSave, items, savedText, written } =
      await setup();

    const held = holdNextSave();

    controller.apply({ id: items.text, text: "FIRST EDIT", type: "editText" });

    const copying = commands.copyDetails(items.text);

    await held.started;
    controller.apply({
      id: items.text,
      text: "SECOND UNSAVED EDIT",
      type: "editText",
    });
    held.release({ ok: true });

    await expect(copying).resolves.toStrictEqual({ ok: true });
    expect(savedText(items.text)).toBe("FIRST EDIT");
    await expect(formats(written[0]?.[0])).resolves.toStrictEqual({
      "text/plain": "FIRST EDIT\n\nBefore Friday",
    });
    expect(controller.item(items.text)).toMatchObject({
      text: "SECOND UNSAVED EDIT",
    });
  });

  it("copies nothing when its changes are discarded while it waits for their save", async () => {
    const { commands, controller, holdNextSave, items, written } =
      await setup();

    const held = holdNextSave();

    controller.apply({ id: items.text, text: "DISCARDED", type: "editText" });

    const copying = commands.copy(items.text);

    await held.started;
    controller.discard(items.text);
    held.release({ ok: true });

    await expect(copying).resolves.toStrictEqual({
      message: "Its changes were discarded, so nothing was copied.",
      ok: false,
    });
    expect(written).toStrictEqual([]);
  });

  it("waits for a save already on its way instead of writing the edit typed after it", async () => {
    const {
      commands,
      controller,
      events,
      holdNextSave,
      items,
      savedText,
      timers,
      written,
    } = await setup();

    const held = holdNextSave();

    controller.apply({ id: items.text, text: "FIRST EDIT", type: "editText" });
    timers.shift()?.();
    await held.started;

    const copying = commands.copy(items.text);

    controller.apply({
      id: items.text,
      text: "SECOND UNSAVED EDIT",
      type: "editText",
    });
    held.release({ ok: true });

    await expect(copying).resolves.toStrictEqual({ ok: true });
    expect(events).toStrictEqual(["save", "write"]);
    expect(savedText(items.text)).toBe("FIRST EDIT");
    await expect(formats(written[0]?.[0])).resolves.toStrictEqual({
      "text/plain": "FIRST EDIT",
    });
    // The second edit still waits for its own pause.
    expect(timers).toHaveLength(1);
  });

  it("copies nothing when the save it waited for fails", async () => {
    const { commands, controller, holdNextSave, items, written } =
      await setup();

    const held = holdNextSave();

    controller.apply({ id: items.text, text: "FIRST EDIT", type: "editText" });

    const copying = commands.copyWithLink(items.text);

    await held.started;
    controller.apply({
      id: items.text,
      text: "SECOND UNSAVED EDIT",
      type: "editText",
    });
    held.release({ message: "disk full", ok: false });

    await expect(copying).resolves.toStrictEqual(NOT_SAVED);
    expect(written).toStrictEqual([]);
  });

  it("copies one item as it was while another's edit is still being saved", async () => {
    const {
      commands,
      controller,
      holdNextSave,
      items,
      savedText,
      timers,
      written,
    } = await setup();

    const held = holdNextSave();

    controller.apply({
      id: items.text,
      text: "Call Rieder at 9",
      type: "editText",
    });
    timers.shift()?.();
    await held.started;
    controller.apply({ id: items.image, note: "Floor plan", type: "editNote" });

    const copying = commands.copy(items.text);

    held.release({ ok: true });

    await expect(copying).resolves.toStrictEqual({ ok: true });
    await expect(formats(written[0]?.[0])).resolves.toStrictEqual({
      "text/plain": "Call Rieder at 9",
    });
    // The copy waited for the image's note too, which was in the shelf it took.
    expect([savedText(items.text), savedText(items.image)]).toStrictEqual([
      "Call Rieder at 9",
      "Floor plan",
    ]);
  });

  it("keeps an edit whose save failed and refuses to copy it from a row's menu later, with no new write, until Retry saves it", async () => {
    const { commands, controller, disk, events, items, savedText, written } =
      await setup();

    disk.full = true;
    controller.apply({
      id: items.text,
      text: "UNSAVED AFTER FAILURE",
      type: "editText",
    });
    await expect(controller.flush()).resolves.toStrictEqual({
      message: "disk full",
      ok: false,
    });

    // Later, from the item's menu, with another item open, after the disk has room again.
    controller.apply({ id: items.image, note: "Floor plan", type: "editNote" });
    disk.full = false;
    events.length = 0;

    const refused = await commands.copyDetails(items.text);

    const draft = controller.item(items.text);

    expect({
      draft: draft?.kind === "text" ? draft.text : null,
      events,
      notSaved: controller.view().notSaved,
      refused,
      written,
    }).toStrictEqual({
      draft: "UNSAVED AFTER FAILURE",
      events: [],
      notSaved: [{ undo: "discard", id: items.text }],
      refused: NOT_SAVED,
      written: [],
    });

    await expect(controller.flush()).resolves.toStrictEqual({ ok: true });

    const copied = await commands.copyDetails(items.text);

    expect({ copied, onDisk: savedText(items.text) }).toStrictEqual({
      copied: { ok: true },
      onDisk: "UNSAVED AFTER FAILURE",
    });
    await expect(formats(written[0]?.[0])).resolves.toStrictEqual({
      "text/plain": "UNSAVED AFTER FAILURE\n\nBefore Friday",
    });
  });

  it("copies items in a session that saves nothing, since the shelf file could not be opened", async () => {
    const denied: StoreFs = {
      copyAtomic: async () => {
        await Promise.resolve();
      },
      list: async () => await Promise.resolve([]),
      mkdir: async () => {
        await Promise.resolve();
      },
      readFile: async () => {
        await Promise.resolve();

        throw Object.assign(new Error("permission denied"), {
          code: "EACCES",
        });
      },
      remove: async () => {
        await Promise.resolve();
      },
      rename: async () => {
        await Promise.resolve();
      },
      renameSync: () => {},
      writeAtomic: async () => {
        await Promise.resolve();

        throw new Error("The shelf file must stay as it was.");
      },
      writeTemp: async () => {
        await Promise.resolve();

        throw new Error("The shelf file must stay as it was.");
      },
    };

    const store = await openShelfStore("/shelf", {
      fs: denied,
      newSectionId: () => SectionIdSchema.parse(uuid(1)),
      now: () => new Date("2026-11-05T10:00:00.000Z"),
    });

    const { commands, controller, items, written } = await setup(store);

    controller.apply({
      id: items.text,
      text: "Call Rieder at 9",
      type: "editText",
    });

    await expect(
      Promise.all([commands.copy(items.text), commands.copyDetails(items.text)])
    ).resolves.toStrictEqual([{ ok: true }, { ok: true }]);
    await expect(
      Promise.all(written.map(async (contents) => await formats(contents[0])))
    ).resolves.toStrictEqual([
      { "text/plain": "Call Rieder at 9" },
      { "text/plain": "Call Rieder at 9\n\nBefore Friday" },
    ]);
    await controller.flush();
    // The banner says it for the whole session: no row offers a Retry that can't work.
    expect({
      notSaved: controller.view().notSaved,
      saveError: controller.view().status.saveError,
    }).toStrictEqual({
      notSaved: [],
      saveError:
        "Nothing is saved this session, so the shelf file that could not be opened stays as it was.",
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

  it.each(["description-only", "labelled-pin-only"])(
    "copies an untitled, uncaptioned %s image with its details in image-only and mixed lists",
    async (metadata) => {
      const { commands, controller, items, written } = await setup();

      controller.apply(
        metadata === "description-only"
          ? {
              description: "Check header",
              id: items.image,
              type: "setDescription",
            }
          : {
              id: items.image,
              pins: [{ label: "Check header", x: 1, y: 1 }],
              type: "setPins",
            }
      );

      await expect(commands.copyList([items.image])).resolves.toStrictEqual({
        ok: true,
      });
      await expect(
        commands.copyList([items.image, items.text])
      ).resolves.toStrictEqual({ ok: true });

      const details =
        metadata === "description-only" ? "Check header" : "1 · Check header";

      const picture = `<p><img src="data:image/png;base64,${Buffer.from("PNG").toString("base64")}" width="40" alt="Image"></p>`;

      await expect(formats(written[0]?.[0])).resolves.toStrictEqual({
        "text/html": `<ol><li>Image<br>${details}</li></ol>${picture}`,
        "text/plain": `1. Image\n   ${details}`,
      });
      await expect(formats(written[1]?.[0])).resolves.toStrictEqual({
        "text/html": `<ol><li>Image<br>${details}</li><li>Call Rieder<br>Before Friday</li></ol>${picture}`,
        "text/plain": `1. Image\n   ${details}\n2. Call Rieder\n   Before Friday`,
      });
    }
  );

  it("copies only the image when a list has no text or details", async () => {
    const { commands, items, written } = await setup();

    await expect(commands.copyList([items.image])).resolves.toStrictEqual({
      ok: true,
    });
    await expect(formats(written[0]?.[0])).resolves.toStrictEqual({
      "image/png": "PNG",
    });
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
    let waited = 0;

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
      copyState: () => ({ kind: "pending" }),
      discards: () => 0,
      onWrite: () => {},
      persisted: async () => {
        waited += 1;
        await Promise.resolve();

        return { message: "disk full", ok: false };
      },
      readOnly: false,
      snapshot: () => ({
        doc: emptyShelf(SectionIdSchema.parse(uuid(1))),
        rev: 1,
      }),
      toItem: (data) => data,
    });

    const saved = { "text/plain": new Blob(["before"]) };

    await gate.restore([saved]);
    await gate.restore([]);

    expect(written).toStrictEqual([[saved]]);
    expect(cleared).toBe(1);
    expect(waited).toBe(0);
  });
});

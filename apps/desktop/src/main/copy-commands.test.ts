import { once } from "node:events";
import { pathToFileURL } from "node:url";

import type { ActionResult } from "@shared/contracts";
import {
  AttachmentIdSchema,
  emptyShelf,
  ItemIdSchema,
  itemText,
  SectionIdSchema,
} from "@shared/shelf";
import type {
  AttachedImage,
  Attachment,
  AttachmentId,
  ImageItem,
  ItemId,
  Picture,
  ShelfDoc,
} from "@shared/shelf";
import { describe, expect, it } from "vite-plus/test";

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
  /** A file item with a picture attached to it. */
  readonly file: ItemId;
  readonly picture: AttachmentId;
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
  copyOwnPicture: {
    run: async (commands, items) =>
      await commands.copyOwnPicture(items.drawing),
    waitsForSave: false,
  },
  copyPicture: {
    run: async (commands, items) =>
      await commands.copyPicture(items.file, items.picture),
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

/** An attached picture whose file is `<uuid(n + 1)>.png`. */
const attachedPicture = (n: number, widthPx = 40): AttachedImage => ({
  addedAt: "2026-11-20T10:00:00.000Z",
  id: AttachmentIdSchema.parse(uuid(n)),
  image: {
    file: `${uuid(n + 1)}.png`,
    heightPx: 10,
    pixelsPerDip: 2,
    widthPx,
  },
  kind: "image",
  name: `Screenshot ${n}`,
  pins: [],
});

const attachedFile = (n: number): Attachment => ({
  addedAt: "2026-11-20T10:00:00.000Z",
  file: { bytes: 3, name: `Quote ${n}.pdf`, stored: `${uuid(n + 1)}.pdf` },
  id: AttachmentIdSchema.parse(uuid(n)),
  kind: "file",
});

/** Pictures whose file is gone from the data folder. */
const MISSING = `${uuid(81)}.png`;

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

  const exports: { file: string; longSideMax?: number }[] = [];
  // The PNG an export returns, by picture file; "PNG" for any other.
  const pngs = new Map<string, Buffer>();

  const commands = createCopyCommands({
    exportImage: (picture: Picture, longSideMax?: number) => {
      exports.push(
        longSideMax === undefined
          ? { file: picture.image.file }
          : { file: picture.image.file, longSideMax }
      );

      return picture.image.file === MISSING
        ? null
        : {
            png: pngs.get(picture.image.file) ?? Buffer.from("PNG"),
            widthPx: 40,
          };
    },
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

  const picture = attachedPicture(70);

  controller.apply({ attachments: [picture], id: file, type: "attach" });
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
    exports,
    items: { drawing, file, image, picture: picture.id, text },
    pngs,
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
    controller.apply({ id: items.file, note: "Floor 3", type: "editNote" });

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
      { name: "copyOwnPicture", result: { ok: true } },
      { name: "copyPicture", result: NOT_SAVED },
      { name: "copyScreenshot", result: { ok: true } },
      { name: "copyWithLink", result: NOT_SAVED },
    ]);
    // The first copy wrote the edit still waiting for its pause; once that failed, no copy writes again.
    expect(events.filter((event) => event === "save")).toStrictEqual(["save"]);
    await expect(
      Promise.all(written.map(async (contents) => await formats(contents[0])))
    ).resolves.toStrictEqual([
      { "image/png": "PNG" },
      { "image/png": "PNG" },
      { "image/png": "PNG" },
    ]);
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
      "text/html": "<p>Call Rieder</p>",
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
      "text/html": "<p>Call Rieder at 9</p>",
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
      "text/html": "<p>FIRST EDIT</p><p>Before Friday</p>",
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
      "text/html": "<p>FIRST EDIT</p>",
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
      "text/html": "<p>Call Rieder at 9</p>",
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
      "text/html": "<p>UNSAVED AFTER FAILURE</p><p>Before Friday</p>",
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
      {
        "text/html": "<p>Call Rieder at 9</p>",
        "text/plain": "Call Rieder at 9",
      },
      {
        "text/html": "<p>Call Rieder at 9</p><p>Before Friday</p>",
        "text/plain": "Call Rieder at 9\n\nBefore Friday",
      },
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
      // The system's own file URL for the staged path: file:///C:/tmp/… on Windows.
      'electron application/osclipboard;format="public.file-url"':
        pathToFileURL("/tmp/staged/plan.pdf").href,
      "text/plain": "plan.pdf",
    });
    await expect(formats(written[1]?.[0])).resolves.toStrictEqual({
      "text/html": "<p>Call Rieder</p><p>Before Friday</p>",
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

  it("copies an item with ⌘C exactly as it did before pictures and files were attached to it", async () => {
    const { commands, controller, items, written } = await setup();

    await commands.copy(items.text);
    await commands.copy(items.image);
    controller.apply({
      attachments: [attachedPicture(72), attachedFile(74)],
      id: items.text,
      type: "attach",
    });
    controller.apply({
      attachments: [attachedPicture(76)],
      id: items.image,
      type: "attach",
    });
    await commands.copy(items.text);
    await commands.copy(items.image);

    const [text, image, attachedText, attachedImage] = await Promise.all(
      written.map(async (contents) => await formats(contents[0]))
    );

    expect({ attachedImage, attachedText }).toStrictEqual({
      attachedImage: image,
      attachedText: text,
    });
  });

  it("copies an item's details with its attached pictures inside the HTML, scaled down, and names a file or a missing picture", async () => {
    const { commands, controller, exports, items, written } = await setup();

    controller.apply({
      attachments: [
        attachedPicture(72, 3000),
        attachedFile(74),
        { ...attachedPicture(80), name: "Gone" },
      ],
      id: items.image,
      type: "attach",
    });
    exports.length = 0;

    await expect(commands.copyDetails(items.image)).resolves.toStrictEqual({
      ok: true,
    });

    const png = Buffer.from("PNG").toString("base64");

    const img = (width: number, alt: string) =>
      `<img src="data:image/png;base64,${png}" width="${width}" alt="${alt}">`;

    await expect(formats(written[0]?.[0])).resolves.toStrictEqual({
      "text/html": [
        "<p>Image</p>",
        `<p>${img(40, "Image")}</p>`,
        "<p>Attachments:</p>",
        `<p>Screenshot 72<br>${img(1500, "Screenshot 72")}</p>`,
        "<p>Quote 74.pdf</p>",
        "<p>Gone (picture not found)</p>",
      ].join(""),
      "text/plain": [
        "Image",
        "",
        "Attachments:",
        "- Screenshot 72",
        "- Quote 74.pdf",
        "- Gone",
      ].join("\n"),
    });
    expect(exports).toStrictEqual([
      { file: `${uuid(90)}.png`, longSideMax: 1600 },
      { file: `${uuid(73)}.png`, longSideMax: 1600 },
      { file: MISSING, longSideMax: 1600 },
    ]);
  });

  it("puts each item's attached pictures in its line of a list, and names the rest once the HTML is full", async () => {
    const { commands, controller, items, pngs, written } = await setup();

    // Three pictures of 8 MB each in base64: the third would take the HTML past 20 MB.
    for (const n of [73, 75, 77]) {
      pngs.set(`${uuid(n)}.png`, Buffer.alloc(6_000_000));
    }

    controller.apply({
      attachments: [attachedPicture(72), attachedPicture(74)],
      id: items.text,
      type: "attach",
    });
    controller.apply({
      attachments: [attachedPicture(76)],
      id: items.image,
      type: "attach",
    });

    await commands.copyList([items.text, items.image]);

    const { "text/html": listHtml = "", "text/plain": listText } =
      await formats(written[0]?.[0]);

    const pictures = listHtml
      .split("<li>")
      .map((line) => line.split("<img ").length - 1);

    expect({ listText, pictures }).toStrictEqual({
      listText: [
        "1. Call Rieder",
        "   Before Friday",
        "   Attachments: Screenshot 72, Screenshot 74",
        "2. Image",
        "   Attachments: Screenshot 76",
      ].join("\n"),
      // Nothing before the list; the text item's two; none on the image's line, which the image item's own picture follows after the list.
      pictures: [0, 2, 1],
    });
  });

  it("copies an attached picture alone, and says when it has gone", async () => {
    const { commands, controller, items, written } = await setup();

    await expect(
      commands.copyPicture(items.file, items.picture)
    ).resolves.toStrictEqual({ ok: true });
    controller.apply({
      attachmentId: items.picture,
      id: items.file,
      type: "removeAttachment",
    });
    await expect(
      commands.copyPicture(items.file, items.picture)
    ).resolves.toStrictEqual({
      message: "This picture is no longer on the shelf.",
      ok: false,
    });
    await expect(
      Promise.all(written.map(async (contents) => await formats(contents[0])))
    ).resolves.toStrictEqual([{ "image/png": "PNG" }]);
  });

  /**
   * Notes as the shelf stores them (note-markdown.test.ts shows each typed
   * note's stored form), with what Copy puts on the clipboard for each: the
   * words as the shelf shows them, and the shelf's own rendering of them.
   */
  const NOTES: readonly {
    readonly stored: string;
    readonly text: string;
    readonly html: string;
  }[] = [
    {
      html: "<p>type &amp;copy; or &amp;#123; here</p>",
      stored: "type &amp;copy; or &amp;#123; here",
      text: "type &copy; or &#123; here",
    },
    {
      html: "<p>use &lt;draft> here</p>",
      stored: "use &lt;draft> here",
      text: "use <draft> here",
    },
    {
      html: "<p>x &lt;b>y&lt;/b> z</p>",
      stored: "x &lt;b>y&lt;/b> z",
      text: "x <b>y</b> z",
    },
    {
      html: "<p>Tom &amp; Jerry, R&amp;D, a &lt; b, x -> y</p>",
      stored: "Tom & Jerry, R&D, a < b, x -> y",
      text: "Tom & Jerry, R&D, a < b, x -> y",
    },
    {
      html: "<p>a_b_c and snake_case_name</p>",
      stored: "a_b_c and snake_case_name",
      text: "a_b_c and snake_case_name",
    },
    {
      html: "<p>__init__</p>",
      stored: String.raw`\_\_init\_\_`,
      text: "__init__",
    },
    {
      html: "<p>*not bold*</p>",
      stored: String.raw`\*not bold\*`,
      text: "*not bold*",
    },
    {
      html: String.raw`<p>\*not bold\*</p>`,
      stored: String.raw`\\\*not bold\\\*`,
      text: String.raw`\*not bold\*`,
    },
    {
      html: "<p>~x~ and ~/dev</p>",
      stored: String.raw`\~x\~ and \~/dev`,
      text: "~x~ and ~/dev",
    },
    {
      html: String.raw`<p>C:\Users\x\</p>`,
      stored: "C:\\Users\\x\\",
      text: "C:\\Users\\x\\",
    },
    {
      html: "<p>[x] and [x](y)</p>",
      stored: String.raw`[x] and [x\](y)`,
      text: "[x] and [x](y)",
    },
    {
      html: "<p>don`t, a `b` c</p>",
      stored: "don\\`t, a \\`b\\` c",
      text: "don`t, a `b` c",
    },
    { html: "<p>> quote</p>", stored: "&gt; quote", text: "> quote" },
    { html: "<p>* item</p>", stored: String.raw`\* item`, text: "* item" },
    {
      html: "<ul>\n<li>[x] task</li>\n</ul>",
      stored: String.raw`- \[x] task`,
      text: "- [x] task",
    },
    {
      html: '<p>email <a href="mailto:bob@example.com">bob@example.com</a> about</p>',
      stored: "email bob@example.com about",
      text: "email bob@example.com about",
    },
    {
      html: '<p>email <a href="mailto:bob@example.com">bob@example.com</a> about snake_case</p>',
      stored:
        "email [bob@example.com](mailto:bob@example.com) about snake\\_case",
      text: "email bob@example.com about snake_case",
    },
    {
      html: '<p><a href="https://example.com" title="API docs">https://example.com</a></p>',
      stored: '[https://example.com](https://example.com "API docs")',
      text: "https://example.com",
    },
    {
      html: "<p>a <strong>bold</strong> and <em>slanted</em> <del>word</del></p>",
      stored: "a **bold** and *slanted* ~~word~~",
      text: "a bold and slanted word",
    },
    {
      html: '<p>see <a href="https://example.com/docs">the docs</a></p>',
      stored: "see [the docs](https://example.com/docs)",
      text: "see the docs",
    },
    {
      html: '<p><a href="">run</a></p>',
      stored: "[run](javascript:alert(1))",
      text: "run",
    },
    {
      html: "<p>run <code>a_b*c\\ &lt;b></code> now</p>",
      stored: "run `a_b*c\\ <b>` now",
      text: "run a_b*c\\ <b> now",
    },
    {
      html: "<pre><code>const total = sum(items);\n  return total;\n</code></pre>",
      stored: "```\nconst total = sum(items);\n  return total;\n```",
      text: "const total = sum(items);\n  return total;",
    },
    {
      html: '<pre><code class="language-ts">let a_b = 1;\n</code></pre>',
      stored: "```ts\nlet a_b = 1;\n```",
      text: "let a_b = 1;",
    },
    {
      html: "<ul>\n<li>one</li>\n<li>two\n<ul>\n<li>under two</li>\n</ul>\n</li>\n</ul>",
      stored: "- one\n- two\n  - under two",
      text: "- one\n- two\n  - under two",
    },
    {
      html: '<ol start="3">\n<li>third</li>\n<li>fourth</li>\n</ol>',
      stored: "3. third\n4. fourth",
      text: "3. third\n4. fourth",
    },
    {
      html: "<p>one<br>\ntwo</p>\n<p>three</p>\n<p>after a blank line</p>",
      stored: "one\ntwo\n\nthree\n\n\n\nafter a blank line",
      text: "one\ntwo\n\nthree\n\nafter a blank line",
    },
    {
      html: "<h2>Plan &amp; *.ts</h2>\n<blockquote>\n<p>> said</p>\n</blockquote>",
      stored: "## Plan & *.ts\n\n> &gt; said",
      text: "Plan & *.ts\n\n> said",
    },
    {
      html: "<p>see chart and x y z</p>",
      stored: "see ![chart](https://example.com/c.png) and x <span>y</span> z",
      text: "see chart and x y z",
    },
    {
      html: "<table>\n<thead>\n<tr>\n<th>A</th>\n<th>B</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>C</td>\n<td>D</td>\n</tr>\n</tbody>\n</table>",
      stored: "| A | B |\n| --- | --- |\n| C | D |",
      text: "A\tB\nC\tD",
    },
  ];

  it.each(NOTES)(
    "copies the note stored as $stored as the shelf shows it, and its rendering as HTML",
    async ({ html, stored, text }) => {
      const { commands, controller, items, written } = await setup();

      controller.apply({ id: items.text, text: stored, type: "editText" });

      await commands.copy(items.text);

      await expect(formats(written[0]?.[0])).resolves.toStrictEqual({
        "text/html": html,
        "text/plain": text,
      });
    }
  );

  it("copies a note's details, as a list and with its link, as the shelf shows its words", async () => {
    const { commands, controller, items, written } = await setup();

    controller.apply({
      id: items.text,
      text: "type &amp;copy; **now**",
      type: "editText",
    });

    await commands.copyDetails(items.text);
    await commands.copyList([items.text]);
    await commands.copyWithLink(items.text);

    const [details, list, withLink] = await Promise.all(
      written.map(async (contents) => await formats(contents[0]))
    );

    expect({ details, list, withLink }).toStrictEqual({
      details: {
        "text/html":
          "<p>type &amp;copy; <strong>now</strong></p><p>Before Friday</p>",
        "text/plain": "type &copy; now\n\nBefore Friday",
      },
      list: {
        "text/html": "<ol><li>type &amp;copy; now<br>Before Friday</li></ol>",
        "text/plain": "1. type &copy; now\n   Before Friday",
      },
      withLink: { "text/plain": "type &copy; now\n\nBefore Friday" },
    });
  });

  it("copies a note's details with attachments: its words as the shelf renders them, its details, then each attachment by name", async () => {
    const { commands, controller, items, written } = await setup();

    controller.apply({
      id: items.text,
      text: "type &amp;copy; **now**",
      type: "editText",
    });
    controller.apply({
      attachments: [attachedFile(74)],
      id: items.text,
      type: "attach",
    });

    await commands.copyDetails(items.text);

    await expect(formats(written[0]?.[0])).resolves.toStrictEqual({
      "text/html":
        "<p>type &amp;copy; <strong>now</strong></p><p>Before Friday</p><p>Attachments:</p><p>Quote 74.pdf</p>",
      "text/plain":
        "type &copy; now\n\nBefore Friday\nAttachments:\n- Quote 74.pdf",
    });
  });

  it("copies a selection exactly as it was copied, its HTML beside its text, until it is edited", async () => {
    const { commands, controller, written } = await setup();

    const id = added(
      controller.apply({
        context: null,
        html: "<b>snake_case</b> &amp; more",
        text: "**snake_case** &amp; more",
        type: "addText",
        via: "selection",
      })
    );

    await commands.copy(id);

    await expect(formats(written[0]?.[0])).resolves.toStrictEqual({
      "text/html": "<b>snake_case</b> &amp; more",
      "text/plain": "**snake_case** &amp; more",
    });
  });

  /** Selections as another app copied them: Copy gives them back unread, with no format left empty. */
  const CAPTURES: readonly {
    readonly text: string;
    readonly html: string | null;
  }[] = [
    { html: null, text: "__init__" },
    { html: null, text: "  return value\n" },
    { html: null, text: "def __init__(self):\n    self.x = 1\n" },
    { html: null, text: "[endpoint]: https://example.com" },
    { html: null, text: "https://example.com\n" },
    { html: "<b>__init__</b>", text: "__init__\n" },
  ];

  it.each(CAPTURES)(
    "copies the selection $text exactly as it was copied",
    async ({ html, text }) => {
      const { commands, controller, written } = await setup();

      const id = added(
        controller.apply({
          context: null,
          html,
          text,
          type: "addText",
          via: "selection",
        })
      );

      await commands.copy(id);

      await expect(formats(written[0]?.[0])).resolves.toStrictEqual(
        html === null
          ? { "text/plain": text }
          : { "text/html": html, "text/plain": text }
      );
    }
  );

  /** Words the open editor sends, one live update each, that end on the captured words again. */
  const BACK_TO_CAPTURED: readonly {
    readonly way: string;
    readonly sent: (captured: string) => readonly string[];
  }[] = [
    { sent: (captured) => [`${captured} it`, captured], way: "Escape" },
    {
      sent: (captured) => [`${captured} it`, `${captured} its`, captured],
      way: "Undo",
    },
  ];

  it.each(
    BACK_TO_CAPTURED.flatMap((back) =>
      [
        { html: null, text: "__init__" },
        { html: "<b>__init__</b>", text: "__init__\n" },
      ].map((capture) => ({ ...back, ...capture }))
    )
  )(
    "copies and drags out a selection with HTML $html as it was copied after $way puts its words back",
    async ({ html, sent, text }) => {
      const { commands, controller, written } = await setup();

      const id = added(
        controller.apply({
          context: null,
          html,
          text,
          type: "addText",
          via: "selection",
        })
      );

      for (const words of sent(text)) {
        controller.apply({ id, text: words, type: "editText" });
      }

      await commands.copy(id);
      const item = controller.item(id);

      expect({
        copied: await formats(written[0]?.[0]),
        dragged: item === undefined ? undefined : itemText(item),
      }).toStrictEqual({
        copied:
          html === null
            ? { "text/plain": text }
            : { "text/html": html, "text/plain": text },
        dragged: text,
      });
    }
  );

  it("copies a selection as it was copied once its edit that failed to save is discarded", async () => {
    const { commands, controller, disk, written } = await setup();

    const id = added(
      controller.apply({
        context: null,
        html: null,
        text: "__init__",
        type: "addText",
        via: "selection",
      })
    );

    await controller.flush();
    disk.full = true;
    controller.apply({ id, text: "__init__ it", type: "editText" });
    await controller.flush();
    controller.discard(id);
    disk.full = false;

    await commands.copy(id);

    await expect(formats(written[0]?.[0])).resolves.toStrictEqual({
      "text/plain": "__init__",
    });
  });

  it("copies and drags out a selection as the shelf shows it once its words are changed", async () => {
    const { commands, controller, written } = await setup();

    const id = added(
      controller.apply({
        context: null,
        html: "<b>__init__</b>",
        text: "__init__",
        type: "addText",
        via: "selection",
      })
    );

    controller.apply({ id, text: "__init__ it", type: "editText" });

    await commands.copy(id);
    const item = controller.item(id);

    expect({
      copied: await formats(written[0]?.[0]),
      dragged: item === undefined ? undefined : itemText(item),
    }).toStrictEqual({
      copied: {
        "text/html": "<p><strong>init</strong> it</p>",
        "text/plain": "init it",
      },
      dragged: "init it",
    });
  });

  it("copies a selection with empty HTML as plain text alone", async () => {
    const { commands, controller, written } = await setup();

    const id = added(
      controller.apply({
        context: null,
        html: "",
        text: "__init__",
        type: "addText",
        via: "selection",
      })
    );

    await commands.copy(id);

    await expect(formats(written[0]?.[0])).resolves.toStrictEqual({
      "text/plain": "__init__",
    });
  });

  it("copies a selection's words unread with its details, as a list and with its link", async () => {
    const { commands, controller, written } = await setup();

    const id = added(
      controller.apply({
        context: null,
        html: null,
        text: "__init__",
        type: "addText",
        via: "selection",
      })
    );

    controller.apply({ description: "Rename it", id, type: "setDescription" });

    await commands.copyDetails(id);
    await commands.copyList([id]);
    await commands.copyWithLink(id);

    const [details, list, withLink] = await Promise.all(
      written.map(async (contents) => await formats(contents[0]))
    );

    expect({ details, list, withLink }).toStrictEqual({
      details: { "text/plain": "__init__\n\nRename it" },
      list: {
        "text/html": "<ol><li>__init__<br>Rename it</li></ol>",
        "text/plain": "1. __init__\n   Rename it",
      },
      withLink: { "text/plain": "__init__\n\nRename it" },
    });
  });

  it("copies a selection edited in the shelf as the shelf shows it", async () => {
    const { commands, controller, written } = await setup();

    const id = added(
      controller.apply({
        context: null,
        html: null,
        text: "__init__",
        type: "addText",
        via: "selection",
      })
    );

    controller.apply({ id, text: "**init** runs", type: "editText" });

    await commands.copy(id);

    await expect(formats(written[0]?.[0])).resolves.toStrictEqual({
      "text/html": "<p><strong>init</strong> runs</p>",
      "text/plain": "init runs",
    });
  });

  it("copies and drags out a code capture edited in the shelf as the code block it shows, as typed in plain text", async () => {
    const { commands, controller, written } = await setup();

    const id = added(
      controller.apply({
        context: {
          app: "Code",
          appLink: null,
          code: {
            file: "/Users/anna/p/recall.py",
            line: null,
            root: "/Users/anna/p",
          },
          title: "recall.py — p",
          url: null,
        },
        html: "<span>def __init__</span>",
        text: "def __init__(self):",
        type: "addText",
        via: "selection",
      })
    );

    controller.apply({
      id,
      text: "def __init__(self):\n    return *a*",
      type: "editText",
    });

    await commands.copy(id);
    const item = controller.item(id);

    expect({
      copied: await formats(written[0]?.[0]),
      dragged: item === undefined ? undefined : itemText(item),
    }).toStrictEqual({
      copied: {
        "text/html":
          "<pre><code>def __init__(self):\n    return *a*\n</code></pre>",
        "text/plain": "def __init__(self):\n    return *a*",
      },
      dragged: "def __init__(self):\n    return *a*",
    });
  });

  it("copies a note the shelf shows as nothing as it was typed, with no empty format", async () => {
    const { commands, controller, items, written } = await setup();

    controller.apply({
      id: items.text,
      text: "[endpoint]: https://example.com",
      type: "editText",
    });

    await commands.copy(items.text);

    await expect(formats(written[0]?.[0])).resolves.toStrictEqual({
      "text/plain": "[endpoint]: https://example.com",
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

  it("empties the clipboard for a snapshot of an empty one, which Electron reads as an item with no formats", async () => {
    const written: ClipboardContents[][] = [];
    let cleared = 0;

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
      copyState: () => ({ kind: "saved" }),
      discards: () => 0,
      onWrite: () => {},
      persisted: async () => await Promise.resolve({ ok: true }),
      readOnly: false,
      snapshot: () => ({
        doc: emptyShelf(SectionIdSchema.parse(uuid(1))),
        rev: 1,
      }),
      // As Electron's ClipboardItem: "at least one MIME type is required".
      toItem: (data) => {
        if (Object.keys(data).length === 0) {
          throw new TypeError("at least one MIME type is required");
        }

        return data;
      },
    });

    await expect(gate.restore([{}])).resolves.toBeUndefined();
    expect(written).toStrictEqual([]);
    expect(cleared).toBe(1);
  });
});

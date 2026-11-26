import { setTimeout as sleep } from "node:timers/promises";

import {
  ATTACHMENTS_MAX,
  AttachmentIdSchema,
  emptyShelf,
  ItemIdSchema,
  SectionIdSchema,
} from "@shared/shelf";
import type { Attachment } from "@shared/shelf";
import { describe, expect, it } from "vite-plus/test";

import { attachResult, createAttachments } from "./attachments";
import type { AttachmentDeps, DecodedImage } from "./attachments";
import { createShelfController } from "./shelf-controller";

const uuid = (n: number) =>
  `7a3c9e1b-2d4f-4a6b-8c0d-1e2f3a4b5c${String(n).padStart(2, "0")}`;

const PICTURE: DecodedImage = {
  heightPx: 300,
  png: new Uint8Array([137, 80, 78, 71]),
  widthPx: 400,
};

const attachedFile = (n: number): Attachment => ({
  addedAt: "2026-11-20T10:00:00.000Z",
  file: { bytes: 3, name: `Old ${n}.pdf`, stored: `${uuid(n)}.pdf` },
  id: AttachmentIdSchema.parse(uuid(n)),
  kind: "file",
});

/**
 * The real controller holding one note with `held` attachments, and a data
 * folder that stores a picture or file under the next generated name after
 * a turn of the event loop, as the disk does.
 */
const setup = (
  held: number,
  overrides: Partial<Pick<AttachmentDeps, "clipboard">> = {}
) => {
  let next = 10;
  const stored: string[] = [];
  const deleted: string[] = [];

  const controller = createShelfController({
    deleteAttachment: async () => {
      await Promise.resolve();
    },
    env: {
      newItemId: () => ItemIdSchema.parse(uuid((next += 1))),
      newSectionId: () => SectionIdSchema.parse(uuid((next += 1))),
      now: () => new Date("2026-11-20T10:00:00.000Z"),
    },
    initial: emptyShelf(SectionIdSchema.parse(uuid(1))),
    restore: async () => await Promise.resolve(false),
    save: async () => await Promise.resolve({ ok: true }),
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

  const id = controller.apply({ text: "Quote", type: "compose" });

  if (id === null) {
    throw new Error("not added");
  }

  controller.apply({
    attachments: Array.from({ length: held }, (_, at) => attachedFile(50 + at)),
    id,
    type: "attach",
  });

  const storeAs = async (extension: string): Promise<string> => {
    await sleep(0);

    const name = `${uuid((next += 1))}.${extension}`;

    stored.push(name);

    return name;
  };

  const attachments = createAttachments({
    apply: (op) => {
      controller.apply(op);
    },
    clipboard: overrides.clipboard ?? (async () => await Promise.resolve(null)),
    copyAttachment: async (_from, extension) => await storeAs(extension),
    decodeImage: (bytes) => (bytes[0] === 137 ? PICTURE : null),
    deleteAttachment: async (file) => {
      deleted.push(file);
      await Promise.resolve();
    },
    isStaged: (file) => file.startsWith("/tmp/Inset Shelf/"),
    item: controller.item,
    newAttachmentId: () => AttachmentIdSchema.parse(uuid((next += 1))),
    now: () => new Date("2026-11-21T09:00:00.000Z"),
    readImage: (file) => (file.endsWith(".png") ? PICTURE : null),
    stat: async (file) =>
      await Promise.resolve({
        isFile: !file.endsWith("/"),
        size: file.includes("huge") ? 300 * 1024 * 1024 : 2048,
      }),
    writeAttachment: async () => await storeAs("png"),
  });

  const names = (): readonly string[] =>
    controller
      .item(id)
      ?.attachments.map((attachment) =>
        attachment.kind === "file" ? attachment.file.name : attachment.name
      ) ?? [];

  return { attachments, controller, deleted, id, names, stored };
};

describe(createAttachments, () => {
  it("attaches dropped pictures and files in order, a picture under its name without the extension", async () => {
    const { attachments, controller, id, stored } = setup(0);

    const outcome = await attachments.attachFilesTo(id, [
      "/Users/someone/Desktop/Screenshot 2026-11-21 at 09.00.00.png",
      "/Users/someone/Documents/Quote.pdf",
    ]);

    const [picture, file] = controller.item(id)?.attachments ?? [];

    expect({ file, outcome, picture }).toStrictEqual({
      file: {
        addedAt: "2026-11-21T09:00:00.000Z",
        file: { bytes: 2048, name: "Quote.pdf", stored: stored[1] },
        id: uuid(15),
        kind: "file",
      },
      outcome: { attached: [uuid(14), uuid(15)], problems: [], refused: 0 },
      picture: {
        addedAt: "2026-11-21T09:00:00.000Z",
        id: uuid(14),
        image: {
          file: stored[0],
          heightPx: 300,
          pixelsPerDip: 1,
          widthPx: 400,
        },
        kind: "image",
        name: "Screenshot 2026-11-21 at 09.00.00",
        pins: [],
      },
    });
  });

  it("gives two drops landing at once only the room there is, and deletes the files that didn't fit", async () => {
    const { attachments, controller, deleted, id, names, stored } = setup(
      ATTACHMENTS_MAX - 1
    );

    const [first, second] = await Promise.all([
      attachments.attachFilesTo(id, ["/a/First.pdf"]),
      attachments.attachFilesTo(id, ["/a/Second.pdf"]),
    ]);

    expect({
      deleted,
      first,
      last: names().at(-1),
      second,
      total: names().length,
    }).toStrictEqual({
      deleted: [stored[1]],
      first: {
        attached: [controller.item(id)?.attachments.at(-1)?.id],
        problems: [],
        refused: 0,
      },
      last: "First.pdf",
      second: { attached: [], problems: [], refused: 1 },
      total: ATTACHMENTS_MAX,
    });
    expect(attachResult(second)).toStrictEqual({
      attached: [],
      message: `Nothing was attached. An item holds up to ${ATTACHMENTS_MAX}.`,
    });
  });

  it("attaches what fits of a larger drop and says how much did", async () => {
    const { attachments, controller, id, names } = setup(ATTACHMENTS_MAX - 2);

    const outcome = await attachments.attachFilesTo(
      id,
      ["A", "B", "C", "D", "E"].map((name) => `/a/${name}.pdf`)
    );

    expect({
      added: names().slice(-2),
      result: attachResult(outcome),
    }).toStrictEqual({
      added: ["A.pdf", "B.pdf"],
      result: {
        attached: controller
          .item(id)
          ?.attachments.slice(-2)
          .map((each) => each.id),
        message: `Attached 2 of 5. An item holds up to ${ATTACHMENTS_MAX}.`,
      },
    });
  });

  it("names what a partial drop attached, so its Undo takes off exactly those", async () => {
    const { attachments, controller, id } = setup(ATTACHMENTS_MAX - 2);

    const outcome = await attachments.attachFilesTo(
      id,
      ["A", "B", "C"].map((name) => `/a/${name}.pdf`)
    );

    const landed = controller
      .item(id)
      ?.attachments.slice(-2)
      .map((attachment) => attachment.id);

    expect(attachResult(outcome)).toStrictEqual({
      attached: landed,
      message: `Attached 2 of 3. An item holds up to ${ATTACHMENTS_MAX}.`,
    });
  });

  it("ignores the shelf's own dragged-out copy dropped back, and names what can't be read", async () => {
    const { attachments, controller, id, names, stored } = setup(0);

    const outcome = await attachments.attachFilesTo(id, [
      "/tmp/Inset Shelf/abc/Quote.pdf",
      "/a/Folder/",
      "/a/huge.mov",
      "/a/Notes.txt",
    ]);

    expect({
      names: names(),
      result: attachResult(outcome),
      stored,
    }).toStrictEqual({
      names: ["Notes.txt"],
      result: {
        attached: controller.item(id)?.attachments.map((each) => each.id),
        message:
          "Folder is a folder, not a file. huge.mov is larger than 200 MB.",
      },
      stored: [`${uuid(12)}.txt`],
    });
  });

  it("attaches a pasted picture, the clipboard's picture or a file copied there, and says when the clipboard holds neither", async () => {
    const pasted = setup(0);

    const fromImage = setup(0, {
      clipboard: async () =>
        await Promise.resolve({ image: PICTURE, kind: "image" as const }),
    });

    const fromFile = setup(0, {
      clipboard: async () =>
        await Promise.resolve({ kind: "file" as const, path: "/a/Plan.png" }),
    });

    const empty = setup(0);

    const results = [
      await pasted.attachments.pasteImageTo(pasted.id, PICTURE.png),
      await pasted.attachments.pasteImageTo(pasted.id, new Uint8Array([1])),
      await fromImage.attachments.pasteImageTo(fromImage.id, null),
      await fromFile.attachments.pasteImageTo(fromFile.id, null),
      await empty.attachments.pasteImageTo(empty.id, null),
    ].map((outcome) => attachResult(outcome).message);

    expect({
      names: [pasted, fromImage, fromFile, empty].map((at) => at.names()),
      results,
    }).toStrictEqual({
      names: [["Pasted image"], ["Pasted image"], ["Plan"], []],
      results: [
        null,
        "The pasted data is not an image Inset can read.",
        null,
        null,
        "The clipboard holds no image.",
      ],
    });
  });

  it("deletes what was stored for an item deleted while it was read", async () => {
    const { attachments, controller, deleted, id, stored } = setup(0);
    const outcome = attachments.attachFilesTo(id, ["/a/Late.pdf"]);

    controller.apply({ id, type: "remove" });

    expect(attachResult(await outcome)).toStrictEqual({
      attached: [],
      message: "This item no longer exists.",
    });
    expect(deleted).toStrictEqual(stored);
  });
});

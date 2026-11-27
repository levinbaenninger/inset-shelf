import { describe, expect, it } from "vite-plus/test";
import type { z } from "zod";

import { CodePlaceSchema, isCapturedText } from "./code-place";
import v3 from "./fixtures/shelf-v3.json";
import {
  applyOp,
  storedFilesOf,
  groupItems,
  itemsAsList,
  listHtmlWithImage,
  itemText,
  itemTextWithLink,
  parseShelfDocument,
  emptyShelf,
  ATTACHMENTS_MAX,
  AttachedImageSchema,
  AttachmentSchema,
  ContextSchema,
  ItemIdSchema,
  parseComposer,
  SectionIdSchema,
  TEXT_MAX,
  ShelfDocSchema,
  UNDO_MAX,
  fitText,
  withPinLabel,
  withStepBack,
} from "./shelf";
import type {
  ImageItem,
  OpEnv,
  ShelfDoc,
  ShelfOp,
  MainOp,
  Removed,
} from "./shelf";

const uuid = (n: number) =>
  `3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1b${String(n).padStart(2, "0")}`;

const env = (): OpEnv => {
  let next = 10;

  return {
    newItemId: () => ItemIdSchema.parse(uuid((next += 1))),
    newSectionId: () => SectionIdSchema.parse(uuid((next += 1))),
    now: () => new Date("2026-10-22T10:00:00.000Z"),
  };
};

const INBOX = SectionIdSchema.parse(uuid(1));

const never = (): never => {
  throw new Error("missing");
};

/** The ids in fixtures/shelf-v3.json. */
const uuid8 = (n: number) => `8c1d2e3f-4a5b-4c6d-8e7f-90a1b2c3d${n}`;

interface Applied {
  readonly doc: ShelfDoc;
  readonly pending: readonly Removed[];
  readonly discarded: number;
}

const apply = (
  doc: ShelfDoc,
  ops: readonly (ShelfOp | MainOp)[],
  e = env()
): Applied => {
  let current = doc;
  let pending: readonly Removed[] = [];
  let discarded = 0;

  // Keeps the undo list as the shelf controller does (src/main/shelf-controller.ts).
  for (const op of ops) {
    const result = applyOp(current, op, e, pending);

    current = result.doc;
    discarded += result.discarded.length;

    if (op.type === "undoRemove") {
      const restored = op.id ?? pending.at(-1)?.item.id;

      pending = pending.filter((removed) => removed.item.id !== restored);
    } else if (result.removed !== null) {
      pending = [...pending, result.removed].slice(-UNDO_MAX);
    }
  }

  return { discarded, doc: current, pending };
};

describe(parseComposer, () => {
  it("reads a single # line as a section and anything else as a note", () => {
    expect(parseComposer("# Prompts ")).toStrictEqual({
      kind: "section",
      name: "Prompts",
    });
    expect(parseComposer("#hashtag")).toStrictEqual({
      kind: "note",
      text: "#hashtag",
    });
    expect(parseComposer("# Title\nbody")).toStrictEqual({
      kind: "note",
      text: "# Title\nbody",
    });
    expect(parseComposer("  \n ")).toStrictEqual({ kind: "empty" });
  });
});

describe(applyOp, () => {
  const start = emptyShelf(INBOX);

  it("adds notes to the active section and keeps the document valid", () => {
    const { doc } = apply(start, [
      { text: "Ask about the discount", type: "compose" },
    ]);

    expect(doc.items).toMatchObject([
      {
        done: false,
        kind: "text",
        sectionId: INBOX,
        text: "Ask about the discount",
        via: "typed",
      },
    ]);
    expect(ShelfDocSchema.safeParse(doc).success).toBeTruthy();
  });

  it("makes a section active, reusing one with the same name", () => {
    const { doc } = apply(start, [
      { text: "# Prompts", type: "compose" },
      { text: "Summarise this thread", type: "compose" },
      { text: "# inbox", type: "compose" },
    ]);

    expect(doc.sections.map((section) => section.name)).toStrictEqual([
      "Inbox",
      "Prompts",
    ]);
    expect(doc.activeSectionId).toBe(INBOX);
    expect(doc.items[0]?.sectionId).toBe(doc.sections[1]?.id);
  });

  it("puts back the last deletion, or any recent one asked for", () => {
    const added = apply(start, [
      { text: "one", type: "compose" },
      { text: "two", type: "compose" },
      { text: "three", type: "compose" },
    ]).doc;

    const [first, second] = added.items;

    if (first === undefined || second === undefined) {
      throw new Error("missing items");
    }

    const undone = apply(added, [
      { id: second.id, type: "remove" },
      { type: "undoRemove" },
    ]);

    expect(undone.doc.items.map((item) => item.id)).toStrictEqual(
      added.items.map((item) => item.id)
    );

    const twice = apply(added, [
      { id: first.id, type: "remove" },
      { id: second.id, type: "remove" },
      { id: first.id, type: "undoRemove" },
    ]);

    expect(twice.discarded).toBe(0);
    expect(twice.doc.items.map((item) => item.id)).toStrictEqual([
      first.id,
      added.items[2]?.id,
    ]);
    expect(twice.pending.map((removed) => removed.item.id)).toStrictEqual([
      second.id,
    ]);
  });

  it("discards the oldest deletion for good past the undo limit", () => {
    const many = apply(
      start,
      Array.from({ length: UNDO_MAX + 1 }, (_, n) => ({
        text: `note ${n}`,
        type: "compose" as const,
      }))
    ).doc;

    const removedAll = apply(
      many,
      many.items.map((item) => ({ id: item.id, type: "remove" as const }))
    );

    expect(removedAll.discarded).toBe(1);
    expect(removedAll.pending).toHaveLength(UNDO_MAX);
  });

  it("toggles done and clears done items of the active section only", () => {
    const e = env();

    const filled = apply(
      start,
      [
        { text: "a", type: "compose" },
        { text: "# Later", type: "compose" },
        { text: "b", type: "compose" },
      ],
      e
    ).doc;

    const [a, b] = filled.items;

    if (a === undefined || b === undefined) {
      throw new Error("missing items");
    }

    const cleared = apply(
      filled,
      [
        { id: a.id, type: "toggleDone" },
        { id: b.id, type: "toggleDone" },
        { type: "clearDone" },
      ],
      e
    );

    expect(cleared.doc.items.map((item) => item.id)).toStrictEqual([a.id]);
    expect(cleared.discarded).toBe(1);
  });

  it("adds images with an optional pin and edits their note", () => {
    const image = {
      file: `${uuid(50)}.png`,
      heightPx: 600,
      pixelsPerDip: 2,
      widthPx: 960,
    };

    const { doc } = apply(start, [
      {
        image,
        pins: [{ x: 480, y: 300 }],
        source: "Built-in Retina Display",
        context: null,
        type: "addImage",
        via: "pin",
      },
    ]);

    const [item] = doc.items;

    expect(item).toMatchObject({
      kind: "image",
      note: "",
      pins: [{ x: 480, y: 300 }],
      via: "pin",
    });

    if (item === undefined) {
      throw new Error("missing item");
    }

    expect(
      apply(doc, [
        { id: item.id, note: "Total ignores the discount", type: "editNote" },
      ]).doc.items[0]
    ).toMatchObject({
      note: "Total ignores the discount",
    });
  });

  it("ignores a blank selection and edits that target the wrong kind", () => {
    expect(
      apply(start, [
        {
          context: null,
          html: null,
          text: "   ",
          type: "addText",
          via: "selection",
        },
      ]).doc.items
    ).toHaveLength(0);
  });

  it("keeps a note on an attached file", () => {
    const { doc } = apply(start, [
      {
        context: null,
        file: { bytes: 19, name: "Report.txt", stored: `${uuid(60)}.txt` },
        type: "addFile",
      },
    ]);

    const id = doc.items[0]?.id;

    if (id === undefined) {
      throw new Error("missing item");
    }

    const edited = apply(doc, [
      { id, note: "Numbers for Friday", type: "editNote" },
    ]).doc;

    expect(edited.items[0]).toMatchObject({
      kind: "file",
      note: "Numbers for Friday",
    });
    expect(ShelfDocSchema.safeParse(edited).success).toBeTruthy();
  });

  it("replaces an image in place and discards the old file", () => {
    const image = {
      file: `${uuid(50)}.png`,
      heightPx: 600,
      pixelsPerDip: 2,
      widthPx: 960,
    };

    const { doc } = apply(start, [
      {
        context: null,
        image,
        pins: [{ x: 480, y: 300 }],
        source: null,
        type: "addImage",
        via: "pin",
      },
      {
        context: null,
        html: null,
        text: "after",
        type: "addText",
        via: "typed",
      },
    ]);

    const [first] = doc.items;

    if (first === undefined) {
      throw new Error("missing item");
    }

    const annotated = { ...image, file: `${uuid(51)}.png` };

    const result = applyOp(
      doc,
      { id: first.id, image: annotated, type: "replaceImage" },
      env(),
      []
    );

    expect(result.doc.items.map((item) => item.id)).toStrictEqual(
      doc.items.map((item) => item.id)
    );
    expect(result.doc.items[0]).toMatchObject({
      image: annotated,
      pins: [{ x: 480, y: 300 }],
    });
    expect(result.discarded).toStrictEqual([first]);
    expect(
      applyOp(doc, { id: first.id, image, type: "replaceImage" }, env(), []).doc
    ).toBe(doc);
  });

  it("keeps the marks drawn into a replaced image, and drops them when the image goes back to the bare picture", () => {
    const image = {
      file: `${uuid(50)}.png`,
      heightPx: 600,
      pixelsPerDip: 2,
      widthPx: 960,
    };

    const { doc } = apply(start, [
      {
        context: null,
        image,
        pins: [],
        source: null,
        type: "addImage",
        via: "area",
      },
    ]);

    const [first] = doc.items;

    if (first === undefined) {
      throw new Error("missing item");
    }

    const annotated = { ...image, file: `${uuid(51)}.png` };
    const scene = { base: image, file: `${uuid(52)}.json` };

    const marked = applyOp(
      doc,
      { id: first.id, image: annotated, scene, type: "replaceImage" },
      env(),
      []
    );

    const bare = applyOp(
      marked.doc,
      { id: first.id, image, type: "replaceImage" },
      env(),
      []
    );

    expect({
      bare: bare.doc.items[0],
      discarded: bare.discarded.flatMap(storedFilesOf),
      marked: marked.doc.items[0],
    }).toStrictEqual({
      bare: first,
      discarded: [`${uuid(51)}.png`, `${uuid(52)}.json`, `${uuid(50)}.png`],
      marked: { ...first, image: annotated, scene },
    });
  });
});

describe(groupItems, () => {
  const e = env();

  const filled = apply(
    emptyShelf(INBOX),
    [
      { text: "Total ignores the discount", type: "compose" },
      { text: "# Later", type: "compose" },
      { text: "Check the plan picker copy", type: "compose" },
      { text: "# Empty", type: "compose" },
      { text: "# Inbox", type: "compose" },
    ],
    e
  ).doc;

  it("lists every section in order, empty ones too", () => {
    const groups = groupItems(
      { ...filled, activeSectionId: filled.sections[2]?.id ?? INBOX },
      ""
    );

    expect(
      groups.map((group) => [
        group.section.name,
        group.items.length,
        group.active,
      ])
    ).toStrictEqual([
      ["Inbox", 1, false],
      ["Later", 1, false],
      ["Empty", 0, true],
    ]);
    expect(
      groupItems(filled, "").map((group) => group.section.name)
    ).toStrictEqual(["Inbox", "Later", "Empty"]);
  });

  it("keeps only matching items and drops sections without a match", () => {
    expect(
      groupItems(filled, "PLAN copy").map((group) => [
        group.section.name,
        group.items.length,
      ])
    ).toStrictEqual([["Later", 1]]);
  });

  it("keeps the item being typed in when its words stop matching", () => {
    const typing = filled.items.find(
      (item) => item.kind === "text" && item.text.startsWith("Check")
    );

    expect(
      groupItems(filled, "discount", new Date(), typing?.id ?? null).map(
        (group) => [group.section.name, group.items.map(itemText)]
      )
    ).toStrictEqual([
      ["Inbox", ["Total ignores the discount"]],
      ["Later", ["Check the plan picker copy"]],
    ]);
  });
});

describe("selections with links", () => {
  it("keeps the links a stored shelf accepts, so it still loads", () => {
    const long = `https://example.com/?q=${"a".repeat(2100)}`;

    const { doc } = apply(emptyShelf(INBOX), [
      {
        context: null,
        html: `<a href="https://github.com/a/b/pull/1">PR</a> <a href="${long}">long</a>`,
        text: "PR long",
        type: "addText",
        via: "selection",
      },
    ]);

    const [item] = doc.items;

    expect(item?.kind === "text" ? item.links : null).toStrictEqual([
      { text: "PR", url: "https://github.com/a/b/pull/1" },
    ]);
    expect(parseShelfDocument(JSON.stringify(doc))?.items[0]).toStrictEqual(
      item
    );
  });

  it("keeps a page opened from a file as the selection's source", () => {
    const url =
      "file:///Users/levin/Design-Expo/03_Standmaterial/Anforderung.html";

    const { doc } = apply(emptyShelf(INBOX), [
      {
        context: {
          app: "Zen",
          appLink: null,
          code: null,
          title: "Anmeldung",
          url,
        },
        html: null,
        text: "Anmeldung",
        type: "addText",
        via: "selection",
      },
    ]);

    expect(
      parseShelfDocument(JSON.stringify(doc))?.items[0]?.context?.url
    ).toBe(url);
  });

  it("drops the copied HTML once the text is edited", () => {
    const added = apply(emptyShelf(INBOX), [
      {
        context: null,
        html: "<b>bold</b>",
        text: "bold",
        type: "addText",
        via: "selection",
      },
    ]).doc;

    const [item] = added.items;

    if (item === undefined) {
      throw new Error("missing item");
    }

    const [edited] = apply(added, [
      { id: item.id, text: "plain", type: "editText" },
    ]).doc.items;

    expect(edited).toMatchObject({ html: null, text: "plain" });
  });
});

describe("sections", () => {
  const e = env();

  const filled = apply(
    emptyShelf(INBOX),
    [
      { text: "first", type: "compose" },
      { name: "Later", type: "addSection" },
      { text: "second", type: "compose" },
      { text: "third", type: "compose" },
    ],
    e
  ).doc;

  const [, later] = filled.sections;

  if (later === undefined) {
    throw new Error("missing fixture");
  }

  it("adds a section for new items, or picks the one with that name", () => {
    expect(filled.sections.map((section) => section.name)).toStrictEqual([
      "Inbox",
      "Later",
    ]);
    expect(filled.activeSectionId).toBe(later.id);
    expect(
      apply(filled, [{ name: " inbox ", type: "addSection" }], e).doc
        .activeSectionId
    ).toBe(INBOX);
  });

  it("renames a section, unless another one has the name", () => {
    expect(
      apply(
        filled,
        [{ id: later.id, name: " Soon ", type: "renameSection" }],
        e
      ).doc.sections[1]?.name
    ).toBe("Soon");
    expect(
      apply(filled, [{ id: later.id, name: "Inbox", type: "renameSection" }], e)
        .doc
    ).toStrictEqual(filled);
  });

  it("deletes a section with its items and moves new items to the first section", () => {
    const { discarded, doc } = apply(
      filled,
      [{ id: later.id, type: "removeSection" }],
      e
    );

    expect(doc.sections.map((section) => section.name)).toStrictEqual([
      "Inbox",
    ]);
    expect(
      doc.items.map((item) => item.kind === "text" && item.text)
    ).toStrictEqual(["first"]);
    expect(doc.activeSectionId).toBe(INBOX);
    expect(discarded).toBe(2);
    expect(ShelfDocSchema.safeParse(doc).success).toBeTruthy();
  });

  it("keeps the last section", () => {
    const only = emptyShelf(INBOX);

    expect(
      apply(only, [{ id: INBOX, type: "removeSection" }], e).doc
    ).toStrictEqual(only);
  });

  it("clears the checked items of the section asked for", () => {
    const [first] = filled.items;

    if (first === undefined) {
      throw new Error("missing fixture");
    }

    const { discarded, doc } = apply(
      filled,
      [
        { id: first.id, type: "toggleDone" },
        { sectionId: INBOX, type: "clearDone" },
      ],
      e
    );

    expect(discarded).toBe(1);
    expect(doc.items).toHaveLength(2);
  });
});

describe("moveItem", () => {
  it("moves an item to the end of another section and ignores unknown sections", () => {
    const e = env();

    const filled = apply(
      emptyShelf(INBOX),
      [
        { text: "first", type: "compose" },
        { text: "# Later", type: "compose" },
        { text: "second", type: "compose" },
      ],
      e
    ).doc;

    const [first] = filled.items;
    const later = filled.sections[1]?.id;

    if (first === undefined || later === undefined) {
      throw new Error("missing fixture");
    }

    const moved = apply(
      filled,
      [{ id: first.id, sectionId: later, type: "moveItem" }],
      e
    ).doc;

    expect(moved.items.map((item) => [item.id, item.sectionId])).toStrictEqual([
      [filled.items[1]?.id, later],
      [first.id, later],
    ]);
    expect(
      apply(
        filled,
        [
          {
            id: first.id,
            sectionId: SectionIdSchema.parse(uuid(80)),
            type: "moveItem",
          },
        ],
        e
      ).doc
    ).toStrictEqual(filled);
  });
});

describe(parseShelfDocument, () => {
  // Shaped like a shelf saved by the first build testers ran.
  const firstFormat = {
    activeSectionId: uuid(1),
    items: [
      {
        createdAt: "2026-10-22T17:35:59.435Z",
        done: false,
        id: uuid(20),
        kind: "text",
        sectionId: uuid(1),
        text: "Building this little habit app\n",
        via: "selection",
      },
      {
        createdAt: "2026-10-22T17:40:00.000Z",
        done: true,
        id: uuid(21),
        image: {
          file: `${uuid(50)}.png`,
          heightPx: 600,
          pixelsPerDip: 2,
          widthPx: 960,
        },
        kind: "image",
        note: "",
        pin: { x: 480, y: 300 },
        sectionId: uuid(1),
        source: "Built-in Retina Display",
        via: "pin",
      },
    ],
    schemaVersion: 1,
    sections: [{ id: uuid(1), name: "Inbox" }],
  };

  it("upgrades the first format and keeps every item as it was", () => {
    const doc = parseShelfDocument(JSON.stringify(firstFormat));

    expect(doc?.schemaVersion).toBe(4);
    expect(doc?.items).toMatchObject([
      {
        attachments: [],
        color: null,
        context: null,
        description: "",
        due: null,
        id: uuid(20),
        steps: [],
        text: "Building this little habit app\n",
        windows: [],
      },
      {
        attachments: [],
        color: null,
        context: null,
        done: true,
        id: uuid(21),
        pins: [{ x: 480, y: 300 }],
        title: null,
      },
    ]);
    expect(ShelfDocSchema.safeParse(doc).success).toBeTruthy();
  });

  it("reads the current format as is and rejects anything else", () => {
    const current = emptyShelf(INBOX);

    expect(parseShelfDocument(JSON.stringify(current))).toStrictEqual(current);
    expect(
      parseShelfDocument(JSON.stringify({ ...firstFormat, schemaVersion: 5 }))
    ).toBeNull();
    expect(parseShelfDocument("{ not a shelf")).toBeNull();
  });

  describe("an image's kept marks (feedback round 13)", () => {
    const base = {
      file: `${uuid(50)}.png`,
      heightPx: 600,
      pixelsPerDip: 2,
      widthPx: 960,
    };

    const shelfWith = (
      fields: Partial<Pick<ImageItem, "image" | "scene">>
    ) => ({
      activeSectionId: uuid(1),
      items: [
        {
          attachments: [],
          color: null,
          context: null,
          createdAt: "2026-10-22T17:40:00.000Z",
          description: "",
          done: false,
          due: null,
          id: uuid(21),
          image: base,
          kind: "image",
          note: "",
          pins: [{ x: 480, y: 300 }],
          sectionId: uuid(1),
          source: null,
          steps: [],
          title: null,
          via: "area",
          windows: [],
          ...fields,
        },
      ],
      schemaVersion: 4,
      sections: [{ id: uuid(1), name: "Inbox" }],
    });

    it("reads an image saved before marks were kept exactly as it was, with no scene", () => {
      const old = shelfWith({});

      expect(parseShelfDocument(JSON.stringify(old))).toStrictEqual(old);
    });

    it("keeps the marks' file and the picture under them through a save and a read, and names all three files", () => {
      const kept = shelfWith({
        image: { ...base, file: `${uuid(51)}.png` },
        scene: { base, file: `${uuid(52)}.json` },
      });

      const read = parseShelfDocument(JSON.stringify(kept));
      const [item] = read?.items ?? [];

      expect({
        files: item === undefined ? [] : storedFilesOf(item),
        read,
      }).toStrictEqual({
        files: [`${uuid(51)}.png`, `${uuid(52)}.json`, `${uuid(50)}.png`],
        read: kept,
      });
    });

    it("names the marks' file of a drawing made on a blank page, which has no picture under them", () => {
      const read = parseShelfDocument(
        JSON.stringify(
          shelfWith({ scene: { base: null, file: `${uuid(52)}.json` } })
        )
      );

      const [item] = read?.items ?? [];

      expect(item === undefined ? [] : storedFilesOf(item)).toStrictEqual([
        `${uuid(50)}.png`,
        `${uuid(52)}.json`,
      ]);
    });

    it("rejects a scene whose marks are not a JSON file the app named", () => {
      expect(
        parseShelfDocument(
          JSON.stringify(
            shelfWith({ scene: { base: null, file: "../shelf.json" } })
          )
        )
      ).toBeNull();
    });
  });
});

describe(itemsAsList, () => {
  it("numbers items with their links, indenting the lines that follow", () => {
    const e = env();

    const { doc } = apply(
      emptyShelf(INBOX),
      [
        {
          context: {
            app: "Chrome",
            appLink: null,
            code: null,
            title: "Pricing",
            url: "https://example.com/pricing",
          },
          text: "Trial needs a card",
          html: null,
          type: "addText",
          via: "selection",
        },
        { text: "Ask Nina\nabout Q3", type: "compose" },
        { text: "done already", type: "compose" },
      ],
      e
    );

    const last = doc.items.at(-1);

    if (last === undefined) {
      throw new Error("missing item");
    }

    const marked = apply(doc, [{ id: last.id, type: "toggleDone" }], e).doc;

    const open = marked.items.filter((item) => !item.done);

    expect(itemsAsList(open)).toStrictEqual({
      count: 2,
      html: '<ol><li>Trial needs a card (<a href="https://example.com/pricing">https://example.com/pricing</a>)</li><li>Ask Nina<br>about Q3</li></ol>',
      text: "1. Trial needs a card (https://example.com/pricing)\n2. Ask Nina\n   about Q3",
    });
    expect(itemsAsList(marked.items).count).toBe(3);
    expect(itemTextWithLink(marked.items[0] ?? last)).toBe(
      "Trial needs a card\nhttps://example.com/pricing"
    );
  });
});

describe(listHtmlWithImage, () => {
  it("puts the picture after the list, in the HTML", () => {
    expect(
      listHtmlWithImage("<ol><li>Fix the &lt;nav&gt;</li></ol>", {
        alt: 'The "nav" bar',
        base64: "iVBORw0KGgo=",
        width: 480.4,
      })
    ).toBe(
      '<ol><li>Fix the &lt;nav&gt;</li></ol><p><img src="data:image/png;base64,iVBORw0KGgo=" width="480" alt="The &quot;nav&quot; bar"></p>'
    );
  });
});

describe("setColor", () => {
  it("tags an item with a colour and clears it again", () => {
    const e = env();

    const { doc } = apply(
      emptyShelf(INBOX),
      [{ text: "x", type: "compose" }],
      e
    );

    const [item] = doc.items;

    if (item === undefined) {
      throw new Error("missing item");
    }

    const tagged = apply(
      doc,
      [{ color: "green", id: item.id, type: "setColor" }],
      e
    ).doc;

    expect(tagged.items[0]?.color).toBe("green");
    expect(
      apply(tagged, [{ color: null, id: item.id, type: "setColor" }], e).doc
        .items[0]?.color
    ).toBeNull();
  });
});

const step = (n: number, done = false) => ({
  done,
  id: `3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1d${String(n).padStart(2, "0")}`,
  text: `Step ${n}`,
});

describe(withStepBack, () => {
  it("puts a removed step back where it was, keeping ticks made since", () => {
    const now = [step(1, true), step(3)];

    expect(withStepBack(now, { index: 1, step: step(2) })).toStrictEqual([
      step(1, true),
      step(2),
      step(3),
    ]);
  });

  it("puts it at the end when the list has since got shorter", () => {
    expect(withStepBack([step(1)], { index: 4, step: step(5) })).toStrictEqual([
      step(1),
      step(5),
    ]);
  });

  it("does nothing when the step is already back", () => {
    expect(
      withStepBack([step(1), step(2)], { index: 0, step: step(2) })
    ).toStrictEqual([step(1), step(2)]);
  });
});

describe(withPinLabel, () => {
  it("changes only that pin's label, keeping where every pin is", () => {
    const pins = [
      { label: "Title", x: 10, y: 20 },
      { x: 30, y: 40 },
    ];

    expect(withPinLabel(pins, 1, "Error text")).toStrictEqual([
      { label: "Title", x: 10, y: 20 },
      { label: "Error text", x: 30, y: 40 },
    ]);
  });

  it("leaves the pins alone when that pin is gone", () => {
    expect(withPinLabel([{ x: 1, y: 2 }], 3, "Gone")).toStrictEqual([
      { x: 1, y: 2 },
    ]);
  });
});

describe(fitText, () => {
  it("keeps text that fits", () => {
    expect(fitText("Quote", 5)).toBe("Quote");
  });

  it("cuts longer text to the limit, ending in an ellipsis", () => {
    expect(fitText("Quotes", 5)).toBe("Quot…");
  });
});

const pictureAt = (n: number) => ({
  file: `${uuid(n)}.png`,
  heightPx: 600,
  pixelsPerDip: 2,
  widthPx: 960,
});

const attachedImage = (
  n: number,
  fields: Partial<z.input<typeof AttachedImageSchema>> = {}
) => ({
  addedAt: "2026-11-20T10:00:00.000Z",
  id: uuid(n),
  image: pictureAt(n + 1),
  kind: "image",
  name: "Screenshot 2026-11-20 at 10.00.00",
  pins: [],
  ...fields,
});

const attachedFile = (n: number, stored = `${uuid(n + 1)}.pdf`) => ({
  addedAt: "2026-11-20T10:01:00.000Z",
  file: { bytes: 2048, name: "Quote.pdf", stored },
  id: uuid(n),
  kind: "file",
});

const shelfWithAttachments = (attachments: readonly unknown[]) =>
  JSON.stringify({
    activeSectionId: uuid(1),
    items: [
      {
        attachments,
        color: null,
        context: null,
        createdAt: "2026-11-20T09:00:00.000Z",
        description: "",
        done: false,
        due: null,
        html: null,
        id: uuid(20),
        kind: "text",
        links: [],
        sectionId: uuid(1),
        steps: [],
        text: "Chairs",
        via: "typed",
        windows: [],
      },
    ],
    schemaVersion: 4,
    sections: [{ id: uuid(1), name: "Inbox" }],
  });

describe("attachments on an item (format 4)", () => {
  /** A shelf as a version 3 build wrote it: every field spelled out, pretty-printed. */
  const v3Text = `${JSON.stringify(v3, null, 2)}\n`;

  it("reads a version 3 shelf as version 4, every item as it was with an empty attachment list", () => {
    const doc = parseShelfDocument(v3Text);

    expect(doc).toStrictEqual({
      ...v3,
      items: v3.items.map((item) => ({
        ...item,
        attachments: [],
        context: item.context === null ? null : { ...item.context, code: null },
      })),
      schemaVersion: 4,
    });
    expect(doc === null ? [] : doc.items.map(storedFilesOf)).toStrictEqual([
      [`${uuid8(501)}.png`],
      [`${uuid8(502)}.png`, `${uuid8(504)}.json`, `${uuid8(503)}.png`],
      [`${uuid8(505)}.png`],
      [`${uuid8(506)}.png`, `${uuid8(507)}.json`],
      [`${uuid8(508)}.pdf`],
      [],
    ]);
  });

  it("reads what it saves back the same", () => {
    const doc = parseShelfDocument(v3Text);

    expect(parseShelfDocument(JSON.stringify(doc, null, 2))).toStrictEqual(doc);
  });

  it("keeps pictures, drawings and files attached to an item, and names every file they keep", () => {
    const text = shelfWithAttachments([
      attachedImage(30, {
        pins: [{ label: "Too close", x: 10, y: 20 }],
        scene: { base: pictureAt(32), file: `${uuid(33)}.json` },
      }),
      attachedImage(40, {
        name: "Drawing",
        scene: { base: null, file: `${uuid(42)}.json` },
      }),
      attachedFile(50),
    ]);

    const doc = parseShelfDocument(text);
    const [item] = doc?.items ?? [];

    expect(doc).toStrictEqual(JSON.parse(text));
    expect(item === undefined ? [] : storedFilesOf(item)).toStrictEqual([
      `${uuid(31)}.png`,
      `${uuid(33)}.json`,
      `${uuid(32)}.png`,
      `${uuid(41)}.png`,
      `${uuid(42)}.json`,
      `${uuid(51)}.pdf`,
    ]);
  });

  it(`holds at most ${ATTACHMENTS_MAX}, each id once, and only files the app named`, () => {
    const full = Array.from({ length: ATTACHMENTS_MAX }, (_, at) =>
      attachedFile(30 + at * 2)
    );

    expect(parseShelfDocument(shelfWithAttachments(full))).not.toBeNull();
    expect(
      parseShelfDocument(shelfWithAttachments([...full, attachedFile(80)]))
    ).toBeNull();
    expect(
      parseShelfDocument(
        shelfWithAttachments([attachedFile(30), attachedFile(30)])
      )
    ).toBeNull();
    expect(
      parseShelfDocument(
        shelfWithAttachments([attachedFile(30, "../shelf.json")])
      )
    ).toBeNull();
    expect(
      parseShelfDocument(
        shelfWithAttachments([
          attachedImage(30, { image: { ...pictureAt(31), file: "a.png" } }),
        ])
      )
    ).toBeNull();
  });
});

const fileAt = (n: number) => AttachmentSchema.parse(attachedFile(n));
const imageAt = (n: number) => AttachmentSchema.parse(attachedImage(n));

const idsOf = (doc: ShelfDoc) =>
  doc.items.flatMap((item) => item.attachments.map((a) => a.id));

/** A shelf with one note holding these attachments, and that note's id. */
const noteWith = (attachments: readonly ReturnType<typeof fileAt>[]) => {
  const { doc } = apply(emptyShelf(INBOX), [
    { text: "Chairs", type: "compose" },
  ]);

  const [note] = doc.items;

  if (note === undefined) {
    throw new Error("no note");
  }

  const attached = applyOp(
    doc,
    { attachments, id: note.id, type: "attach" },
    env(),
    []
  ).doc;

  return { doc: attached, id: note.id };
};

describe("attachment operations", () => {
  it(`attaches in order, each id once, up to ${ATTACHMENTS_MAX}, and changes nothing when none fits`, () => {
    const ten = Array.from({ length: 10 }, (_, at) => fileAt(30 + at * 2));
    const { doc, id } = noteWith(ten);
    const [a, b, c] = [fileAt(60), fileAt(62), fileAt(64)];

    const full = applyOp(
      doc,
      { attachments: [a, a, ten[0] ?? a, b, c], id, type: "attach" },
      env(),
      []
    ).doc;

    const again = applyOp(
      full,
      { attachments: [fileAt(66)], id, type: "attach" },
      env(),
      []
    );

    expect(idsOf(full)).toStrictEqual([...ten, a, b].map((x) => x.id));
    expect(ShelfDocSchema.safeParse(full).success).toBeTruthy();
    expect(again.doc).toBe(full);
  });

  it("puts a removed attachment back where it was, once", () => {
    const [a, b, c] = [fileAt(30), imageAt(32), fileAt(34)];
    const { doc, id } = noteWith([a, b, c]);

    const removed = applyOp(
      doc,
      { attachmentId: b.id, id, type: "removeAttachment" },
      env(),
      []
    );

    const back = applyOp(
      removed.doc,
      { attachment: b, id, index: 1, type: "insertAttachment" },
      env(),
      []
    ).doc;

    const twice = applyOp(
      back,
      { attachment: b, id, index: 0, type: "insertAttachment" },
      env(),
      []
    );

    expect({
      back: idsOf(back),
      discarded: removed.discarded,
      removed: idsOf(removed.doc),
      twice: twice.doc,
    }).toStrictEqual({
      back: [a.id, b.id, c.id],
      discarded: [],
      removed: [a.id, c.id],
      twice: back,
    });
  });

  it("brings a deleted item back with its attachments, and discards their files with it past the undo limit", () => {
    const { doc, id } = noteWith([imageAt(30), fileAt(32)]);

    const restored = apply(doc, [
      { id, type: "remove" },
      { type: "undoRemove" },
    ]);

    const pending: Removed[] = Array.from({ length: UNDO_MAX }, () => ({
      index: 0,
      item: doc.items[0] ?? never(),
    }));

    const notes = apply(doc, [{ text: "Other", type: "compose" }]).doc;
    const other = notes.items[1]?.id ?? never();

    const past = applyOp(notes, { id: other, type: "remove" }, env(), pending);

    expect({
      discarded: past.discarded.flatMap(storedFilesOf),
      restored: restored.doc.items[0]?.attachments,
    }).toStrictEqual({
      discarded: [`${uuid(31)}.png`, `${uuid(33)}.pdf`],
      restored: doc.items[0]?.attachments,
    });
    expect(idsOf(restored.doc)).toStrictEqual([uuid(30), uuid(32)]);
  });

  it("replaces an attached picture in place, keeping its name and pins, and lets the old files go", () => {
    const pinned = AttachedImageSchema.parse(
      attachedImage(30, {
        pins: [{ label: "Here", x: 5, y: 5 }],
        scene: { base: pictureAt(32), file: `${uuid(33)}.json` },
      })
    );

    const { doc, id } = noteWith([pinned, fileAt(40)]);

    const replaced = applyOp(
      doc,
      {
        attachmentId: pinned.id,
        id,
        image: pictureAt(34),
        type: "replaceAttachmentImage",
      },
      env(),
      []
    );

    const kept = new Set(replaced.doc.items.flatMap(storedFilesOf));

    expect({
      attachment: replaced.doc.items[0]?.attachments[0],
      goes: replaced.discarded
        .flatMap(storedFilesOf)
        .filter((file) => !kept.has(file)),
    }).toStrictEqual({
      attachment: {
        addedAt: pinned.addedAt,
        id: pinned.id,
        image: pictureAt(34),
        kind: "image",
        name: pinned.name,
        pins: [{ label: "Here", x: 5, y: 5 }],
      },
      goes: [`${uuid(31)}.png`, `${uuid(33)}.json`, `${uuid(32)}.png`],
    });
  });

  it("keeps an attached picture's pins on it, clamped to its size, and leaves files alone", () => {
    const picture = imageAt(30);
    const file = fileAt(32);
    const { doc, id } = noteWith([picture, file]);

    const pinned = apply(doc, [
      {
        attachmentId: picture.id,
        id,
        pins: [{ label: "  Corner  ", x: 5000, y: -3 }],
        type: "setAttachmentPins",
      },
      {
        attachmentId: file.id,
        id,
        pins: [{ x: 1, y: 1 }],
        type: "setAttachmentPins",
      },
    ]).doc;

    expect(pinned.items[0]?.attachments).toStrictEqual([
      { ...picture, pins: [{ label: "Corner", x: 959, y: 0 }] },
      file,
    ]);
  });
});

/** A shelf with a note and a pinned screenshot as an item of its own, and their ids. */
const noteAndPicture = () => {
  const { doc } = apply(emptyShelf(INBOX), [
    { text: "Chairs", type: "compose" },
    {
      context: null,
      image: pictureAt(50),
      pins: [{ label: "Corner", x: 10, y: 20 }],
      source: null,
      type: "addImage",
      via: "screenshot",
    },
  ]);

  const [note, picture] = doc.items;

  if (note === undefined || picture === undefined) {
    throw new Error("no note or no picture");
  }

  return { doc, note: note.id, picture: picture.id };
};

describe("a picture changes what holds it", () => {
  it("makes a picture item another item's last attachment, with its pins and the same file, in one step", () => {
    const { doc, note, picture } = noteAndPicture();
    const tile = imageAt(60).id;

    const moved = applyOp(
      doc,
      {
        attachmentId: tile,
        from: picture,
        id: note,
        name: "Screenshot 2026-11-26 at 10.33.02",
        type: "itemToAttachment",
      },
      env(),
      []
    );

    expect(moved.doc.items).toMatchObject([
      {
        attachments: [
          {
            addedAt: "2026-10-22T10:00:00.000Z",
            id: tile,
            image: pictureAt(50),
            kind: "image",
            name: "Screenshot 2026-11-26 at 10.33.02",
            pins: [{ label: "Corner", x: 10, y: 20 }],
          },
        ],
        id: note,
      },
    ]);
    expect(ShelfDocSchema.safeParse(moved.doc).success).toBeTruthy();
    // Nothing for Undo to bring back, and no file for the cleanup: the picture's file is the attachment's now.
    expect(moved).toMatchObject({ discarded: [], removed: null });
  });

  it("leaves the picture item as it is when the other item is full, gone, or the picture itself", () => {
    const { doc, note, picture } = noteAndPicture();

    const full = applyOp(
      doc,
      {
        attachments: Array.from({ length: ATTACHMENTS_MAX }, (_, at) =>
          fileAt(30 + at * 2)
        ),
        id: note,
        type: "attach",
      },
      env(),
      []
    ).doc;

    const to = (from: ShelfDoc, id: ShelfDoc["items"][number]["id"]) =>
      applyOp(
        from,
        {
          attachmentId: imageAt(60).id,
          from: picture,
          id,
          name: "Screenshot",
          type: "itemToAttachment",
        },
        env(),
        []
      ).doc;

    expect(to(full, note)).toBe(full);
    expect(to(doc, ItemIdSchema.parse(uuid(99)))).toBe(doc);
    expect(to(doc, picture)).toBe(doc);
  });

  it("leaves an item as it is when it is no picture, or has attachments of its own that would be left with no item", () => {
    const { doc, note, picture } = noteAndPicture();

    const holding = applyOp(
      doc,
      { attachments: [fileAt(30)], id: picture, type: "attach" },
      env(),
      []
    ).doc;

    const from = (shelf: ShelfDoc, item: ShelfDoc["items"][number]["id"]) =>
      applyOp(
        shelf,
        {
          attachmentId: imageAt(60).id,
          from: item,
          id: item === note ? picture : note,
          name: "Screenshot",
          type: "itemToAttachment",
        },
        env(),
        []
      ).doc;

    expect(from(holding, picture)).toBe(holding);
    expect(from(doc, note)).toBe(doc);
  });

  it("makes an attached picture an item of its own in the section new items go to, with its pins and the same file", () => {
    const picture = AttachedImageSchema.parse(
      attachedImage(30, { pins: [{ label: "Corner", x: 10, y: 20 }] })
    );

    const { doc, id } = noteWith([picture, fileAt(40)]);

    const moved = applyOp(
      doc,
      {
        attachmentId: picture.id,
        id,
        type: "attachmentToItem",
        via: "screenshot",
      },
      env(),
      []
    );

    expect(moved.doc.items).toMatchObject([
      { attachments: [fileAt(40)], id },
      {
        attachments: [],
        id: moved.addedId,
        image: picture.image,
        kind: "image",
        pins: picture.pins,
        sectionId: INBOX,
        via: "screenshot",
      },
    ]);
    expect(ShelfDocSchema.safeParse(moved.doc).success).toBeTruthy();
    expect(moved).toMatchObject({ discarded: [], removed: null });
  });

  it("leaves an attached file, and an attachment that isn't there, where they are", () => {
    const file = fileAt(30);
    const { doc, id } = noteWith([file]);

    const toItem = (attachmentId: typeof file.id) =>
      applyOp(
        doc,
        { attachmentId, id, type: "attachmentToItem", via: "screenshot" },
        env(),
        []
      );

    expect(toItem(file.id).doc).toBe(doc);
    expect(toItem(imageAt(60).id).doc).toBe(doc);
  });
});

/** A context from Code holding this file and project folder, as the system would report it. */
const codeContext = (file: string, root: string | null) => ({
  app: "Code",
  appLink: null,
  code: { file, line: null, root },
  title: "a.ts — proj",
  url: null,
});

describe("where in the code an item came from", () => {
  it("reads a version 4 shelf saved before it with no place in the code", () => {
    const savedBefore = {
      ...v3,
      items: v3.items.map((item) => ({ ...item, attachments: [] })),
      schemaVersion: 4,
    };

    const doc = parseShelfDocument(JSON.stringify(savedBefore));

    expect(doc?.schemaVersion).toBe(4);
    expect(doc?.items.map((item) => item.context?.code)).toStrictEqual(
      v3.items.map((item) => (item.context === null ? undefined : null))
    );
  });

  it("keeps a file and the project folder it sits in", () => {
    const context = codeContext(
      "/Users/anna/dev/proj/src/a.ts",
      "/Users/anna/dev/proj"
    );

    expect(ContextSchema.parse(context).code).toStrictEqual(context.code);
  });

  it.each([
    ["a folder elsewhere", "/Users/anna/dev/other"],
    ["a folder whose name only starts the same", "/Users/anna/dev/pro"],
    ["the file itself", "/Users/anna/dev/proj/src/a.ts"],
  ])("refuses %s as the project", (_, root) => {
    expect(
      CodePlaceSchema.safeParse(
        codeContext("/Users/anna/dev/proj/src/a.ts", root).code
      ).success
    ).toBeFalsy();
  });

  it("refuses a path longer than the shelf keeps", () => {
    const file = `/${"a".repeat(4096)}`;

    expect(file).toHaveLength(4097);
    expect(
      CodePlaceSchema.safeParse(codeContext(file, null).code).success
    ).toBeFalsy();
  });

  it.each([
    ["a file that is no whole path", "src/a.ts", null],
    [
      "a file that steps out of its project",
      "/Users/anna/dev/proj/../other/a.ts",
      "/Users/anna/dev/proj",
    ],
    ["a file with a dot step", "/Users/anna/dev/proj/./a.ts", null],
  ])("refuses %s", (_, file, root) => {
    expect(
      CodePlaceSchema.safeParse(codeContext(file, root).code).success
    ).toBeFalsy();
  });

  it("reads an item whose place in the code is odd without that place, never without the item", () => {
    const context = codeContext("src/a.ts", "/Users/anna/dev/other");

    expect(ContextSchema.parse(context)).toStrictEqual({
      ...context,
      code: null,
    });
  });
});

/** Whether the shelf's first item still holds the words it was captured with. */
const asCaptured = (doc: ShelfDoc): boolean => {
  const [item] = doc.items;
  const place = item?.context?.code ?? null;

  return (
    item?.kind === "text" && place !== null && isCapturedText(place, item.text)
  );
};

describe("a capture's words, known again when its file is opened", () => {
  const file = "/Users/anna/dev/proj/src/a.ts";
  const start = emptyShelf(INBOX);
  // The first id env() gives.
  const id = ItemIdSchema.parse(uuid(11));

  const captured = (text: string): MainOp => ({
    context: codeContext(file, "/Users/anna/dev/proj"),
    html: null,
    text,
    type: "addText",
    via: "selection",
  });

  it("knows a capture's words for its own, in the one step that adds it", () => {
    const { doc } = apply(start, [captured("retry();")]);

    expect(asCaptured(doc)).toBeTruthy();
    expect(doc.items[0]?.context?.code).toMatchObject({ file, line: null });
  });

  it("no longer does once the words are edited, and does again when the edit is taken back", () => {
    const edited = apply(start, [
      captured("retry();"),
      { id, text: "other();", type: "editText" },
    ]);

    expect(asCaptured(edited.doc)).toBeFalsy();
    expect(
      asCaptured(
        applyOp(
          edited.doc,
          { id, text: "retry();", type: "editText" },
          env(),
          edited.pending
        ).doc
      )
    ).toBeTruthy();
  });

  it("knows a capture's words when they are as long as the shelf keeps", () => {
    const { doc } = apply(start, [captured("a".repeat(TEXT_MAX))]);

    expect(asCaptured(doc)).toBeTruthy();
  });

  it("knows no words for a capture longer than the shelf keeps, so a click looks for no line", () => {
    // The words kept are only the selection's start: the whole of it may be nowhere in the file.
    const { doc } = apply(start, [captured("a".repeat(TEXT_MAX + 5))]);

    expect(asCaptured(doc)).toBeFalsy();
    expect(doc.items[0]?.context?.code).toMatchObject({ file, line: null });
  });

  it("keeps nothing of the words but a mark that survives the shelf's own file", () => {
    const { doc } = apply(start, [captured("retry();")]);
    const read = ShelfDocSchema.parse(structuredClone(doc));

    expect(asCaptured(read)).toBeTruthy();
    expect(JSON.stringify(read.items[0]?.context)).not.toContain("retry");
  });

  it("knows no words for an item saved before the mark, or with one that reads odd", () => {
    const { doc } = apply(start, [captured("retry();")]);

    const without = (mark: string | number | undefined): ShelfDoc =>
      ShelfDocSchema.parse({
        ...doc,
        items: doc.items.map((item) => ({
          ...item,
          context: {
            ...item.context,
            code: { file, line: null, mark, root: "/Users/anna/dev/proj" },
          },
        })),
      });

    expect(asCaptured(without(undefined))).toBeFalsy();
    expect(asCaptured(without("../../etc"))).toBeFalsy();
    expect(without(42).items[0]?.context?.code).toMatchObject({ file });
  });
});

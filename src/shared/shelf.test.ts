import { describe, expect, it } from "vitest";

import {
  applyOp,
  groupItems,
  itemsAsList,
  itemTextWithLink,
  parseShelfDocument,
  emptyShelf,
  ItemIdSchema,
  parseComposer,
  SectionIdSchema,
  ShelfDocSchema,
  UNDO_MAX,
} from "./shelf";
import type { OpEnv, ShelfDoc, ShelfOp, MainOp, Removed } from "./shelf";

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
        pin: { x: 480, y: 300 },
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
      pin: { x: 480, y: 300 },
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
        pin: { x: 480, y: 300 },
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
      pin: { x: 480, y: 300 },
    });
    expect(result.discarded).toStrictEqual([first]);
    expect(
      applyOp(doc, { id: first.id, image, type: "replaceImage" }, env(), []).doc
    ).toBe(doc);
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

    expect(doc?.schemaVersion).toBe(2);
    expect(doc?.items).toMatchObject([
      {
        color: null,
        context: null,
        id: uuid(20),
        text: "Building this little habit app\n",
      },
      {
        color: null,
        context: null,
        done: true,
        id: uuid(21),
        pin: { x: 480, y: 300 },
      },
    ]);
    expect(ShelfDocSchema.safeParse(doc).success).toBeTruthy();
  });

  it("reads the current format as is and rejects anything else", () => {
    const current = emptyShelf(INBOX);

    expect(parseShelfDocument(JSON.stringify(current))).toStrictEqual(current);
    expect(
      parseShelfDocument(JSON.stringify({ ...firstFormat, schemaVersion: 3 }))
    ).toBeNull();
    expect(parseShelfDocument("{ not a shelf")).toBeNull();
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

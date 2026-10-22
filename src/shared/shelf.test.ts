import { describe, expect, it } from "vitest";

import {
  applyOp,
  groupItems,
  emptyShelf,
  ItemIdSchema,
  parseComposer,
  SectionIdSchema,
  ShelfDocSchema,
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
  readonly removed: Removed | null;
  readonly discarded: number;
}

const apply = (
  doc: ShelfDoc,
  ops: readonly (ShelfOp | MainOp)[],
  e = env()
): Applied => {
  let current = doc;
  let removed: Removed | null = null;
  let discarded = 0;

  for (const op of ops) {
    const result = applyOp(current, op, e, removed);

    current = result.doc;
    discarded += result.discarded.length;
    removed = op.type === "undoRemove" ? null : (result.removed ?? removed);
  }

  return { discarded, doc: current, removed };
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

  it("removes with one undo and discards the previous removal on the next one", () => {
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
    ]);

    expect(twice.discarded).toBe(1);
    expect(twice.doc.items).toHaveLength(1);
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
      apply(start, [{ text: "   ", type: "addText", via: "selection" }]).doc
        .items
    ).toHaveLength(0);
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

  it("lists sections with items in order and the active one even when empty", () => {
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

import { describe, expect, it } from "vitest";

import {
  applyOp,
  attachmentsOf,
  detailLines,
  emptyShelf,
  groupItems,
  hasDetails,
  ItemIdSchema,
  itemDetailsText,
  itemsAsList,
  itemTextWithLink,
  parseComposer,
  parseShelfDocument,
  SectionIdSchema,
  ShelfDocSchema,
  WindowIdSchema,
} from "./shelf";
import type { OpEnv, ShelfDoc, ShelfItem, WindowRef } from "./shelf";

const uuid = (n: number) =>
  `3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1b${String(n).padStart(2, "0")}`;

const INBOX = SectionIdSchema.parse(uuid(1));

const env = (): OpEnv => {
  let next = 10;

  return {
    newItemId: () => ItemIdSchema.parse(uuid((next += 1))),
    newSectionId: () => SectionIdSchema.parse(uuid((next += 1))),
    now: () => new Date("2026-11-05T10:00:00.000Z"),
  };
};

const IMAGE = {
  file: `${uuid(50)}.png`,
  heightPx: 600,
  pixelsPerDip: 2,
  widthPx: 960,
};

const windowRef = (n: number, url: string | null = null): WindowRef => ({
  app: "Safari",
  appPath: "/Applications/Safari.app",
  capturedAt: "2026-11-05T10:00:00.000Z",
  description: "",
  document: null,
  id: WindowIdSchema.parse(uuid(n)),
  thumb: { ...IMAGE, file: `${uuid(n)}.png` },
  title: `Window ${n}`,
  url,
});

/** A shelf with one note and one image, built through the same operations the app uses. */
interface Sample {
  readonly doc: ShelfDoc;
  readonly note: ShelfItem;
  readonly image: ShelfItem;
}

const withItems = (): Sample => {
  const e = env();

  const { doc: withNote } = applyOp(
    emptyShelf(INBOX),
    {
      context: {
        app: "Chrome",
        appLink: null,
        title: "Quote",
        url: "https://example.com/quote",
      },
      html: null,
      text: "Chairs are over budget",
      type: "addText",
      via: "selection",
    },
    e,
    []
  );

  const { doc } = applyOp(
    withNote,
    {
      context: null,
      image: IMAGE,
      pins: [],
      source: null,
      type: "addImage",
      via: "screenshot",
    },
    e,
    []
  );

  const [note, image] = doc.items;

  if (note === undefined || image === undefined) {
    throw new Error("missing items");
  }

  return { doc, image, note };
};

describe("migration to version 3", () => {
  const secondFormat = {
    activeSectionId: uuid(1),
    items: [
      {
        color: "blue",
        context: null,
        createdAt: "2026-10-22T17:40:00.000Z",
        done: false,
        id: uuid(21),
        image: IMAGE,
        kind: "image",
        note: "The button",
        pin: { x: 480, y: 300 },
        sectionId: uuid(1),
        source: "Built-in Retina Display",
        via: "pin",
      },
      {
        color: null,
        context: null,
        createdAt: "2026-10-22T17:41:00.000Z",
        done: true,
        id: uuid(22),
        image: IMAGE,
        kind: "image",
        note: "",
        pin: null,
        sectionId: uuid(1),
        source: null,
        via: "area",
      },
      {
        color: null,
        context: null,
        createdAt: "2026-10-22T17:42:00.000Z",
        done: false,
        file: { bytes: 12, name: "notes.txt", stored: `${uuid(60)}.txt` },
        id: uuid(23),
        kind: "file",
        note: "read later",
        sectionId: uuid(1),
      },
    ],
    schemaVersion: 2,
    sections: [{ id: uuid(1), name: "Inbox" }],
  };

  it("turns one pin into pin 1, no pin into none, and keeps every field", () => {
    const doc = parseShelfDocument(JSON.stringify(secondFormat));

    expect(doc?.schemaVersion).toBe(3);
    expect(doc?.items).toMatchObject([
      {
        color: "blue",
        description: "",
        due: null,
        note: "The button",
        pins: [{ x: 480, y: 300 }],
        source: "Built-in Retina Display",
        steps: [],
        title: null,
        windows: [],
      },
      { done: true, pins: [] },
      { file: { name: "notes.txt" }, note: "read later", title: null },
    ]);
    expect(doc?.items[0]).not.toHaveProperty("pin");
    expect(ShelfDocSchema.safeParse(doc).success).toBeTruthy();
  });

  it("reads its own output back unchanged", () => {
    const doc = parseShelfDocument(JSON.stringify(secondFormat));
    const again = parseShelfDocument(JSON.stringify(doc));

    expect(again).toStrictEqual(doc);
  });
});

describe("metadata operations", () => {
  it("sets and clears a title on images and files only", () => {
    const { doc, image, note } = withItems();

    const titled = applyOp(
      doc,
      { id: image.id, title: "  Login screen ", type: "setTitle" },
      env(),
      []
    ).doc;

    expect(titled.items[1]).toMatchObject({ title: "Login screen" });
    expect(
      applyOp(titled, { id: image.id, title: " ", type: "setTitle" }, env(), [])
        .doc.items[1]
    ).toMatchObject({ title: null });
    expect(
      applyOp(doc, { id: note.id, title: "x", type: "setTitle" }, env(), []).doc
        .items[0]
    ).not.toHaveProperty("title");
  });

  it("ticks one step and keeps the rest", () => {
    const { doc, note } = withItems();

    const steps = [
      { done: false, id: uuid(80), text: "Ask Rieder" },
      { done: false, id: uuid(81), text: "Second quote" },
    ];

    const next = applyOp(
      applyOp(doc, { id: note.id, steps, type: "setSteps" }, env(), []).doc,
      { id: note.id, stepId: uuid(81), type: "toggleStep" },
      env(),
      []
    ).doc;

    expect(next.items[0]?.steps.map((step) => step.done)).toStrictEqual([
      false,
      true,
    ]);
  });

  it("keeps pins on the image and drops empty labels", () => {
    const { doc, image } = withItems();

    const next = applyOp(
      doc,
      {
        id: image.id,
        pins: [
          { label: " Save ", x: 10, y: 10 },
          { label: "", x: 5000, y: -0 },
        ],
        type: "setPins",
      },
      env(),
      []
    ).doc;

    expect(next.items[1]).toMatchObject({
      pins: [
        { label: "Save", x: 10, y: 10 },
        { x: 959, y: 0 },
      ],
    });
    expect(next.items[1]).not.toHaveProperty("pins.1.label");
  });

  it("moves, describes and removes linked windows by id", () => {
    const { doc, note } = withItems();
    const [a, b, c] = [windowRef(30), windowRef(31), windowRef(32)];

    let next = applyOp(
      doc,
      { id: note.id, type: "attachWindows", windows: [a, b, c] },
      env(),
      []
    ).doc;

    next = applyOp(
      next,
      { id: note.id, index: 0, type: "moveWindow", windowId: c.id },
      env(),
      []
    ).doc;
    next = applyOp(
      next,
      {
        description: "the total",
        id: note.id,
        type: "describeWindow",
        windowId: a.id,
      },
      env(),
      []
    ).doc;
    next = applyOp(
      next,
      { id: note.id, type: "removeWindow", windowId: b.id },
      env(),
      []
    ).doc;

    expect(next.items[0]?.windows.map((window) => window.id)).toStrictEqual([
      c.id,
      a.id,
    ]);
    expect(next.items[0]?.windows[1]?.description).toBe("the total");

    const restored = applyOp(
      next,
      { id: note.id, index: 1, type: "insertWindow", window: b },
      env(),
      []
    ).doc;

    expect(restored.items[0]?.windows.map((window) => window.id)).toStrictEqual(
      [c.id, b.id, a.id]
    );
  });

  it("names the windows' pictures among an item's files, but an annotation discards only the old image", () => {
    const { doc, image } = withItems();

    const linked = applyOp(
      doc,
      { id: image.id, type: "attachWindows", windows: [windowRef(33)] },
      env(),
      []
    ).doc;

    const [, item] = linked.items;

    if (item === undefined) {
      throw new Error("missing item");
    }

    expect(attachmentsOf(item)).toStrictEqual([IMAGE.file, `${uuid(33)}.png`]);

    const replaced = applyOp(
      linked,
      {
        id: image.id,
        image: { ...IMAGE, file: `${uuid(51)}.png` },
        type: "replaceImage",
      },
      env(),
      []
    );

    expect(replaced.discarded.flatMap(attachmentsOf)).toStrictEqual([
      IMAGE.file,
    ]);
  });
});

describe("search", () => {
  const now = new Date(2026, 10, 5, 12);

  it("finds descriptions, steps, window titles and pin labels", () => {
    const { doc, image, note } = withItems();

    let next = applyOp(
      doc,
      { description: "Marco signs off", id: note.id, type: "setDescription" },
      env(),
      []
    ).doc;

    next = applyOp(
      next,
      {
        id: note.id,
        steps: [{ done: false, id: uuid(80), text: "Call Rieder" }],
        type: "setSteps",
      },
      env(),
      []
    ).doc;
    next = applyOp(
      next,
      {
        id: image.id,
        pins: [{ label: "Totals", x: 1, y: 1 }],
        type: "setPins",
      },
      env(),
      []
    ).doc;
    next = applyOp(
      next,
      { id: image.id, type: "attachWindows", windows: [windowRef(34)] },
      env(),
      []
    ).doc;

    const found = (query: string) =>
      groupItems(next, query, now).flatMap((group) =>
        group.items.map((item) => item.id)
      );

    expect(found("marco")).toStrictEqual([note.id]);
    expect(found("rieder")).toStrictEqual([note.id]);
    expect(found("totals")).toStrictEqual([image.id]);
    expect(found("window 34")).toStrictEqual([image.id]);
  });

  it("filters by due day and hides sections without a match", () => {
    const { doc, note } = withItems();

    const next = applyOp(
      doc,
      { due: "2026-11-05", id: note.id, type: "setDue" },
      env(),
      []
    ).doc;

    const found = (query: string) =>
      groupItems(next, query, now).flatMap((group) =>
        group.items.map((item) => item.id)
      );

    expect(found("due:today")).toStrictEqual([note.id]);
    expect(found("due:overdue")).toStrictEqual([]);
    expect(groupItems(next, "due:overdue", now)).toStrictEqual([]);
    expect(found("due:week chairs")).toStrictEqual([note.id]);
  });
});

describe("copying", () => {
  it("copies an item without metadata exactly as before", () => {
    const { doc, image, note } = withItems();

    expect(hasDetails(note)).toBeFalsy();
    expect(itemTextWithLink(note)).toBe(
      "Chairs are over budget\nhttps://example.com/quote"
    );
    expect(itemsAsList(doc.items).text).toBe(
      "1. Chairs are over budget (https://example.com/quote)"
    );
    expect(itemsAsList(doc.items).html).toBe(
      '<ol><li>Chairs are over budget (<a href="https://example.com/quote">https://example.com/quote</a>)</li></ol>'
    );
    expect(itemDetailsText(image)).toBe("Image");
  });

  it("adds the description, steps, due day and windows", () => {
    const { doc, note } = withItems();

    let next = applyOp(
      doc,
      { description: "Marco signs off", id: note.id, type: "setDescription" },
      env(),
      []
    ).doc;

    next = applyOp(
      next,
      {
        id: note.id,
        steps: [
          { done: true, id: uuid(80), text: "Ask Rieder" },
          { done: false, id: uuid(81), text: "Second quote" },
        ],
        type: "setSteps",
      },
      env(),
      []
    ).doc;
    next = applyOp(
      next,
      { due: "2026-11-07", id: note.id, type: "setDue" },
      env(),
      []
    ).doc;
    next = applyOp(
      next,
      {
        id: note.id,
        type: "attachWindows",
        windows: [windowRef(35, "https://rieder.ch/quote")],
      },
      env(),
      []
    ).doc;

    const [item] = next.items;

    if (item === undefined) {
      throw new Error("missing item");
    }

    expect(detailLines(item)).toStrictEqual([
      "Marco signs off",
      "- [x] Ask Rieder",
      "- [ ] Second quote",
      "Due: 2026-11-07",
      "Windows:",
      "- Window 35 — https://rieder.ch/quote",
    ]);
    expect(itemTextWithLink(item)).toBe(
      "Chairs are over budget\nhttps://example.com/quote\n\nMarco signs off\n- [x] Ask Rieder\n- [ ] Second quote\nDue: 2026-11-07\nWindows:\n- Window 35 — https://rieder.ch/quote"
    );
    expect(itemsAsList([item]).text).toBe(
      "1. Chairs are over budget (https://example.com/quote)\n   Marco signs off\n   - [x] Ask Rieder\n   - [ ] Second quote\n   Due: 2026-11-07\n   Windows:\n   - Window 35 — https://rieder.ch/quote"
    );
  });

  it("copies an image's title, and its labelled pins, even without other metadata", () => {
    const { doc, image } = withItems();

    const { doc: titled } = applyOp(
      doc,
      { id: image.id, title: "Login screen", type: "setTitle" },
      env(),
      []
    );

    const { doc: pinned } = applyOp(
      titled,
      {
        id: image.id,
        pins: [
          { label: "Title too close", x: 1, y: 1 },
          { x: 2, y: 2 },
        ],
        type: "setPins",
      },
      env(),
      []
    );

    const [, item] = pinned.items;

    if (item === undefined) {
      throw new Error("missing item");
    }

    expect(itemsAsList([item]).text).toBe(
      "1. Login screen\n   1 · Title too close"
    );
    expect(itemDetailsText(item)).toBe("Login screen\n\n1 · Title too close");
  });

  it("adds each window's description and the source with Copy with Details", () => {
    const { doc, note } = withItems();

    const { doc: next } = applyOp(
      doc,
      {
        id: note.id,
        type: "attachWindows",
        windows: [{ ...windowRef(36), description: "the total row" }],
      },
      env(),
      []
    );

    const [item] = next.items;

    if (item === undefined) {
      throw new Error("missing item");
    }

    expect(itemDetailsText(item)).toBe(
      "Chairs are over budget\nhttps://example.com/quote\n\nWindows:\n- Window 36\n  the total row\nFrom: Chrome · Quote"
    );
  });
});

describe("the # section composer", () => {
  it("reads the escaped heading the composer now writes as a section", () => {
    expect(parseComposer("\\# Prompts")).toStrictEqual({
      kind: "section",
      name: "Prompts",
    });
    expect(parseComposer("# Prompts")).toStrictEqual({
      kind: "section",
      name: "Prompts",
    });
  });
});

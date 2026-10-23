import { describe, expect, it } from "vitest";

import { itemMenu, sectionMenu } from "./menus";
import type { MenuEntry } from "./menus";
import { emptyShelf, ItemIdSchema, SectionIdSchema } from "./shelf";
import type { ImageItem, ShelfDoc } from "./shelf";

const uuid = (n: number) =>
  `3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1b${String(n).padStart(2, "0")}`;

const INBOX = SectionIdSchema.parse(uuid(1));
const LATER = SectionIdSchema.parse(uuid(2));

const labels = (entries: readonly MenuEntry[]): string[] =>
  entries.map((entry) => (entry.kind === "separator" ? "---" : entry.label));

const doc: ShelfDoc = {
  ...emptyShelf(INBOX),
  items: [
    {
      color: null,
      context: null,
      createdAt: "2026-10-22T10:00:00.000Z",
      done: true,
      id: ItemIdSchema.parse(uuid(10)),
      kind: "text",
      sectionId: INBOX,
      text: "done here",
      via: "typed",
    },
  ],
  sections: [
    { id: INBOX, name: "Inbox" },
    { id: LATER, name: "Later" },
  ],
};

const image: ImageItem = {
  color: "blue",
  context: null,
  createdAt: "2026-10-22T10:00:00.000Z",
  done: false,
  id: ItemIdSchema.parse(uuid(11)),
  image: {
    file: `${uuid(50)}.png`,
    heightPx: 300,
    pixelsPerDip: 1,
    widthPx: 480,
  },
  kind: "image",
  note: "",
  pin: null,
  sectionId: INBOX,
  source: null,
  via: "area",
};

describe(sectionMenu, () => {
  it("checks the current section and offers the section actions and Settings", () => {
    const entries = sectionMenu(doc);

    expect(labels(entries)).toStrictEqual([
      "Inbox",
      "Later",
      "---",
      "New Section…",
      "Clear Checked Items",
      "---",
      "Settings…",
    ]);
    expect(entries[0]).toMatchObject({ checked: true });
    expect(entries[1]).toMatchObject({ checked: false });
  });

  it("disables clearing when nothing here is checked", () => {
    expect(
      sectionMenu({ ...doc, activeSectionId: LATER }).find(
        (entry) => entry.kind === "choice" && entry.label.startsWith("Clear")
      )
    ).toMatchObject({ enabled: false });
  });
});

describe(itemMenu, () => {
  it("names the actions for the item's kind and state", () => {
    const [item] = doc.items;

    if (item === undefined) {
      throw new Error("missing item");
    }

    expect(labels(itemMenu(item, doc))).toStrictEqual([
      "Copy",
      "Edit",
      "Mark as Not Done",
      "---",
      "Move to",
      "---",
      "Colour",
      "---",
      "Delete",
    ]);
    expect(itemMenu(item, doc)[4]).toMatchObject({
      entries: [
        { choice: { kind: "moveTo", sectionId: LATER }, label: "Later" },
      ],
      kind: "group",
    });
  });

  it("lets an image be opened and shows its colour in the swatch row", () => {
    const entries = itemMenu(image, { ...doc, items: [image] });

    expect(labels(entries).slice(0, 3)).toStrictEqual([
      "Copy",
      "View and Annotate…",
      "Edit Note",
    ]);
    expect(entries.find((entry) => entry.kind === "colors")).toStrictEqual({
      current: "blue",
      id: image.id,
      kind: "colors",
      label: "Colour",
    });
  });
});

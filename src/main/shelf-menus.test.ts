import { emptyShelf, ItemIdSchema, SectionIdSchema } from "@shared/shelf";
import type { ShelfDoc } from "@shared/shelf";
import { describe, expect, it } from "vitest";

import { itemMenu, sectionMenu } from "./shelf-menus";
import type { MenuEntry } from "./shelf-menus";

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

describe(sectionMenu, () => {
  it("checks the current section and offers the section actions", () => {
    const entries = sectionMenu(doc);

    expect(labels(entries)).toStrictEqual([
      "Inbox",
      "Later",
      "---",
      "New Section…",
      "Clear Checked Items",
    ]);
    expect(entries[0]).toMatchObject({ checked: true });
    expect(entries[1]).toMatchObject({ checked: false });
  });

  it("disables clearing when nothing here is checked", () => {
    expect(
      sectionMenu({ ...doc, activeSectionId: LATER }).at(-1)
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
      "Move to",
      "---",
      "Delete",
    ]);
    expect(itemMenu(item, doc)[3]).toMatchObject({
      entries: [
        { choice: { kind: "moveTo", sectionId: LATER }, label: "Later" },
      ],
      kind: "submenu",
    });
  });
});

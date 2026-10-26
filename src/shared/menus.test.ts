import { describe, expect, it } from "vitest";

import { itemMenu, pickedMenu, sectionMenu, shelfMenu } from "./menus";
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
      html: null,
      kind: "text",
      links: [],
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

describe(shelfMenu, () => {
  it("starts a section and opens Settings, without listing the sections", () => {
    expect(labels(shelfMenu())).toStrictEqual([
      "New Section",
      "---",
      "Settings",
    ]);
  });

  it("holds Float on Top and Help where there is no menu bar", () => {
    const entries = shelfMenu({ floatOnTop: true });

    expect(labels(entries)).toStrictEqual([
      "New Section",
      "---",
      "Float on Top",
      "---",
      "Settings",
      "Inset Shelf Help",
    ]);
    expect(entries[2]).toMatchObject({
      checked: true,
      choice: { kind: "setFloatOnTop", on: false },
    });
  });
});

describe(sectionMenu, () => {
  const [inbox, later] = doc.sections;

  if (inbox === undefined || later === undefined) {
    throw new Error("missing fixture");
  }

  it("offers new items here, renaming, clearing and deleting", () => {
    expect(labels(sectionMenu(later, doc))).toStrictEqual([
      "Add Items Here",
      "Rename",
      "Clear Checked",
      "---",
      "Delete Section",
    ]);
  });

  it("leaves out new items here for the section that already takes them", () => {
    expect(labels(sectionMenu(inbox, doc))[0]).toBe("Rename");
  });

  it("marks deleting in red", () => {
    expect(sectionMenu(later, doc).at(-1)).toMatchObject({
      destructive: true,
    });
  });

  it("clears only a section with checked items", () => {
    const clear = (section: typeof inbox) =>
      sectionMenu(section, doc).find(
        (entry) => entry.kind === "choice" && entry.label.startsWith("Clear")
      );

    expect(clear(inbox)).toMatchObject({ enabled: true });
    expect(clear(later)).toMatchObject({ enabled: false });
  });

  it("keeps the last section", () => {
    expect(
      sectionMenu(inbox, { ...doc, sections: [inbox] }).at(-1)
    ).toMatchObject({ enabled: false, label: "Delete Section" });
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
      "---",
      "Edit",
      "Uncheck",
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

    expect(labels(entries).slice(0, 4)).toStrictEqual([
      "Copy",
      "---",
      "Annotate",
      "Edit Note",
    ]);
    expect(entries.find((entry) => entry.kind === "colors")).toStrictEqual({
      current: "blue",
      id: image.id,
      kind: "colors",
      label: "Colour",
    });
  });

  it("opens a text item where it came from: its desktop app, else its page", () => {
    const [item] = doc.items;

    if (item?.kind !== "text") {
      throw new Error("missing item");
    }

    const from = (app: string, url: string | null) =>
      itemMenu(
        { ...item, context: { app, appLink: null, title: "Chat", url } },
        doc
      ).find(
        (entry) => entry.kind === "choice" && entry.choice.kind === "openSource"
      );

    expect(from("ChatGPT", null)).toMatchObject({
      accelerator: "CommandOrControl+O",
      label: "Open in ChatGPT",
    });
    expect(from("Zen", "https://example.com/")).toMatchObject({
      label: "Open Page",
    });
    expect(from("Zen", null)).toBeUndefined();
  });

  it("offers a desktop app elsewhere than macOS only with a link to open at", () => {
    const [item] = doc.items;

    if (item?.kind !== "text") {
      throw new Error("missing item");
    }

    const label = (
      app: string,
      url: string | null,
      appLink: string | null = null
    ) =>
      itemMenu(
        { ...item, context: { app, appLink, title: "Chat", url } },
        doc,
        false
      ).find(
        (entry) => entry.kind === "choice" && entry.choice.kind === "openSource"
      );

    expect(label("Slack", null)).toBeUndefined();
    expect(label("Slack", "https://acme.slack.com/archives/C1")).toMatchObject({
      label: "Open Page",
    });
    expect(
      label(
        "Claude",
        "https://claude.ai/chat/3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1b01"
      )
    ).toMatchObject({ label: "Open in Claude" });
    expect(
      label(
        "T3 Code",
        null,
        "t3code://threads/local/3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1b01"
      )
    ).toMatchObject({ label: "Open in T3 Code" });
  });
});

describe(pickedMenu, () => {
  it("acts on all picked items at once", () => {
    const entries = pickedMenu([...doc.items, image], {
      ...doc,
      items: [...doc.items, image],
    });

    expect(labels(entries)).toStrictEqual([
      "Copy as List",
      "---",
      "Check Off All",
      "Move to",
      "---",
      "Delete 2 Items",
    ]);
    expect(entries[0]).toMatchObject({
      choice: { ids: [doc.items[0]?.id, image.id], kind: "copyList" },
    });
  });
});

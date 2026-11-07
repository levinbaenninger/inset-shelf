import { describe, expect, it } from "vitest";

import {
  isAppChord,
  itemMenu,
  menuChoiceForKey,
  pickedMenu,
  sectionMenu,
  shelfMenu,
} from "./menus";
import type { MenuEntry, MenuKeyPress } from "./menus";
import { emptyShelf, ItemIdSchema, SectionIdSchema, NO_META } from "./shelf";
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
      ...NO_META,
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
  ...NO_META,
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
  pins: [],
  sectionId: INBOX,
  source: null,
  title: null,
  via: "area",
};

describe(shelfMenu, () => {
  it("starts a section and opens Settings, without listing the sections", () => {
    expect(labels(shelfMenu())).toStrictEqual([
      "New Section",
      "New Window Link…",
      "---",
      "Settings",
      "Keyboard Shortcuts",
    ]);
  });

  it("holds Float on Top and Help where there is no menu bar", () => {
    const entries = shelfMenu({ floatOnTop: true });

    expect(labels(entries)).toStrictEqual([
      "New Section",
      "New Window Link…",
      "---",
      "Float on Top",
      "---",
      "Settings",
      "Keyboard Shortcuts",
      "Inset Shelf Help",
    ]);
    expect(entries[3]).toMatchObject({
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
      "Details",
      "Edit",
      "Uncheck",
      "Move to",
      "---",
      "Colour",
      "---",
      "Delete",
    ]);
    expect(itemMenu(item, doc)[5]).toMatchObject({
      entries: [
        { choice: { kind: "moveTo", sectionId: LATER }, label: "Later" },
      ],
      kind: "group",
    });
  });

  it("lets an image be opened and shows its colour in the swatch row", () => {
    const entries = itemMenu(image, { ...doc, items: [image] });

    expect(labels(entries).slice(0, 5)).toStrictEqual([
      "Copy",
      "---",
      "Details",
      "Annotate",
      "Edit Caption",
    ]);
    expect(entries.find((entry) => entry.kind === "colors")).toStrictEqual({
      current: "blue",
      id: image.id,
      kind: "colors",
      label: "Colour",
    });
  });

  it("offers Details on the row, not in the details the item is open in", () => {
    const [item] = doc.items;

    if (item === undefined) {
      throw new Error("missing item");
    }

    expect(labels(itemMenu(item, doc, true, "row")).slice(0, 4)).toStrictEqual([
      "Copy",
      "---",
      "Details",
      "Edit",
    ]);
    expect(
      labels(itemMenu(item, doc, true, "details")).slice(0, 4)
    ).toStrictEqual(["Copy", "---", "Edit", "Uncheck"]);
  });

  it("offers Copy with Details only for an item that has some", () => {
    const [item] = doc.items;

    if (item === undefined) {
      throw new Error("missing item");
    }

    const withSteps = {
      ...item,
      steps: [{ done: false, id: uuid(70), text: "Reply" }],
    };

    expect(labels(itemMenu(item, doc))).not.toContain("Copy with Details");
    expect(labels(itemMenu(withSteps, doc)).slice(0, 2)).toStrictEqual([
      "Copy",
      "Copy with Details",
    ]);
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

const press = (
  key: string,
  modifiers: Partial<MenuKeyPress> = {}
): MenuKeyPress => ({
  altKey: false,
  code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
  ctrlKey: false,
  metaKey: false,
  repeat: false,
  shiftKey: false,
  ...modifiers,
  key,
});

describe(menuChoiceForKey, () => {
  const described: ImageItem = { ...image, description: "Three problems" };
  const shelf = { ...doc, items: [...doc.items, described] };
  const menu = itemMenu(described, shelf);
  const { id } = described;

  it("runs the entry that shows the key, on the menu's own item", () => {
    expect(
      menuChoiceForKey(menu, press("c", { metaKey: true }), true)
    ).toStrictEqual({
      id,
      kind: "copy",
    });
    expect(menuChoiceForKey(menu, press("ArrowRight"), true)).toStrictEqual({
      id,
      kind: "details",
    });
    expect(
      menuChoiceForKey(menu, press("o", { metaKey: true }), true)
    ).toStrictEqual({
      id,
      kind: "open",
    });
  });

  it("reads ⌥⌘C by its physical key when ⌥ changes the character on a Mac", () => {
    expect(
      menuChoiceForKey(
        menu,
        { ...press("ç", { altKey: true, metaKey: true }), code: "KeyC" },
        true
      )
    ).toStrictEqual({ id, kind: "copyDetails" });
  });

  it("takes Delete as ⌫, as the list does", () => {
    expect(menuChoiceForKey(menu, press("Delete"), true)).toStrictEqual({
      id,
      kind: "remove",
    });
    expect(menuChoiceForKey(menu, press("Backspace"), true)).toStrictEqual({
      id,
      kind: "remove",
    });
  });

  it("uses Ctrl elsewhere than macOS, and not on a Mac", () => {
    expect(
      menuChoiceForKey(menu, press("c", { ctrlKey: true }), false)
    ).toStrictEqual({
      id,
      kind: "copy",
    });
    expect(
      menuChoiceForKey(menu, press("c", { ctrlKey: true }), true)
    ).toBeNull();
    expect(
      menuChoiceForKey(menu, press("c", { metaKey: true }), false)
    ).toBeNull();
  });

  it("leaves Return, Space and the arrows to the menu, and acts once on a held key", () => {
    expect(menuChoiceForKey(menu, press("Enter"), true)).toBeNull();
    expect(menuChoiceForKey(menu, press(" "), true)).toBeNull();
    expect(menuChoiceForKey(menu, press("ArrowDown"), true)).toBeNull();
    expect(menuChoiceForKey(menu, press("Escape"), true)).toBeNull();
    expect(
      menuChoiceForKey(menu, press("Backspace", { repeat: true }), true)
    ).toBeNull();
  });

  it("needs exactly the modifiers shown", () => {
    expect(
      menuChoiceForKey(
        menu,
        press("c", { metaKey: true, shiftKey: true }),
        true
      )
    ).toBeNull();
    expect(menuChoiceForKey(menu, press("c"), true)).toBeNull();
  });

  it("ignores a key its menu doesn't show", () => {
    const plain = { ...image, id: ItemIdSchema.parse(uuid(12)) };

    expect(
      menuChoiceForKey(
        itemMenu(plain, { ...doc, items: [plain] }),
        press("c", { altKey: true, metaKey: true }),
        true
      )
    ).toBeNull();
  });

  it("deletes every picked item with ⌫, and leaves Space to the highlighted entry", () => {
    const items = [...doc.items, image];
    const picked = pickedMenu(items, { ...doc, items });
    const ids = [doc.items[0]?.id, image.id];

    expect(menuChoiceForKey(picked, press(" "), true)).toBeNull();
    expect(menuChoiceForKey(picked, press("Backspace"), false)).toStrictEqual({
      ids,
      kind: "removeMany",
    });
  });

  it("copies every picked item as a list with ⇧⌘C", () => {
    const items = [...doc.items, image];

    expect(
      menuChoiceForKey(
        pickedMenu(items, { ...doc, items }),
        press("c", { metaKey: true, shiftKey: true }),
        true
      )
    ).toStrictEqual({ ids: [doc.items[0]?.id, image.id], kind: "copyList" });
  });
});

describe(isAppChord, () => {
  it("takes every key held with ⌘ on a Mac, and with Ctrl elsewhere", () => {
    expect(
      isAppChord(press("d", { metaKey: true, shiftKey: true }), true)
    ).toBeTruthy();
    expect(isAppChord(press("z", { ctrlKey: true }), false)).toBeTruthy();
    expect(isAppChord(press("ArrowUp", { metaKey: true }), true)).toBeTruthy();
  });

  it("leaves plain keys, the other system's modifier and a lone modifier to the menu", () => {
    expect(isAppChord(press("d"), true)).toBeFalsy();
    expect(isAppChord(press(" "), false)).toBeFalsy();
    expect(isAppChord(press("d", { ctrlKey: true }), true)).toBeFalsy();
    expect(isAppChord(press("d", { metaKey: true }), false)).toBeFalsy();
    expect(isAppChord(press("Meta", { metaKey: true }), true)).toBeFalsy();
  });
});

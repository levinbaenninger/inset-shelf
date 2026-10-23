import { emptyShelf, ItemIdSchema, SectionIdSchema } from "@shared/shelf";
import type { ShelfDoc } from "@shared/shelf";
import { describe, expect, it, vi } from "vitest";

import { appMenuTemplate } from "./app-menu";
import type { AppMenuActions, AppMenuState } from "./app-menu";

const uuid = (n: number) =>
  `3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1b${String(n).padStart(2, "0")}`;

const INBOX = SectionIdSchema.parse(uuid(1));
const LATER = SectionIdSchema.parse(uuid(2));

const doc: ShelfDoc = {
  ...emptyShelf(INBOX),
  sections: [
    { id: INBOX, name: "Inbox" },
    { id: LATER, name: "Later" },
  ],
};

const actions: AppMenuActions = {
  captureArea: vi.fn<() => void>(),
  clearDone: vi.fn<() => void>(),
  closeWindow: vi.fn<() => void>(),
  copy: vi.fn<() => void>(),
  copyAsList: vi.fn<() => void>(),
  selectAll: vi.fn<() => void>(),
  find: vi.fn<() => void>(),
  item: vi.fn<(action: string) => void>(),
  newNote: vi.fn<() => void>(),
  newDrawing: vi.fn<() => void>(),
  newSection: vi.fn<() => void>(),
  openHelp: vi.fn<() => void>(),
  openSettings: vi.fn<() => void>(),
  selectSection: vi.fn<(id: string) => void>(),
  setFloatOnTop: vi.fn<(on: boolean) => void>(),
  turnOnKeys: vi.fn<() => void>(),
  redo: vi.fn<() => void>(),
  undo: vi.fn<() => void>(),
};

const state: AppMenuState = { doc, floatOnTop: true, keys: "granted" };

const submenu = (
  template: ReturnType<typeof appMenuTemplate>,
  label: string
) => {
  const menu = template.find(
    (item) => item.label === label || item.role === label
  )?.submenu;

  return Array.isArray(menu) ? menu : [];
};

const appMenuLabels = (keys: AppMenuState["keys"]) =>
  submenu(appMenuTemplate({ ...state, keys }, actions), "Inset Shelf").map(
    (item) => item.label
  );

const clearItem = (current: ShelfDoc) =>
  submenu(appMenuTemplate({ ...state, doc: current }, actions), "Edit").find(
    (item) => item.label === "Clear Checked Items"
  );

describe(appMenuTemplate, () => {
  it("has the menus of a regular Mac app", () => {
    expect(
      appMenuTemplate(state, actions).map((item) => item.label ?? item.role)
    ).toStrictEqual([
      "Inset Shelf",
      "File",
      "Edit",
      "Item",
      "View",
      "Window",
      "help",
    ]);
  });

  it("lists the sections with numbered shortcuts and checks the current one", () => {
    expect(submenu(appMenuTemplate(state, actions), "View")).toMatchObject([
      {
        accelerator: "CommandOrControl+1",
        checked: true,
        label: "Inbox",
        type: "radio",
      },
      {
        accelerator: "CommandOrControl+2",
        checked: false,
        label: "Later",
        type: "radio",
      },
    ]);
  });

  it("offers the permission in the app menu only while it is missing", () => {
    expect(appMenuLabels("missing")).toContain("Turn On Double Shift…");
    expect(appMenuLabels("granted")).not.toContain("Turn On Double Shift…");
  });

  it("enables clearing only when the current section has checked items", () => {
    expect(clearItem(doc)).toMatchObject({ enabled: false });
    expect(
      clearItem({
        ...doc,
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
            text: "x",
            via: "typed",
          },
        ],
      })
    ).toMatchObject({ enabled: true });
  });

  it("puts Settings and Exit in File and uses Ctrl+Y for Redo without an app menu", () => {
    const template = appMenuTemplate(state, actions, false);

    expect(template.map((item) => item.label ?? item.role)).toStrictEqual([
      "File",
      "Edit",
      "Item",
      "View",
      "Window",
      "help",
    ]);
    expect(submenu(template, "File")).toContainEqual(
      expect.objectContaining({
        accelerator: "CommandOrControl+,",
        label: "Settings…",
      })
    );
    expect(submenu(template, "File").at(-1)).toStrictEqual({ role: "quit" });
    expect(submenu(template, "Edit")[1]).toMatchObject({
      accelerator: "Control+Y",
      label: "Redo",
    });
    expect(submenu(template, "help")).toContainEqual(
      expect.objectContaining({ label: "About Inset Shelf" })
    );
  });

  it("lists the item shortcuts, leaving plain keys to the page", () => {
    const items = submenu(appMenuTemplate(state, actions), "Item");

    expect(items[0]).toMatchObject({
      accelerator: "CommandOrControl+O",
      label: "Open",
      registerAccelerator: true,
    });
    expect(items.find((item) => item.label === "Check Off")).toMatchObject({
      accelerator: "Space",
      registerAccelerator: false,
    });
  });

  it("shows Float on Top as a checkbox in the Window menu", () => {
    expect(
      submenu(
        appMenuTemplate({ ...state, floatOnTop: false }, actions),
        "Window"
      )[0]
    ).toMatchObject({
      checked: false,
      label: "Float on Top",
      type: "checkbox",
    });
  });
});

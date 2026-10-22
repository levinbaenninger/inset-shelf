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
  closeShelf: vi.fn<() => void>(),
  copy: vi.fn<() => void>(),
  newNote: vi.fn<() => void>(),
  newSection: vi.fn<() => void>(),
  openHelp: vi.fn<() => void>(),
  selectSection: vi.fn<(id: string) => void>(),
  setFloatOnTop: vi.fn<(on: boolean) => void>(),
  turnOnKeys: vi.fn<() => void>(),
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
    ).toStrictEqual(["Inset Shelf", "File", "Edit", "View", "Window", "help"]);
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
            createdAt: "2026-10-22T10:00:00.000Z",
            done: true,
            id: ItemIdSchema.parse(uuid(10)),
            kind: "text",
            sectionId: INBOX,
            text: "x",
            via: "typed",
          },
        ],
      })
    ).toMatchObject({ enabled: true });
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

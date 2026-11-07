import { emptyShelf, SectionIdSchema } from "@shared/shelf";
import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it, vi } from "vitest";

import { appMenuTemplate } from "./app-menu";
import type { AppMenuActions } from "./app-menu";
import {
  matchesAccelerator,
  menuEntryForKey,
  parseAccelerator,
} from "./menu-keys";
import type { KeyInput, MenuNode } from "./menu-keys";

const press = (key: string, modifiers: Partial<KeyInput> = {}): KeyInput => ({
  alt: false,
  control: false,
  isAutoRepeat: false,
  key,
  meta: false,
  shift: false,
  type: "keyDown",
  ...modifiers,
});

describe(parseAccelerator, () => {
  it("reads modifiers in any order, as Windows applies them", () => {
    expect(parseAccelerator("Shift+CommandOrControl+N")).toStrictEqual({
      alt: false,
      control: true,
      key: "n",
      shift: true,
    });
    expect(parseAccelerator("Alt+CommandOrControl+Up")).toStrictEqual({
      alt: true,
      control: true,
      key: "up",
      shift: false,
    });
    expect(parseAccelerator("Hyper+N")).toBeNull();
  });
});

describe(matchesAccelerator, () => {
  const newSection = parseAccelerator("Shift+CommandOrControl+N");

  if (newSection === null) {
    throw new Error("unparsed");
  }

  it("matches Ctrl+Shift+N whatever the letter's case", () => {
    expect(
      matchesAccelerator(press("N", { control: true, shift: true }), newSection)
    ).toBeTruthy();
    expect(
      matchesAccelerator(press("n", { control: true, shift: true }), newSection)
    ).toBeTruthy();
  });

  it("needs every modifier and no others", () => {
    expect(
      matchesAccelerator(press("N", { control: true }), newSection)
    ).toBeFalsy();
    expect(
      matchesAccelerator(
        press("N", { alt: true, control: true, shift: true }),
        newSection
      )
    ).toBeFalsy();
  });

  it("never takes a character typed with AltGr, which arrives as Ctrl+Alt", () => {
    const drawing = parseAccelerator("Alt+CommandOrControl+N");

    expect(drawing).not.toBeNull();
    expect(
      drawing !== null &&
        matchesAccelerator(press("ń", { alt: true, control: true }), drawing)
    ).toBeFalsy();
    expect(
      drawing !== null &&
        matchesAccelerator(press("n", { alt: true, control: true }), drawing)
    ).toBeTruthy();
  });

  it("finds Ctrl+/ where / needs Shift, and arrow keys by their DOM name", () => {
    const sheet = parseAccelerator("CommandOrControl+/");
    const up = parseAccelerator("Alt+CommandOrControl+Up");

    expect(
      sheet !== null &&
        matchesAccelerator(press("/", { control: true, shift: true }), sheet)
    ).toBeTruthy();
    expect(
      up !== null &&
        matchesAccelerator(press("ArrowUp", { alt: true, control: true }), up)
    ).toBeTruthy();
  });
});

const actions: AppMenuActions = {
  checkForUpdates: vi.fn<() => void>(),
  clearDone: vi.fn<() => void>(),
  closeWindow: vi.fn<() => void>(),
  copy: vi.fn<() => void>(),
  copyAsList: vi.fn<() => void>(),
  field: vi.fn<(field: string) => void>(),
  find: vi.fn<() => void>(),
  item: vi.fn<(action: string) => void>(),
  newDrawing: vi.fn<() => void>(),
  newNote: vi.fn<() => void>(),
  newSection: vi.fn<() => void>(),
  newWindowLink: vi.fn<() => void>(),
  openHelp: vi.fn<() => void>(),
  openSettings: vi.fn<() => void>(),
  redo: vi.fn<() => void>(),
  restartToUpdate: vi.fn<() => void>(),
  selectAll: vi.fn<() => void>(),
  selectSection: vi.fn<(id: string) => void>(),
  setFloatOnTop: vi.fn<(on: boolean) => void>(),
  showShortcuts: vi.fn<() => void>(),
  turnOnKeys: vi.fn<() => void>(),
  undo: vi.fn<() => void>(),
};

/** The template as Electron's built menu exposes it: submenus hold `items`. */
interface Node extends MenuNode<Node> {
  readonly label?: string;
}

const toNodes = (template: readonly MenuItemConstructorOptions[]): Node[] =>
  template.map((entry) => ({
    accelerator: entry.accelerator ?? null,
    enabled: entry.enabled,
    label: entry.label,
    registerAccelerator: entry.registerAccelerator,
    submenu: Array.isArray(entry.submenu)
      ? { items: toNodes(entry.submenu) }
      : null,
  }));

describe(menuEntryForKey, () => {
  const section = SectionIdSchema.parse("3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1b01");

  const menu = toNodes(
    appMenuTemplate(
      {
        doc: emptyShelf(section),
        floatOnTop: true,
        keys: "notNeeded",
        update: { kind: "idle" },
      },
      actions,
      false
    )
  );

  const labelFor = (input: KeyInput): string | undefined =>
    menuEntryForKey(menu, input)?.label;

  it("runs New Section on Ctrl+Shift+N (item 8)", () => {
    expect(labelFor(press("N", { control: true, shift: true }))).toBe(
      "New Section…"
    );
  });

  it("runs the field shortcuts", () => {
    expect(labelFor(press("d", { control: true }))).toBe("Add Description");
    expect(labelFor(press("D", { control: true, shift: true }))).toBe(
      "Set Due…"
    );
    expect(labelFor(press("S", { control: true, shift: true }))).toBe(
      "Add Next Steps"
    );
  });

  it("runs Copy with Details on Ctrl+Alt+C, as in every Inset app", () => {
    expect(labelFor(press("c", { alt: true, control: true }))).toBe(
      "Copy with Details"
    );
  });

  it("runs the sheet, the window link and the section moves", () => {
    expect(labelFor(press("/", { control: true }))).toBe("Keyboard Shortcuts");
    expect(labelFor(press("L", { control: true, shift: true }))).toBe(
      "New Window Link…"
    );
    expect(labelFor(press("ArrowDown", { alt: true, control: true }))).toBe(
      "Move to Next Section"
    );
  });

  it("leaves plain edit keys and keys the page owns alone", () => {
    expect(labelFor(press("c", { control: true }))).toBeUndefined();
    expect(labelFor(press("z", { control: true }))).toBeUndefined();
    expect(labelFor(press("Enter"))).toBeUndefined();
    expect(labelFor(press(" "))).toBeUndefined();
  });

  it("ignores repeats and key releases", () => {
    expect(
      labelFor(press("N", { control: true, isAutoRepeat: true, shift: true }))
    ).toBeUndefined();
    expect(
      labelFor(press("N", { control: true, shift: true, type: "keyUp" }))
    ).toBeUndefined();
  });

  it("skips disabled entries", () => {
    const disabled: Node[] = [
      { accelerator: "CommandOrControl+K", enabled: false, label: "Off" },
      { accelerator: "CommandOrControl+K", label: "On" },
    ];

    expect(
      menuEntryForKey(disabled, press("k", { control: true }))?.label
    ).toBe("On");
  });
});

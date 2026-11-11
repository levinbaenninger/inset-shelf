import type { DetailField, ItemAction } from "@shared/contracts";
import type { SectionId, ShelfDoc } from "@shared/shelf";
import type { MenuItemConstructorOptions } from "electron";

import { updateMenuItem } from "./update-state";
import type { UpdateState } from "./update-state";

export const HELP_URL = "https://github.com/levinbaenninger/inset-shelf#readme";

/** Sections past the ninth have no shortcut. */
const NUMBERED_SECTIONS = 9;

export interface AppMenuState {
  readonly doc: ShelfDoc;
  /** macOS: Set Up Permissions… opens the onboarding at Allow access. */
  readonly setUpPermissions: boolean;
  readonly floatOnTop: boolean;
  readonly update: UpdateState;
}

export interface AppMenuActions {
  readonly newNote: () => void;
  readonly newSection: () => void;
  readonly newDrawing: () => void;
  readonly newWindowLink: () => void;
  /** ⌘D, ⌘⇧D, ⌘⇧S: details with that field. */
  readonly field: (field: DetailField) => void;
  readonly showShortcuts: () => void;
  readonly closeWindow: () => void;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly copy: () => void;
  readonly copyAsList: () => void;
  readonly selectAll: () => void;
  readonly find: () => void;
  readonly clearDone: () => void;
  /** An action on the item selected in the shelf. */
  readonly item: (action: ItemAction) => void;
  readonly selectSection: (id: SectionId) => void;
  readonly setFloatOnTop: (on: boolean) => void;
  readonly setUpPermissions: () => void;
  /** Help › Getting Started: the checklist comes back on the shelf. */
  readonly gettingStarted: () => void;
  /** Help › Show Me Around: the spotlight walkthrough of the shelf. */
  readonly showMeAround: () => void;
  readonly openSettings: () => void;
  readonly openHelp: () => void;
  readonly checkForUpdates: () => void;
  readonly restartToUpdate: () => void;
}

const SEPARATOR: MenuItemConstructorOptions = { type: "separator" };

const updateItem = (
  update: UpdateState,
  actions: AppMenuActions
): MenuItemConstructorOptions => {
  const { action, label } = updateMenuItem(update);

  return action === null
    ? { enabled: false, label }
    : { click: actions[action], label };
};

const appSubmenu = (
  state: AppMenuState,
  actions: AppMenuActions
): MenuItemConstructorOptions[] => [
  { role: "about" },
  updateItem(state.update, actions),
  SEPARATOR,
  {
    accelerator: "CommandOrControl+,",
    click: actions.openSettings,
    label: "Settings…",
  },
  ...(state.setUpPermissions
    ? [{ click: actions.setUpPermissions, label: "Set Up Permissions…" }]
    : []),
  SEPARATOR,
  { role: "services" },
  SEPARATOR,
  { role: "hide" },
  { role: "hideOthers" },
  { role: "unhide" },
  SEPARATOR,
  { role: "quit" },
];

const sectionItems = (
  state: AppMenuState,
  actions: AppMenuActions
): MenuItemConstructorOptions[] =>
  state.doc.sections.map((section, index) => ({
    accelerator:
      index < NUMBERED_SECTIONS ? `CommandOrControl+${index + 1}` : undefined,
    checked: section.id === state.doc.activeSectionId,
    click: () => {
      actions.selectSection(section.id);
    },
    label: section.name,
    type: "radio" as const,
  }));

/**
 * The selected item's actions with their keys, so the shortcuts can be found.
 * Return, Space and Backspace are shown but left to the page, where they
 * also type into fields.
 */
const itemSubmenu = (actions: AppMenuActions): MenuItemConstructorOptions[] => {
  const entry = (
    action: ItemAction,
    label: string,
    accelerator: string,
    registerAccelerator = true
  ): MenuItemConstructorOptions => ({
    accelerator,
    click: () => {
      actions.item(action);
    },
    label,
    registerAccelerator,
  });

  const field = (
    which: DetailField,
    label: string,
    accelerator: string
  ): MenuItemConstructorOptions => ({
    accelerator,
    click: () => {
      actions.field(which);
    },
    label,
  });

  return [
    entry("open", "Open", "CommandOrControl+O"),
    entry("edit", "Edit", "Enter", false),
    entry("details", "Show Details", "Right", false),
    entry("toggleDone", "Check Off", "Space", false),
    SEPARATOR,
    field("description", "Add Description", "CommandOrControl+D"),
    field("steps", "Add Next Steps", "Shift+CommandOrControl+S"),
    field("due", "Set Due…", "Shift+CommandOrControl+D"),
    {
      click: () => {
        actions.item("linkWindow");
      },
      label: "Link Window…",
    },
    SEPARATOR,
    entry(
      "previousSection",
      "Move to Previous Section",
      "Alt+CommandOrControl+Up"
    ),
    entry("nextSection", "Move to Next Section", "Alt+CommandOrControl+Down"),
    SEPARATOR,
    entry("remove", "Delete", "Backspace", false),
  ];
};

const fileSubmenu = (
  actions: AppMenuActions,
  mac: boolean
): MenuItemConstructorOptions[] => [
  {
    accelerator: "CommandOrControl+N",
    click: actions.newNote,
    label: "New Note",
  },
  {
    accelerator: "Shift+CommandOrControl+N",
    click: actions.newSection,
    label: "New Section…",
  },
  {
    accelerator: "Alt+CommandOrControl+N",
    click: actions.newDrawing,
    label: "New Drawing…",
  },
  {
    accelerator: "Shift+CommandOrControl+L",
    click: actions.newWindowLink,
    label: "New Window Link…",
  },
  SEPARATOR,
  // Without an app menu, Settings and Exit live here.
  ...(mac
    ? []
    : [
        {
          accelerator: "CommandOrControl+,",
          click: actions.openSettings,
          label: "Settings…",
        },
        SEPARATOR,
      ]),
  {
    accelerator: "CommandOrControl+W",
    click: actions.closeWindow,
    label: "Close",
  },
  ...(mac ? [] : [{ role: "quit" } as const]),
];

/**
 * The menu bar of a regular Mac app. Copy and Undo are the shelf's own: in a
 * text field they behave as usual, on an item they copy it or bring back the
 * last deletion. Elsewhere the same menu has no app menu and is never shown:
 * it is there for its shortcuts.
 */
export const appMenuTemplate = (
  state: AppMenuState,
  actions: AppMenuActions,
  mac = true
): MenuItemConstructorOptions[] => [
  ...(mac
    ? [{ label: "Inset Shelf", submenu: appSubmenu(state, actions) }]
    : []),
  { label: "File", submenu: fileSubmenu(actions, mac) },
  {
    label: "Edit",
    submenu: [
      { accelerator: "CommandOrControl+Z", click: actions.undo, label: "Undo" },
      {
        accelerator: mac ? "Shift+CommandOrControl+Z" : "Control+Y",
        click: actions.redo,
        label: "Redo",
      },
      SEPARATOR,
      { role: "cut" },
      { accelerator: "CommandOrControl+C", click: actions.copy, label: "Copy" },
      {
        accelerator: "Alt+CommandOrControl+C",
        click: () => {
          actions.item("copyDetails");
        },
        label: "Copy with Details",
      },
      {
        click: () => {
          actions.item("copyWithLink");
        },
        label: "Copy with Link",
      },
      {
        accelerator: "Shift+CommandOrControl+C",
        click: actions.copyAsList,
        label: "Copy as List",
      },
      { role: "paste" },
      {
        accelerator: "CommandOrControl+A",
        click: actions.selectAll,
        label: "Select All",
      },
      SEPARATOR,
      { accelerator: "CommandOrControl+F", click: actions.find, label: "Find" },
      SEPARATOR,
      {
        click: actions.clearDone,
        enabled: state.doc.items.some(
          (item) => item.sectionId === state.doc.activeSectionId && item.done
        ),
        label: "Clear Checked Items",
      },
    ],
  },
  { label: "Item", submenu: itemSubmenu(actions) },
  { label: "View", submenu: sectionItems(state, actions) },
  {
    label: "Window",
    submenu: [
      {
        checked: state.floatOnTop,
        click: (item) => {
          actions.setFloatOnTop(item.checked);
        },
        label: "Float on Top",
        type: "checkbox",
      },
      ...(mac ? [SEPARATOR, { role: "front" } as const] : []),
    ],
  },
  {
    role: "help",
    submenu: [
      {
        accelerator: "CommandOrControl+/",
        click: actions.showShortcuts,
        label: "Keyboard Shortcuts",
      },
      { click: actions.gettingStarted, label: "Getting Started" },
      { click: actions.showMeAround, label: "Show Me Around" },
      SEPARATOR,
      { click: actions.openHelp, label: "Inset Shelf Help" },
      // Elsewhere About is part of Settings instead of a system message box.
      ...(mac
        ? []
        : [{ click: actions.openSettings, label: "About Inset Shelf" }]),
    ],
  },
];

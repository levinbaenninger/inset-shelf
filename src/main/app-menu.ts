import type { Permission } from "@shared/contracts";
import type { SectionId, ShelfDoc } from "@shared/shelf";
import { AREA_ACCELERATOR } from "@shared/shortcut";
import type { MenuItemConstructorOptions } from "electron";

export const HELP_URL = "https://github.com/levinbaenninger/inset-shelf#readme";

/** Sections past the ninth have no shortcut. */
const NUMBERED_SECTIONS = 9;

export interface AppMenuState {
  readonly doc: ShelfDoc;
  readonly keys: Permission;
  readonly floatOnTop: boolean;
}

export interface AppMenuActions {
  readonly newNote: () => void;
  readonly newSection: () => void;
  readonly captureArea: () => void;
  readonly closeShelf: () => void;
  readonly undo: () => void;
  readonly copy: () => void;
  readonly copyAsList: () => void;
  readonly find: () => void;
  readonly clearDone: () => void;
  readonly selectSection: (id: SectionId) => void;
  readonly setFloatOnTop: (on: boolean) => void;
  readonly turnOnKeys: () => void;
  readonly openHelp: () => void;
}

const SEPARATOR: MenuItemConstructorOptions = { type: "separator" };

const appSubmenu = (
  state: AppMenuState,
  actions: AppMenuActions
): MenuItemConstructorOptions[] => [
  { role: "about" },
  ...(state.keys === "missing"
    ? [SEPARATOR, { click: actions.turnOnKeys, label: "Turn On Double Shift…" }]
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
 * The menu bar of a regular Mac app. Copy and Undo are the shelf's own: in a
 * text field they behave as usual, on an item they copy it or bring back the
 * last deletion.
 */
export const appMenuTemplate = (
  state: AppMenuState,
  actions: AppMenuActions
): MenuItemConstructorOptions[] => [
  { label: "Inset Shelf", submenu: appSubmenu(state, actions) },
  {
    label: "File",
    submenu: [
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
      SEPARATOR,
      {
        accelerator: AREA_ACCELERATOR,
        click: actions.captureArea,
        label: "Capture Area",
        registerAccelerator: false,
      },
      SEPARATOR,
      {
        accelerator: "CommandOrControl+W",
        click: actions.closeShelf,
        label: "Close",
      },
    ],
  },
  {
    label: "Edit",
    submenu: [
      { accelerator: "CommandOrControl+Z", click: actions.undo, label: "Undo" },
      { role: "redo" },
      SEPARATOR,
      { role: "cut" },
      { accelerator: "CommandOrControl+C", click: actions.copy, label: "Copy" },
      {
        accelerator: "Shift+CommandOrControl+C",
        click: actions.copyAsList,
        label: "Copy Section as List",
      },
      { role: "paste" },
      { role: "selectAll" },
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
      SEPARATOR,
      { role: "front" },
    ],
  },
  {
    role: "help",
    submenu: [{ click: actions.openHelp, label: "Inset Shelf Help" }],
  },
];

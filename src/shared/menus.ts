import type {
  ItemColor,
  ItemId,
  Section,
  SectionId,
  ShelfDoc,
  ShelfItem,
} from "./shelf";
import { openingApp } from "./web-source";

export type MenuChoice =
  | { readonly kind: "selectSection"; readonly id: SectionId }
  /** Several picked items at once. */
  | { readonly kind: "copyList"; readonly ids: readonly ItemId[] }
  | { readonly kind: "toggleMany"; readonly ids: readonly ItemId[] }
  | { readonly kind: "removeMany"; readonly ids: readonly ItemId[] }
  | {
      readonly kind: "moveMany";
      readonly ids: readonly ItemId[];
      readonly sectionId: SectionId;
    }
  | { readonly kind: "clearDone"; readonly sectionId: SectionId }
  | { readonly kind: "renameSection"; readonly id: SectionId }
  | { readonly kind: "removeSection"; readonly id: SectionId }
  | { readonly kind: "newSection" }
  | { readonly kind: "openSettings" }
  | { readonly kind: "setFloatOnTop"; readonly on: boolean }
  | { readonly kind: "openHelp" }
  | { readonly kind: "copy"; readonly id: ItemId }
  | { readonly kind: "copyWithLink"; readonly id: ItemId }
  /** Opens an image large, ready to draw on. */
  | { readonly kind: "open"; readonly id: ItemId }
  /** Opens the page or desktop app an item came from. */
  | { readonly kind: "openSource"; readonly id: ItemId }
  | {
      readonly kind: "setColor";
      readonly id: ItemId;
      readonly color: ItemColor | null;
    }
  | { readonly kind: "edit"; readonly id: ItemId }
  | { readonly kind: "toggleDone"; readonly id: ItemId }
  | { readonly kind: "remove"; readonly id: ItemId }
  | {
      readonly kind: "moveTo";
      readonly id: ItemId;
      readonly sectionId: SectionId;
    };

/**
 * A mark before an entry, where it helps tell the actions apart at a glance
 * (src/renderer/shelf/menus.tsx draws it). Lists of sections have none.
 */
export type MenuIcon =
  | "addHere"
  | "clear"
  | "newSection"
  | "settings"
  | "float"
  | "help"
  | "copy"
  | "link"
  | "open"
  | "annotate"
  | "edit"
  | "check"
  | "move"
  | "delete";

export type MenuEntry =
  | { readonly kind: "separator" }
  /** Entries in a submenu under this label, such as the sections to move to. */
  | {
      readonly kind: "group";
      readonly label: string;
      readonly icon?: MenuIcon;
      readonly entries: readonly MenuEntry[];
    }
  | {
      readonly kind: "choice";
      readonly label: string;
      readonly icon?: MenuIcon;
      readonly choice: MenuChoice;
      readonly enabled: boolean;
      /** Deletes something: shown in red. */
      readonly destructive?: boolean;
      /** The shelf's own key for this action, shown at the right edge. */
      readonly accelerator?: string;
      /** A setting that is on, ticked at the right edge. */
      readonly checked?: boolean;
    }
  /** A row of colour swatches, the item's colour marked, and one to clear it. */
  | {
      readonly kind: "colors";
      readonly label: string;
      readonly id: ItemId;
      readonly current: ItemColor | null;
    };

const SEPARATOR: MenuEntry = { kind: "separator" };

/**
 * The ⋯ at the top of the shelf, and a right-click on empty space: start a
 * section, open Settings. Without a menu bar (`windowMenu`, on Windows) it
 * also holds what the Window and Help menus would: Float on Top and Help.
 */
export const shelfMenu = (
  windowMenu: { readonly floatOnTop: boolean } | null = null
): readonly MenuEntry[] => [
  {
    accelerator: "Shift+CommandOrControl+N",
    choice: { kind: "newSection" },
    enabled: true,
    icon: "newSection",
    kind: "choice",
    label: "New Section",
  },
  SEPARATOR,
  ...(windowMenu === null
    ? []
    : [
        {
          checked: windowMenu.floatOnTop,
          choice: { kind: "setFloatOnTop", on: !windowMenu.floatOnTop },
          enabled: true,
          icon: "float",
          kind: "choice",
          label: "Float on Top",
        } as const,
        SEPARATOR,
      ]),
  {
    accelerator: "CommandOrControl+,",
    choice: { kind: "openSettings" },
    enabled: true,
    icon: "settings",
    kind: "choice",
    label: "Settings",
  },
  ...(windowMenu === null
    ? []
    : [
        {
          choice: { kind: "openHelp" },
          enabled: true,
          icon: "help",
          kind: "choice",
          label: "Inset Shelf Help",
        } as const,
      ]),
];

/** A section's ⋯ and right-click: new items here, rename, clear checked items, delete. */
export const sectionMenu = (
  section: Section,
  doc: ShelfDoc
): readonly MenuEntry[] => [
  ...(section.id === doc.activeSectionId
    ? []
    : [
        {
          choice: { id: section.id, kind: "selectSection" },
          enabled: true,
          icon: "addHere",
          kind: "choice",
          label: "Add Items Here",
        } satisfies MenuEntry,
      ]),
  {
    choice: { id: section.id, kind: "renameSection" },
    enabled: true,
    icon: "edit",
    kind: "choice",
    label: "Rename",
  },
  {
    choice: { kind: "clearDone", sectionId: section.id },
    enabled: doc.items.some(
      (item) => item.sectionId === section.id && item.done
    ),
    icon: "clear",
    kind: "choice",
    label: "Clear Checked",
  },
  SEPARATOR,
  {
    choice: { id: section.id, kind: "removeSection" },
    destructive: true,
    enabled: doc.sections.length > 1,
    icon: "delete",
    kind: "choice",
    label: "Delete Section",
  },
];

const moveTo = (item: ShelfItem, doc: ShelfDoc): readonly MenuEntry[] => {
  const others = doc.sections.filter(
    (section) => section.id !== item.sectionId
  );

  return others.length === 0
    ? []
    : [
        {
          entries: others.map((section): MenuEntry => ({
            choice: { id: item.id, kind: "moveTo", sectionId: section.id },
            enabled: true,
            kind: "choice",
            label: section.name,
          })),
          icon: "move",
          kind: "group",
          label: "Move to",
        },
      ];
};

export const COLOR_NAMES: Readonly<Record<ItemColor, string>> = {
  blue: "Blue",
  gray: "Grey",
  green: "Green",
  orange: "Orange",
  purple: "Purple",
  red: "Red",
  yellow: "Yellow",
};

const copyWithLink = (item: ShelfItem): readonly MenuEntry[] =>
  item.context?.url === null || item.context === null
    ? []
    : [
        {
          accelerator: "Alt+CommandOrControl+C",
          choice: { id: item.id, kind: "copyWithLink" },
          enabled: true,
          icon: "link",
          kind: "choice",
          label: "Copy with Link",
        },
      ];

/** ⌘O: an image opens to draw on; anything else opens where it came from, if the shelf knows. */
const open = (item: ShelfItem, mac: boolean): readonly MenuEntry[] => {
  if (item.kind === "image") {
    return [
      {
        accelerator: "CommandOrControl+O",
        choice: { id: item.id, kind: "open" },
        enabled: true,
        icon: "annotate",
        kind: "choice",
        label: "Annotate",
      },
    ];
  }

  const app = openingApp(item.context, mac);

  if (app === null && (item.context?.url ?? null) === null) {
    return [];
  }

  return [
    {
      accelerator: "CommandOrControl+O",
      choice: { id: item.id, kind: "openSource" },
      enabled: true,
      icon: "open",
      kind: "choice",
      label: app === null ? "Open Page" : `Open in ${app}`,
    },
  ];
};

/** What a right-click on an item offers, with the keys that do the same in the list. */
export const itemMenu = (
  item: ShelfItem,
  doc: ShelfDoc,
  mac = true
): readonly MenuEntry[] => [
  {
    accelerator: "CommandOrControl+C",
    choice: { id: item.id, kind: "copy" },
    enabled: true,
    icon: "copy",
    kind: "choice",
    label: "Copy",
  },
  ...copyWithLink(item),
  SEPARATOR,
  ...open(item, mac),
  {
    accelerator: "Enter",
    choice: { id: item.id, kind: "edit" },
    enabled: true,
    icon: "edit",
    kind: "choice",
    label: item.kind === "text" ? "Edit" : "Edit Note",
  },
  {
    accelerator: "Space",
    choice: { id: item.id, kind: "toggleDone" },
    enabled: true,
    icon: "check",
    kind: "choice",
    label: item.done ? "Uncheck" : "Check Off",
  },
  ...moveTo(item, doc),
  SEPARATOR,
  { current: item.color, id: item.id, kind: "colors", label: "Colour" },
  SEPARATOR,
  {
    accelerator: "Backspace",
    choice: { id: item.id, kind: "remove" },
    destructive: true,
    enabled: true,
    icon: "delete",
    kind: "choice",
    label: "Delete",
  },
];

/** The menu for several picked items: copy them as a list, check them off, move or delete them. */
export const pickedMenu = (
  items: readonly ShelfItem[],
  doc: ShelfDoc
): readonly MenuEntry[] => {
  const ids = items.map((item) => item.id);
  const allDone = items.every((item) => item.done);

  const targets = doc.sections.filter(
    (section) => !items.every((item) => item.sectionId === section.id)
  );

  return [
    {
      accelerator: "Shift+CommandOrControl+C",
      choice: { ids, kind: "copyList" },
      enabled: true,
      icon: "copy",
      kind: "choice",
      label: "Copy as List",
    },
    SEPARATOR,
    {
      accelerator: "Space",
      choice: { ids, kind: "toggleMany" },
      enabled: true,
      icon: "check",
      kind: "choice",
      label: allDone ? "Uncheck All" : "Check Off All",
    },
    ...(targets.length === 0
      ? []
      : [
          {
            entries: targets.map((section): MenuEntry => ({
              choice: { ids, kind: "moveMany", sectionId: section.id },
              enabled: true,
              kind: "choice",
              label: section.name,
            })),
            icon: "move",
            kind: "group",
            label: "Move to",
          } satisfies MenuEntry,
        ]),
    SEPARATOR,
    {
      accelerator: "Backspace",
      choice: { ids, kind: "removeMany" },
      destructive: true,
      enabled: true,
      icon: "delete",
      kind: "choice",
      label: `Delete ${ids.length} Items`,
    },
  ];
};

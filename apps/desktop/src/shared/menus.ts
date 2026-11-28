import { CODE_EDITORS, codeAction, codeWay } from "./code-editors";
import type { CodeEditor } from "./code-editors";
import { hasAttachments, hasDetails } from "./shelf";
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
  | { readonly kind: "newWindowLink" }
  | { readonly kind: "shortcuts" }
  | { readonly kind: "openSettings" }
  | { readonly kind: "setFloatOnTop"; readonly on: boolean }
  | { readonly kind: "openHelp" }
  /** The tutorial's checklist comes back (Windows, where there is no Help menu). */
  | { readonly kind: "gettingStarted" }
  /** The tutorial's walkthrough (Windows, where there is no Help menu). */
  | { readonly kind: "showMeAround" }
  | { readonly kind: "copy"; readonly id: ItemId }
  | { readonly kind: "copyWithLink"; readonly id: ItemId }
  | { readonly kind: "copyDetails"; readonly id: ItemId }
  /** The details view: every field, for editing. */
  | { readonly kind: "details"; readonly id: ItemId }
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
  | "details"
  | "settings"
  | "float"
  | "help"
  | "checklist"
  | "tour"
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
 * section, open Settings, open the docs. Without a menu bar (`windowMenu`, on
 * Windows) it also holds what the Window and Help menus would: Float on Top
 * and the tutorial. A window link (+, ⇧⌘L) and Keyboard Shortcuts (⌘/, the
 * Help menu, the tray) have their own ways in.
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
          choice: { kind: "gettingStarted" },
          enabled: true,
          icon: "checklist",
          kind: "choice",
          label: "Getting Started",
        } as const,
        {
          choice: { kind: "showMeAround" },
          enabled: true,
          icon: "tour",
          kind: "choice",
          label: "Show Me Around",
        } as const,
      ]),
  {
    choice: { kind: "openHelp" },
    enabled: true,
    icon: "help",
    kind: "choice",
    label: "Help",
  },
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
          choice: { id: item.id, kind: "copyWithLink" },
          enabled: true,
          icon: "link",
          kind: "choice",
          label: "Copy with Link",
        },
      ];

/** ⌥⌘C in every Inset app; shown only where it copies more than Copy does. */
const copyDetails = (item: ShelfItem): readonly MenuEntry[] =>
  hasDetails(item) ||
  hasAttachments(item) ||
  (item.context?.url ?? null) !== null
    ? [
        {
          accelerator: "Alt+CommandOrControl+C",
          choice: { id: item.id, kind: "copyDetails" },
          enabled: true,
          icon: "copy",
          kind: "choice",
          label: "Copy with Details",
        },
      ]
    : [];

/** What ⌘O on an item from `app` says it does: a code file opens in its editor or is shown in its folder. */
const openLabel = (
  item: ShelfItem,
  app: string,
  mac: boolean,
  editors: readonly CodeEditor[]
): string => {
  const place = item.context?.code ?? null;
  const way = place === null ? null : codeWay(app, place, editors);

  return way === null ? `Open in ${app}` : codeAction(app, way, mac);
};

/** ⌘O: an image opens to draw on; anything else opens where it came from, if the shelf knows. */
const open = (
  item: ShelfItem,
  mac: boolean,
  editors: readonly CodeEditor[]
): readonly MenuEntry[] => {
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

  const app = openingApp(item.context, mac, editors);

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
      label: app === null ? "Open Page" : openLabel(item, app, mac, editors),
    },
  ];
};

/** Where an item's menu opens: on its row in the list, or from ⋯ in its details, which have no Details entry. */
export type ItemMenuPlace = "row" | "details";

/**
 * What a right-click on an item offers, with the keys that act on the item
 * while its menu is open. Return and Space choose the highlighted entry
 * there, as in any menu, so no entry shows them.
 */
export const itemMenu = (
  item: ShelfItem,
  doc: ShelfDoc,
  mac = true,
  place: ItemMenuPlace = "row",
  editors: readonly CodeEditor[] = CODE_EDITORS
): readonly MenuEntry[] => [
  {
    accelerator: "CommandOrControl+C",
    choice: { id: item.id, kind: "copy" },
    enabled: true,
    icon: "copy",
    kind: "choice",
    label: "Copy",
  },
  ...copyDetails(item),
  ...copyWithLink(item),
  SEPARATOR,
  ...(place === "details"
    ? []
    : [
        {
          accelerator: "Right",
          choice: { id: item.id, kind: "details" },
          enabled: true,
          icon: "details",
          kind: "choice",
          label: "Details",
        } satisfies MenuEntry,
      ]),
  ...open(item, mac, editors),
  {
    choice: { id: item.id, kind: "edit" },
    enabled: true,
    icon: "edit",
    kind: "choice",
    label: item.kind === "text" ? "Edit" : "Edit Caption",
  },
  {
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

/** The parts of a KeyboardEvent a menu reads. */
export interface MenuKeyPress {
  readonly key: string;
  /** The physical key, which macOS keeps when ⌥ turns C into ç. */
  readonly code: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly repeat: boolean;
}

/** The keys an accelerator's last part stands for; ⌫ and Delete both delete, as in the list. */
const NAMED_KEYS = new Map<string, readonly string[]>([
  ["Backspace", ["Backspace", "Delete"]],
  ["Right", ["ArrowRight"]],
]);

const pressesKey = (press: MenuKeyPress, key: string, mac: boolean): boolean =>
  NAMED_KEYS.get(key)?.includes(press.key) ??
  (key.length === 1 &&
    (press.key.toLowerCase() === key.toLowerCase() ||
      (mac && press.code === `Key${key.toUpperCase()}`)));

/**
 * Whether a key press is an accelerator, such as "Alt+CommandOrControl+C", on
 * this system. Punctuation that needs Shift on some layouts (/ is Shift+7 on a
 * German one) matches with or without it, as in the app menu.
 */
export const pressesAccelerator = (
  press: MenuKeyPress,
  accelerator: string,
  mac: boolean
): boolean => {
  const parts = accelerator.split("+");
  const key = parts.at(-1) ?? "";
  const command = mac ? press.metaKey : press.ctrlKey;
  const other = mac ? press.ctrlKey : press.metaKey;
  const punctuation = key.length === 1 && !/^[a-z0-9]$/iu.test(key);

  return (
    !other &&
    command === parts.includes("CommandOrControl") &&
    press.altKey === parts.includes("Alt") &&
    (punctuation || press.shiftKey === parts.includes("Shift")) &&
    pressesKey(press, key, mac)
  );
};

/** A key a menu answers without an entry that shows it. */
export interface MenuKey {
  readonly accelerator: string;
  readonly choice: MenuChoice;
}

/**
 * The shelf's own keys for what its menu no longer lists: a window link (+,
 * the File menu) and Keyboard Shortcuts (the Help menu, the tray). They still
 * work while the menu is open.
 */
export const SHELF_MENU_KEYS: readonly MenuKey[] = [
  {
    accelerator: "Shift+CommandOrControl+L",
    choice: { kind: "newWindowLink" },
  },
  { accelerator: "CommandOrControl+/", choice: { kind: "shortcuts" } },
];

/**
 * The choice a key press runs while a menu is open: the entry that shows
 * that key, for the item the menu belongs to, whichever entry is
 * highlighted, or else one of the menu's unseen `keys`. A held key acts once.
 */
export const menuChoiceForKey = (
  entries: readonly MenuEntry[],
  press: MenuKeyPress,
  mac: boolean,
  keys: readonly MenuKey[] = []
): MenuChoice | null => {
  if (press.repeat) {
    return null;
  }

  const shown = entries.flatMap((entry) =>
    entry.kind === "choice" && entry.enabled && entry.accelerator !== undefined
      ? [{ accelerator: entry.accelerator, choice: entry.choice }]
      : []
  );

  return (
    [...shown, ...keys].find((key) =>
      pressesAccelerator(press, key.accelerator, mac)
    )?.choice ?? null
  );
};

const MODIFIER_KEYS = new Set(["Alt", "Control", "Meta", "Shift", "AltGraph"]);

/**
 * An app shortcut, which an open menu keeps from the page under it unless
 * the menu shows it: any key held with ⌘ on a Mac, or Ctrl elsewhere.
 */
export const isAppChord = (press: MenuKeyPress, mac: boolean): boolean =>
  (mac ? press.metaKey : press.ctrlKey) && !MODIFIER_KEYS.has(press.key);

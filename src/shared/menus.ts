import type {
  ItemColor,
  ItemId,
  SectionId,
  ShelfDoc,
  ShelfItem,
} from "./shelf";

export type MenuChoice =
  | { readonly kind: "selectSection"; readonly id: SectionId }
  | { readonly kind: "clearDone" }
  | { readonly kind: "newSection" }
  | { readonly kind: "openSettings" }
  | { readonly kind: "copy"; readonly id: ItemId }
  | { readonly kind: "copyWithLink"; readonly id: ItemId }
  /** Opens an image large, ready to draw on. */
  | { readonly kind: "open"; readonly id: ItemId }
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

export type MenuEntry =
  | { readonly kind: "separator" }
  /** Entries under a heading, in the menu itself: the shelf is too narrow for submenus. */
  | {
      readonly kind: "group";
      readonly label: string;
      readonly entries: readonly MenuEntry[];
    }
  | {
      readonly kind: "choice";
      readonly label: string;
      readonly choice: MenuChoice;
      readonly enabled: boolean;
      /** Set on the sections list, where the current one carries a check. */
      readonly checked?: boolean;
      /** The shelf's own key for this action, shown at the right edge. */
      readonly accelerator?: string;
    }
  /** A row of colour swatches, the item's colour marked, and one to clear it. */
  | {
      readonly kind: "colors";
      readonly label: string;
      readonly id: ItemId;
      readonly current: ItemColor | null;
    };

const SEPARATOR: MenuEntry = { kind: "separator" };

/** The section switcher: every section, then the actions on the current one, then Settings. */
export const sectionMenu = (doc: ShelfDoc): readonly MenuEntry[] => {
  const checkedHere = doc.items.some(
    (item) => item.sectionId === doc.activeSectionId && item.done
  );

  return [
    ...doc.sections.map((section): MenuEntry => ({
      checked: section.id === doc.activeSectionId,
      choice: { id: section.id, kind: "selectSection" },
      enabled: true,
      kind: "choice",
      label: section.name,
    })),
    SEPARATOR,
    {
      choice: { kind: "newSection" },
      enabled: true,
      kind: "choice",
      label: "New Section…",
    },
    {
      choice: { kind: "clearDone" },
      enabled: checkedHere,
      kind: "choice",
      label: "Clear Checked Items",
    },
    SEPARATOR,
    {
      accelerator: "CommandOrControl+,",
      choice: { kind: "openSettings" },
      enabled: true,
      kind: "choice",
      label: "Settings…",
    },
  ];
};

const moveTo = (item: ShelfItem, doc: ShelfDoc): readonly MenuEntry[] => {
  const others = doc.sections.filter(
    (section) => section.id !== item.sectionId
  );

  return others.length === 0
    ? []
    : [
        SEPARATOR,
        {
          entries: others.map((section): MenuEntry => ({
            choice: { id: item.id, kind: "moveTo", sectionId: section.id },
            enabled: true,
            kind: "choice",
            label: section.name,
          })),
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
          kind: "choice",
          label: "Copy with Link",
        },
      ];

const openImage = (item: ShelfItem): readonly MenuEntry[] =>
  item.kind === "image"
    ? [
        {
          choice: { id: item.id, kind: "open" },
          enabled: true,
          kind: "choice",
          label: "View and Annotate…",
        },
      ]
    : [];

/** What a right-click on an item offers, with the keys that do the same in the list. */
export const itemMenu = (
  item: ShelfItem,
  doc: ShelfDoc
): readonly MenuEntry[] => [
  {
    accelerator: "CommandOrControl+C",
    choice: { id: item.id, kind: "copy" },
    enabled: true,
    kind: "choice",
    label: "Copy",
  },
  ...copyWithLink(item),
  ...openImage(item),
  {
    accelerator: "Enter",
    choice: { id: item.id, kind: "edit" },
    enabled: true,
    kind: "choice",
    label: item.kind === "text" ? "Edit" : "Edit Note",
  },
  {
    accelerator: "Space",
    choice: { id: item.id, kind: "toggleDone" },
    enabled: true,
    kind: "choice",
    label: item.done ? "Mark as Not Done" : "Mark as Done",
  },
  ...moveTo(item, doc),
  SEPARATOR,
  { current: item.color, id: item.id, kind: "colors", label: "Colour" },
  SEPARATOR,
  {
    accelerator: "Backspace",
    choice: { id: item.id, kind: "remove" },
    enabled: true,
    kind: "choice",
    label: "Delete",
  },
];

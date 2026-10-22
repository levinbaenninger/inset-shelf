import { COLORS } from "@shared/shelf";
import type {
  ItemColor,
  ItemId,
  SectionId,
  ShelfDoc,
  ShelfItem,
} from "@shared/shelf";

export type MenuChoice =
  | { readonly kind: "selectSection"; readonly id: SectionId }
  | { readonly kind: "clearDone" }
  | { readonly kind: "newSection" }
  | { readonly kind: "copy"; readonly id: ItemId }
  | { readonly kind: "copyWithLink"; readonly id: ItemId }
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
  | {
      readonly kind: "submenu";
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
      /** A colour swatch drawn before the label. */
      readonly swatch?: ItemColor;
    };

const SEPARATOR: MenuEntry = { kind: "separator" };

/** The section switcher: every section, then the actions on the current one. */
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
  ];
};

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
          kind: "submenu",
          label: "Move to",
        },
      ];
};

const COLOR_NAMES: Record<ItemColor, string> = {
  blue: "Blue",
  gray: "Gray",
  green: "Green",
  orange: "Orange",
  purple: "Purple",
  red: "Red",
  yellow: "Yellow",
};

const colorMenu = (item: ShelfItem): MenuEntry => ({
  entries: [
    ...COLORS.map((color): MenuEntry => ({
      checked: item.color === color,
      choice: { color, id: item.id, kind: "setColor" },
      enabled: true,
      kind: "choice",
      label: COLOR_NAMES[color],
      swatch: color,
    })),
    SEPARATOR,
    {
      choice: { color: null, id: item.id, kind: "setColor" },
      enabled: item.color !== null,
      kind: "choice",
      label: "No Colour",
    },
  ],
  kind: "submenu",
  label: "Colour",
});

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
  colorMenu(item),
  SEPARATOR,
  {
    accelerator: "Backspace",
    choice: { id: item.id, kind: "remove" },
    enabled: true,
    kind: "choice",
    label: "Delete",
  },
];

import type { ItemId, SectionId, ShelfDoc, ShelfItem } from "@shared/shelf";

export type MenuChoice =
  | { readonly kind: "selectSection"; readonly id: SectionId }
  | { readonly kind: "clearDone" }
  | { readonly kind: "newSection" }
  | { readonly kind: "copy"; readonly id: ItemId }
  | { readonly kind: "edit"; readonly id: ItemId }
  | { readonly kind: "toggleDone"; readonly id: ItemId }
  | { readonly kind: "remove"; readonly id: ItemId };

export type MenuEntry =
  | { readonly kind: "separator" }
  | {
      readonly kind: "choice";
      readonly label: string;
      readonly choice: MenuChoice;
      readonly enabled: boolean;
      /** Set on the sections list, where the current one carries a check. */
      readonly checked?: boolean;
      /** The shelf's own key for this action, shown at the right edge. */
      readonly accelerator?: string;
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

/** What a right-click on an item offers, with the keys that do the same in the list. */
export const itemMenu = (item: ShelfItem): readonly MenuEntry[] => [
  {
    accelerator: "CommandOrControl+C",
    choice: { id: item.id, kind: "copy" },
    enabled: true,
    kind: "choice",
    label: "Copy",
  },
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
  SEPARATOR,
  {
    accelerator: "Backspace",
    choice: { id: item.id, kind: "remove" },
    enabled: true,
    kind: "choice",
    label: "Delete",
  },
];

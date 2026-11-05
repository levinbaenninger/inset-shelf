import type { Permission } from "@shared/contracts";
import { shortcutLabels, TOGGLE_ACCELERATOR } from "@shared/shortcut";

import { updateMenuItem } from "./update-state";
import type { UpdateAction, UpdateState } from "./update-state";

export type TrayAction =
  | "toggleShelf"
  | "turnOnKeys"
  | "openSettings"
  | "showShortcuts"
  | UpdateAction;

export type TrayItem =
  | { readonly kind: "separator" }
  | { readonly kind: "role"; readonly role: "about" | "quit" }
  | { readonly kind: "label"; readonly label: string }
  | {
      readonly kind: "item";
      readonly label: string;
      readonly action: TrayAction;
      /** Shown next to the label; the global shortcut is registered elsewhere. */
      readonly accelerator?: string;
    };

export interface TrayModel {
  readonly shelfVisible: boolean;
  readonly keys: Permission;
  readonly shortcutsRegistered: boolean;
  readonly version: string;
  readonly update: UpdateState;
}

const SEPARATOR: TrayItem = { kind: "separator" };

const updateItem = (update: UpdateState): TrayItem => {
  const { action, label } = updateMenuItem(update);

  return action === null
    ? { kind: "label", label }
    : { action, kind: "item", label };
};

/** A plain macOS menu-bar menu: the app's actions, the version and its update, then About and Quit. */
export const trayMenu = (model: TrayModel): readonly TrayItem[] => {
  const accelerator = (value: string): { accelerator?: string } =>
    model.shortcutsRegistered ? { accelerator: value } : {};

  const permission: readonly TrayItem[] =
    model.keys === "missing"
      ? [
          SEPARATOR,
          {
            action: "turnOnKeys",
            kind: "item",
            label: "Turn On Double Shift…",
          },
        ]
      : [];

  return [
    {
      action: "toggleShelf",
      kind: "item",
      label: model.shelfVisible ? "Hide Inset Shelf" : "Show Inset Shelf",
      ...accelerator(TOGGLE_ACCELERATOR),
    },
    ...permission,
    SEPARATOR,
    {
      action: "openSettings",
      kind: "item",
      label: "Settings…",
      ...accelerator("CommandOrControl+,"),
    },
    {
      action: "showShortcuts",
      kind: "item",
      label: "Keyboard Shortcuts",
      ...accelerator("CommandOrControl+/"),
    },
    SEPARATOR,
    { kind: "label", label: `Version ${model.version}` },
    updateItem(model.update),
    SEPARATOR,
    { kind: "role", role: "about" },
    { kind: "role", role: "quit" },
  ];
};

export const trayTooltip = (isMac: boolean): string =>
  `Inset Shelf (${shortcutLabels(isMac).toggle})`;

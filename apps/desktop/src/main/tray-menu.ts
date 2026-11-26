import { shortcutLabels, TOGGLE_ACCELERATOR } from "@shared/shortcut";

import { updateMenuItem } from "./update-state";
import type { UpdateAction, UpdateState } from "./update-state";

export type TrayAction =
  | "toggleShelf"
  | "setUpPermissions"
  | "gettingStarted"
  | "showMeAround"
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
  /** macOS: Set Up Permissions… opens the onboarding at Allow access. */
  readonly setUpPermissions: boolean;
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

  return [
    {
      action: "toggleShelf",
      kind: "item",
      label: model.shelfVisible ? "Hide Inset Shelf" : "Show Inset Shelf",
      ...accelerator(TOGGLE_ACCELERATOR),
    },
    SEPARATOR,
    {
      action: "openSettings",
      kind: "item",
      label: "Settings…",
      ...accelerator("CommandOrControl+,"),
    },
    ...(model.setUpPermissions
      ? [
          {
            action: "setUpPermissions",
            kind: "item",
            label: "Set Up Permissions…",
          } as const,
        ]
      : []),
    {
      action: "showShortcuts",
      kind: "item",
      label: "Keyboard Shortcuts",
      ...accelerator("CommandOrControl+/"),
    },
    // The tutorial, also here: without a Dock icon the app has no Help menu.
    { action: "gettingStarted", kind: "item", label: "Getting Started" },
    { action: "showMeAround", kind: "item", label: "Show Me Around" },
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

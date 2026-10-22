import type { Permission } from "@shared/contracts";
import {
  AREA_ACCELERATOR,
  shortcutLabels,
  TOGGLE_ACCELERATOR,
} from "@shared/shortcut";

export type TrayAction = "toggleShelf" | "captureArea" | "turnOnKeys";

export type TrayItem =
  | { readonly kind: "separator" }
  | { readonly kind: "role"; readonly role: "about" | "quit" }
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
}

const SEPARATOR: TrayItem = { kind: "separator" };

/** A plain macOS menu-bar menu: the app's actions, then About and Quit. */
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
    {
      action: "captureArea",
      kind: "item",
      label: "Capture Area",
      ...accelerator(AREA_ACCELERATOR),
    },
    ...permission,
    SEPARATOR,
    { kind: "role", role: "about" },
    { kind: "role", role: "quit" },
  ];
};

export const trayTooltip = (isMac: boolean): string =>
  `Inset Shelf (${shortcutLabels(isMac).toggle})`;

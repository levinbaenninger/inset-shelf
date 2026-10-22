import type { Permission } from "@shared/contracts";
import {
  AREA_ACCELERATOR,
  shortcutLabels,
  TOGGLE_ACCELERATOR,
} from "@shared/shortcut";

export type TrayAction = "toggleShelf" | "captureArea" | "turnOnKeys" | "quit";

export type TrayItem =
  | { readonly kind: "separator" }
  | {
      readonly kind: "item";
      readonly label: string;
      readonly action: TrayAction | null;
      readonly enabled: boolean;
      /** Shown next to the label; the global shortcut is registered elsewhere. */
      readonly accelerator?: string;
    };

export interface TrayModel {
  readonly isMac: boolean;
  readonly shelfVisible: boolean;
  readonly keys: Permission;
  readonly selectionCapture: boolean;
  readonly shortcutsRegistered: boolean;
}

const SEPARATOR: TrayItem = { kind: "separator" };

export const trayMenu = (model: TrayModel): readonly TrayItem[] => {
  const labels = shortcutLabels(model.isMac);

  const doubleShift: TrayItem[] =
    model.keys === "missing"
      ? [
          {
            action: "turnOnKeys",
            enabled: true,
            kind: "item",
            label: "Turn On Double Shift…",
          },
        ]
      : [
          {
            action: null,
            enabled: false,
            kind: "item",
            label: model.selectionCapture
              ? `${labels.doubleShift} saves selected text`
              : `${labels.doubleShift} shows the shelf`,
          },
        ];

  return [
    {
      accelerator: model.shortcutsRegistered ? TOGGLE_ACCELERATOR : undefined,
      action: "toggleShelf",
      enabled: true,
      kind: "item",
      label: model.shelfVisible ? "Hide Shelf" : "Show Shelf",
    },
    {
      accelerator: model.shortcutsRegistered ? AREA_ACCELERATOR : undefined,
      action: "captureArea",
      enabled: true,
      kind: "item",
      label: "Capture Area or Pin",
    },
    SEPARATOR,
    ...doubleShift,
    SEPARATOR,
    { action: "quit", enabled: true, kind: "item", label: "Quit Inset Shelf" },
  ];
};

export const trayTooltip = (isMac: boolean): string => {
  const labels = shortcutLabels(isMac);

  return `Inset Shelf: ${labels.toggle} shows the shelf, ${labels.area} captures an area`;
};

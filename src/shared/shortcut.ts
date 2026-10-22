/** Control+Alt combinations: rarely bound by other apps, and free of the input-source keys on macOS. */
export const TOGGLE_ACCELERATOR = "Control+Alt+S";
export const AREA_ACCELERATOR = "Control+Alt+A";

export interface ShortcutLabels {
  readonly toggle: string;
  readonly area: string;
  readonly doubleShift: string;
  readonly copy: string;
}

export const shortcutLabels = (isMac: boolean): ShortcutLabels =>
  isMac
    ? { area: "⌃⌥A", copy: "⌘C", doubleShift: "⇧ ⇧", toggle: "⌃⌥S" }
    : {
        area: "Ctrl+Alt+A",
        copy: "Ctrl+C",
        doubleShift: "Shift Shift",
        toggle: "Ctrl+Alt+S",
      };

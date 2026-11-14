/** Control+Alt combinations: rarely bound by other apps, and free of the input-source keys on macOS. */
export const TOGGLE_ACCELERATOR = "Control+Alt+S";

export interface ShortcutLabels {
  readonly toggle: string;
  readonly doubleShift: string;
  readonly copy: string;
  /** The system's own screenshot keys: a screenshot taken with them shows a card to keep it. */
  readonly screenshot: string;
}

export const shortcutLabels = (isMac: boolean): ShortcutLabels =>
  isMac
    ? { copy: "⌘C", doubleShift: "⇧ ⇧", screenshot: "⇧⌘4", toggle: "⌃⌥S" }
    : {
        copy: "Ctrl+C",
        doubleShift: "Shift Shift",
        screenshot: "Win+Shift+S",
        toggle: "Ctrl+Alt+S",
      };

const MAC_KEYS = new Map([
  ["Alt", "⌥"],
  ["Backspace", "⌫"],
  ["CommandOrControl", "⌘"],
  ["Control", "⌃"],
  ["Down", "↓"],
  ["Enter", "↩"],
  ["Esc", "Esc"],
  ["Left", "←"],
  ["Right", "→"],
  ["Shift", "⇧"],
  ["Up", "↑"],
]);

const OTHER_KEYS = new Map([
  ["Backspace", "Del"],
  ["CommandOrControl", "Ctrl"],
  ["Control", "Ctrl"],
  ["Down", "↓"],
  ["Left", "←"],
  ["Right", "→"],
  ["Up", "↑"],
]);

/** Windows names the modifiers in this order, before the key. */
const MODIFIER_ORDER = ["Ctrl", "Shift", "Alt"];

const modifierRank = (part: string): number =>
  MODIFIER_ORDER.includes(part)
    ? MODIFIER_ORDER.indexOf(part)
    : MODIFIER_ORDER.length;

/** An Electron accelerator as a menu shows it: ⌥⌘N on a Mac, Ctrl+Alt+N elsewhere. */
export const keyText = (accelerator: string, mac: boolean): string => {
  const parts = accelerator
    .split("+")
    .map((part) => (mac ? MAC_KEYS : OTHER_KEYS).get(part) ?? part);

  if (mac) {
    return parts.join("");
  }

  return parts.toSorted((a, b) => modifierRank(a) - modifierRank(b)).join("+");
};

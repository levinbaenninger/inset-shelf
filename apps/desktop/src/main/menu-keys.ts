/**
 * Item 8: on Windows the shelf's menu keys (Ctrl+Shift+N for New Section and
 * the rest) never fired. The shelf is a frameless window, and the app menu
 * is hidden on every window, so Windows has no menu bar to take the
 * accelerators from. Each window now reads its own key presses
 * (`before-input-event`) and runs the menu entry they belong to.
 *
 * This file only matches; it knows nothing about Electron's objects.
 */

/** The parts of Electron's Input this matcher reads. */
export interface KeyInput {
  readonly type: string;
  readonly key: string;
  readonly control: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
  readonly meta: boolean;
  readonly isAutoRepeat: boolean;
}

export interface ParsedAccelerator {
  readonly control: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
  /** Lower case: "n", "1", ",", "/", "up". */
  readonly key: string;
}

const MODIFIERS = new Map<string, "control" | "shift" | "alt">([
  ["alt", "alt"],
  ["cmdorctrl", "control"],
  ["commandorcontrol", "control"],
  ["control", "control"],
  ["ctrl", "control"],
  ["option", "alt"],
  ["shift", "shift"],
]);

/** Reads an Electron accelerator ("Shift+CommandOrControl+N") as it applies on Windows. */
export const parseAccelerator = (
  accelerator: string
): ParsedAccelerator | null => {
  const parts = accelerator.split("+");
  // "CommandOrControl+Plus" style names have no "+" key of their own; a trailing "" is a literal plus.
  const key = parts.at(-1) === "" ? "+" : parts.at(-1);
  const found = { alt: false, control: false, shift: false };

  for (const part of parts.slice(0, -1)) {
    const modifier = MODIFIERS.get(part.toLowerCase());

    if (modifier === undefined) {
      return null;
    }

    found[modifier] = true;
  }

  return key === undefined || key === ""
    ? null
    : { ...found, key: key.toLowerCase() };
};

/** DOM key names for the named keys an accelerator can hold. */
const NAMED_KEYS = new Map([
  ["arrowdown", "down"],
  ["arrowleft", "left"],
  ["arrowright", "right"],
  ["arrowup", "up"],
  [" ", "space"],
  ["enter", "enter"],
  ["escape", "esc"],
  ["backspace", "backspace"],
  ["delete", "delete"],
]);

const keyName = (key: string): string => {
  const lower = key.toLowerCase();

  return NAMED_KEYS.get(lower) ?? lower;
};

const isLetterOrDigit = (key: string): boolean => /^[a-z0-9]$/u.test(key);

/**
 * Whether a key press is the accelerator. The key is read from the layout,
 * so AltGr (which Windows reports as Ctrl+Alt) typing ń or @ never matches
 * Ctrl+Alt+N or Ctrl+Alt+Q. Punctuation that needs Shift on some layouts
 * (/ is Shift+7 on a German one) matches with or without it.
 */
export const matchesAccelerator = (
  input: KeyInput,
  accelerator: ParsedAccelerator
): boolean => {
  const key = keyName(input.key);

  const punctuation =
    !isLetterOrDigit(accelerator.key) && accelerator.key.length === 1;

  return (
    key === accelerator.key &&
    input.control === accelerator.control &&
    input.alt === accelerator.alt &&
    (punctuation || input.shift === accelerator.shift)
  );
};

/**
 * Plain Ctrl+C, V, X, Z, Y and A stay with the page: in a text field they
 * edit as usual, and the shelf answers them itself outside one.
 */
const EDIT_KEYS = new Set(["a", "c", "v", "x", "y", "z"]);

const isEditKey = (accelerator: ParsedAccelerator): boolean =>
  accelerator.control &&
  !accelerator.shift &&
  !accelerator.alt &&
  EDIT_KEYS.has(accelerator.key);

/** The menu entries this matcher reads; Electron's MenuItem has them all, with MenuItem children. */
export interface MenuNode<Child> {
  readonly accelerator?: string | null;
  readonly registerAccelerator?: boolean;
  readonly enabled?: boolean;
  readonly visible?: boolean;
  readonly submenu?: { readonly items: readonly Child[] } | null;
}

/**
 * The menu entry a key press runs, or null. Entries that show a key but
 * leave it to the page (Return, Space, ⌫) are skipped, as are disabled ones.
 */
export const menuEntryForKey = <T extends MenuNode<T>>(
  items: readonly T[],
  input: KeyInput
): T | null => {
  if (
    input.type !== "keyDown" ||
    input.isAutoRepeat ||
    input.meta ||
    !input.control
  ) {
    return null;
  }

  for (const item of items) {
    const children = item.submenu?.items ?? [];

    const nested =
      children.length > 0 ? menuEntryForKey(children, input) : null;

    if (nested !== null) {
      return nested;
    }

    const parsed =
      item.accelerator === undefined || item.accelerator === null
        ? null
        : parseAccelerator(item.accelerator);

    if (
      parsed !== null &&
      item.registerAccelerator !== false &&
      item.enabled !== false &&
      !isEditKey(parsed) &&
      matchesAccelerator(input, parsed)
    ) {
      return item;
    }
  }

  return null;
};

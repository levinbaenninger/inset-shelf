import { keyText, shortcutLabels, TOGGLE_ACCELERATOR } from "./shortcut";

/** One line of the Keyboard Shortcuts sheet: what it does and its keys, as this system writes them. */
export interface ShortcutRow {
  readonly label: string;
  /** Alternatives, each shown as its own key cap group. */
  readonly keys: readonly string[];
}

export interface ShortcutGroup {
  readonly title: string;
  readonly rows: readonly ShortcutRow[];
}

/** The pen moved off P, which now picks the Pin tool. */
export const DRAWING_TOOL_KEYS = {
  arrow: "A",
  ellipse: "O",
  line: "L",
  pen: "B",
  pin: "P",
  rect: "R",
  text: "T",
} as const;

/**
 * Every key the shelf answers, for the sheet (⌘/), in the sections every
 * Inset app lists: Capture, Navigate, Edit, Fields, Pins, Window (the
 * drawing tools sit with the pins, in the same window). Accelerators are
 * written as in the menus and shown for the system: ⌥⌘N on a Mac,
 * Ctrl+Alt+N on Windows.
 */
export const shortcutSheet = (mac: boolean): readonly ShortcutGroup[] => {
  const k = (accelerator: string): string => keyText(accelerator, mac);
  const labels = shortcutLabels(mac);
  const click = mac ? "⌘-click" : "Ctrl+click";

  return [
    {
      rows: [
        {
          keys: [labels.doubleShift],
          label: "Save the selected text, or show the shelf",
        },
        { keys: [k("CommandOrControl+N")], label: "New note" },
        { keys: [k("Shift+CommandOrControl+N")], label: "New section" },
        { keys: [k("Alt+CommandOrControl+N")], label: "New drawing" },
        { keys: [k("Shift+CommandOrControl+L")], label: "New window link" },
        {
          keys: [`${k("CommandOrControl+1")}–9`],
          label: "Add new items to a section",
        },
      ],
      title: "Capture",
    },
    {
      rows: [
        { keys: [k("Up"), k("Down")], label: "Select the item above or below" },
        { keys: [k("Right")], label: "Show details" },
        { keys: [k("Left"), "Esc"], label: "Back to the list" },
        { keys: [k("CommandOrControl+F")], label: "Search (try due:today)" },
        { keys: [click, "⇧-click"], label: "Pick several items" },
        { keys: [k("CommandOrControl+A")], label: "Pick every item shown" },
      ],
      title: "Navigate",
    },
    {
      rows: [
        { keys: [k("Enter")], label: "Edit the text or caption" },
        { keys: ["Space"], label: "Check off" },
        { keys: [k("CommandOrControl+C")], label: "Copy" },
        { keys: [k("Alt+CommandOrControl+C")], label: "Copy with details" },
        { keys: [k("Shift+CommandOrControl+C")], label: "Copy as list" },
        {
          keys: [k("CommandOrControl+O")],
          label: "Open, or annotate an image",
        },
        {
          keys: [k("Alt+CommandOrControl+Up"), k("Alt+CommandOrControl+Down")],
          label: "Move to the section above or below",
        },
        { keys: [k("Backspace")], label: "Delete" },
        { keys: [k("CommandOrControl+Z")], label: "Undo delete" },
      ],
      title: "Edit",
    },
    {
      rows: [
        { keys: [k("CommandOrControl+D")], label: "Description" },
        { keys: [k("Shift+CommandOrControl+S")], label: "Next steps" },
        { keys: [k("Shift+CommandOrControl+D")], label: "Due" },
        { keys: [k("Enter")], label: "Add a step, in a step" },
        { keys: [k("Backspace")], label: "Remove an empty step" },
        {
          keys: [k("CommandOrControl+Z")],
          label: "Bring back a removed step or window",
        },
      ],
      title: "Fields",
    },
    {
      rows: [
        {
          keys: [DRAWING_TOOL_KEYS.pin],
          label: "Pin tool: click to place pin 1, 2, 3…",
        },
        { keys: [k("Shift+P")], label: "Drop a pin at the pointer" },
        { keys: ["1–9"], label: "Select a pin" },
        {
          keys: [k("Up"), k("Down"), k("Left"), k("Right")],
          label: `Nudge the pin 1 px (${k("Shift")} for 10 px)`,
        },
        { keys: [k("Backspace")], label: "Remove the selected pin" },
        { keys: [DRAWING_TOOL_KEYS.pen], label: "Pen" },
        {
          keys: [DRAWING_TOOL_KEYS.line, DRAWING_TOOL_KEYS.arrow],
          label: "Line, arrow",
        },
        {
          keys: [DRAWING_TOOL_KEYS.rect, DRAWING_TOOL_KEYS.ellipse],
          label: "Rectangle, ellipse",
        },
        { keys: [DRAWING_TOOL_KEYS.text], label: "Text" },
        {
          keys: [k("CommandOrControl+Z"), mac ? "⇧⌘Z" : "Ctrl+Y"],
          label: "Undo, redo",
        },
        { keys: [k("CommandOrControl+Enter")], label: "Save to the shelf" },
      ],
      title: "Pins",
    },
    {
      rows: [
        { keys: [k(TOGGLE_ACCELERATOR)], label: "Show or hide the shelf" },
        { keys: ["Esc"], label: "Close a menu, then details, then the shelf" },
        { keys: [k("CommandOrControl+,")], label: "Settings" },
        { keys: [k("CommandOrControl+/")], label: "Keyboard Shortcuts" },
      ],
      title: "Window",
    },
  ];
};

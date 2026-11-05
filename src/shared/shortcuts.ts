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
 * Every key the shelf answers, for the sheet (⌘/). Accelerators are written
 * as in the menus and shown for the system: ⌥⌘N on a Mac, Ctrl+Alt+N on
 * Windows.
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
        { keys: [k(TOGGLE_ACCELERATOR)], label: "Show or hide the shelf" },
      ],
      title: "Anywhere",
    },
    {
      rows: [
        { keys: [k("CommandOrControl+N")], label: "New note" },
        { keys: [k("Shift+CommandOrControl+N")], label: "New section" },
        { keys: [k("Alt+CommandOrControl+N")], label: "New drawing" },
        { keys: [k("Shift+CommandOrControl+L")], label: "New window link" },
        { keys: [k("CommandOrControl+F")], label: "Search (try due:today)" },
        {
          keys: [`${k("CommandOrControl+1")}–9`],
          label: "Add new items to a section",
        },
        { keys: [k("CommandOrControl+,")], label: "Settings" },
        { keys: [k("CommandOrControl+/")], label: "Keyboard shortcuts" },
        { keys: ["Esc"], label: "Close a menu, then details, then the shelf" },
      ],
      title: "Shelf",
    },
    {
      rows: [
        { keys: [k("Up"), k("Down")], label: "Select the item above or below" },
        { keys: [k("Enter")], label: "Edit the text or note" },
        { keys: [k("Right")], label: "Show details" },
        { keys: ["Space"], label: "Check off" },
        { keys: [k("CommandOrControl+C")], label: "Copy" },
        {
          keys: [k("Alt+CommandOrControl+C")],
          label: "Copy with link and details",
        },
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
        { keys: [click, "⇧-click"], label: "Pick several items" },
        { keys: [k("CommandOrControl+A")], label: "Pick every item shown" },
      ],
      title: "Items",
    },
    {
      rows: [
        { keys: [k("CommandOrControl+D")], label: "Description" },
        { keys: [k("Shift+CommandOrControl+S")], label: "Next steps" },
        { keys: [k("Shift+CommandOrControl+D")], label: "Due date" },
        { keys: [k("Enter")], label: "Add a step, in a step" },
        { keys: [k("Backspace")], label: "Remove an empty step" },
        {
          keys: [k("CommandOrControl+Z")],
          label: "Bring back a removed step or window",
        },
        { keys: [k("Left"), "Esc"], label: "Back to the list" },
      ],
      title: "Details",
    },
    {
      rows: [
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
          keys: [DRAWING_TOOL_KEYS.pin],
          label: "Pin tool: click to place pin 1, 2, 3…",
        },
        { keys: [k("Shift+P")], label: "Drop a pin at the pointer" },
        { keys: ["1–9"], label: "Select a pin" },
        {
          keys: [k("Up"), k("Down"), k("Left"), k("Right")],
          label: `Nudge the pin (${k("Shift")} for 10 px)`,
        },
        { keys: [k("Backspace")], label: "Remove the selected pin" },
        {
          keys: [k("CommandOrControl+Z"), mac ? "⇧⌘Z" : "Ctrl+Y"],
          label: "Undo, redo",
        },
        { keys: [k("CommandOrControl+Enter")], label: "Save to the shelf" },
      ],
      title: "Drawing and annotating",
    },
  ];
};

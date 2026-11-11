import type { ItemContext } from "@shared/shelf";
import { keyText, shortcutLabels } from "@shared/shortcut";
import { DRAWING_TOOL_KEYS } from "@shared/shortcuts";
import type {
  SpotlightStep,
  TutorialHint,
  TutorialTask,
} from "@shared/tutorial";

import { HELP_URL } from "./app-menu";

/**
 * Inset Shelf's part of the in-app tutorial kit (src/main/tutorial/): its
 * checklist, one-time hints, walkthrough and example items, as plain data.
 * Keys come from the same tables as the menus and the Keyboard Shortcuts
 * sheet, written for the system: ⇧⌘L on a Mac, Ctrl+Shift+L on Windows.
 */

/** The shelf window, which holds the checklist and runs the walkthrough. */
export const HOME_PAGE = "shelf";

export const CHECKLIST_TITLE = "Getting started";

/** What the checklist says once every task is done: where it comes back from, on this system. */
export const checklistDoneText = (mac: boolean): string =>
  mac
    ? "That’s every way in. Help › Getting Started, or the menu bar icon’s menu, brings this back."
    : "That’s every way in. Getting Started in the ⋯ menu, or the notification area icon’s menu, brings this back.";

export const SHELF_TASK_IDS = {
  checkOrCopy: "check-or-copy",
  doubleShift: "double-shift",
  pinOrSketch: "pin-or-sketch",
  screenshot: "screenshot",
  windowLink: "window-link",
} as const;

const keysFor = (mac: boolean) => {
  const labels = shortcutLabels(mac);

  return {
    copy: labels.copy,
    doubleShift: labels.doubleShift,
    newDrawing: keyText("Alt+CommandOrControl+N", mac),
    pin: DRAWING_TOOL_KEYS.pin,
    save: keyText("CommandOrControl+Enter", mac),
    screenshot: labels.screenshot,
    windowLink: keyText("Shift+CommandOrControl+L", mac),
  };
};

export const shelfTasks = (mac: boolean): readonly TutorialTask[] => {
  const keys = keysFor(mac);

  return [
    {
      anchor: null,
      how: `Select text in any app, then tap Shift twice (${keys.doubleShift}). It lands here, with the page it came from.`,
      id: SHELF_TASK_IDS.doubleShift,
      keys: keys.doubleShift,
      title: "Save selected text with Double Shift",
    },
    {
      anchor: null,
      how: `Press ${keys.screenshot} and drag over an area. Click Add to Shelf on the card that appears beside the shelf.`,
      id: SHELF_TASK_IDS.screenshot,
      keys: keys.screenshot,
      title: "Capture part of the screen",
    },
    {
      anchor: "add-button",
      how: `${keys.newDrawing}, or + › New Drawing, opens a page to sketch on. To pin a spot, open an image and press ${keys.pin}. Save puts it on the shelf.`,
      id: SHELF_TASK_IDS.pinOrSketch,
      keys: keys.newDrawing,
      title: "Pin a spot or draw a sketch",
    },
    {
      anchor: "add-button",
      how: `${keys.windowLink}, or + › New Window Link, lists your open windows. Pick the ones to link, in order.`,
      id: SHELF_TASK_IDS.windowLink,
      keys: keys.windowLink,
      title: "Link a window",
    },
    {
      anchor: "item-check",
      how: `Click an item's circle or press Space to check it off. ${keys.copy} copies the selected item back.`,
      id: SHELF_TASK_IDS.checkOrCopy,
      keys: "Space",
      title: "Check off or copy an item back",
    },
  ];
};

export const shelfHints = (mac: boolean): readonly TutorialHint[] => {
  const keys = keysFor(mac);

  return [
    {
      anchor: "picker-window",
      id: "picker",
      page: "picker",
      placement: "below",
      task: SHELF_TASK_IDS.windowLink,
      text: "Click each window to link. The number on it shows its place in the link.",
      title: "Pick windows",
    },
    {
      anchor: "screenshot-card",
      id: "screenshot-card",
      page: "screenshot",
      placement: "inside",
      task: SHELF_TASK_IDS.screenshot,
      text: "Hover for Copy and Add to Shelf. Drag the card into another app to drop it as a file.",
      title: null,
    },
    {
      anchor: "pin-tool",
      id: "drawing",
      page: "drawing",
      placement: "below",
      task: null,
      text: `Press ${keys.pin} for the Pin tool, then click to place pin 1, 2, 3… ${keys.save} saves to the shelf.`,
      title: "Drop numbered pins",
    },
    {
      anchor: "details-add",
      id: "details-add",
      page: HOME_PAGE,
      placement: "below",
      task: null,
      text: "Add a description, next steps, a due date or linked windows. None of it is needed when you capture.",
      title: null,
    },
  ];
};

export const shelfSpotlight = (mac: boolean): readonly SpotlightStep[] => {
  const keys = keysFor(mac);

  return [
    {
      anchor: "shelf-list",
      id: "list",
      text: "Everything you capture lands here, in sections. Drag an item onto another section to move it.",
      title: "Your shelf",
    },
    {
      anchor: "item-source",
      id: "source",
      text: "The line under an item names the app, window or page it came from. Click it to open the page again.",
      title: "Where it came from",
    },
    {
      anchor: "composer",
      id: "composer",
      text: "Type a note or a prompt and press Return. # and a name starts a section.",
      title: "Notes and prompts",
    },
    {
      anchor: "add-button",
      id: "add",
      text: "Attach files, start a drawing or link open windows.",
      title: "The + menu",
    },
    {
      anchor: "item-check",
      id: "check",
      text: `Click the circle or press Space to check an item off. ${keys.copy} copies the selected item back.`,
      title: "Check off and copy",
    },
    {
      anchor: "shelf-menu",
      id: "menu",
      text: mac
        ? "New sections, Settings and Keyboard Shortcuts are here. The menu bar icon has them too."
        : "New sections, Settings, Help and Float on Top are here. The notification area icon has its own menu.",
      title: "Settings and more",
    },
  ];
};

export interface ExampleItem {
  readonly text: string;
  readonly context: ItemContext | null;
}

/** The first run's example items, oldest first: each one is itself a thing to try. */
export const shelfExamples = (mac: boolean): readonly ExampleItem[] => {
  const keys = keysFor(mac);

  return [
    {
      context: null,
      text: `Select any text in another app and tap Shift twice (${keys.doubleShift}) to save it here`,
    },
    {
      context: null,
      text: "Check me off: click the circle or press Space",
    },
    {
      context: null,
      text: `Copy me back with ${keys.copy}, or drag me into another app`,
    },
    {
      context: {
        app: null,
        appLink: null,
        title: "Inset Shelf: README",
        url: HELP_URL,
      },
      text: "Saved from a web page: the line below says where, and opens it again",
    },
  ];
};

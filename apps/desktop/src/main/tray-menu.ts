import { keyText, shortcutLabels, TOGGLE_ACCELERATOR } from "@shared/shortcut";

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
      /** macOS: shown next to the label; the global shortcut is registered elsewhere. */
      readonly accelerator?: string;
    };

export interface TrayModel {
  readonly mac: boolean;
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
  /**
   * Windows draws an accelerator from the key's place on a US keyboard
   * (Ctrl+§ for Ctrl+/ on a Swiss one) and in its own words (Ctrl+Comma,
   * Alt+Ctrl+S), and its menus can't set that text. There the keys go after
   * the label, written as the shelf's menu and shortcut sheet write them.
   */
  const withKeys = (label: string, accelerator: string) => {
    if (!model.shortcutsRegistered) {
      return { label };
    }

    return model.mac
      ? { accelerator, label }
      : { label: `${label} (${keyText(accelerator, false)})` };
  };

  return [
    {
      action: "toggleShelf",
      kind: "item",
      ...withKeys(
        model.shelfVisible ? "Hide Inset Shelf" : "Show Inset Shelf",
        TOGGLE_ACCELERATOR
      ),
    },
    SEPARATOR,
    {
      action: "openSettings",
      kind: "item",
      ...withKeys("Settings…", "CommandOrControl+,"),
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
      ...withKeys("Keyboard Shortcuts", "CommandOrControl+/"),
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

/**
 * How the shelf last lost the keyboard: when, and whether the focus has been
 * with the Windows shell (the taskbar or the hidden icons' flyout) alone
 * since, rather than with a window of the user's.
 */
export interface ShelfLeft {
  readonly at: number;
  readonly toShell: boolean;
}

/** What has the focus: the taskbar or its flyout, or any other window. */
export type FrontKind = "shell" | "other";

/**
 * Pressing the icon gives the taskbar the focus before the click arrives,
 * and opening the hidden icons' flyout takes it too; the icon is clicked
 * within this after the shelf lost the focus.
 */
const REACH_MS = 5000;

/** How often the focus is looked at while the icon may still be clicked. */
const SAMPLE_MS = 150;

/**
 * What a click on the Windows notification-area icon does: it shows a hidden
 * shelf, brings forward one that is visible but not in front, and hides it
 * only when it was in front. The click itself takes the focus from the
 * shelf, so a shelf that lost it to the shell, on the press or on the way
 * to the icon, still counts as in front. One that lost it to a window of
 * the user's does not, however soon the click follows.
 */
export const iconClick = (state: {
  readonly visible: boolean;
  readonly focused: boolean;
  readonly left: ShelfLeft | null;
  readonly now: number;
}): "show" | "focus" | "hide" => {
  if (!state.visible) {
    return "show";
  }

  if (state.focused) {
    return "hide";
  }

  const { left, now } = state;

  return left !== null && left.toShell && now - left.at < REACH_MS
    ? "hide"
    : "focus";
};

/**
 * Looks at what has the focus after the shelf lost it, until the icon can no
 * longer have been clicked for it, and says when a window of the user's had
 * it: the shelf then isn't what the click leaves, whatever has the focus
 * when the click arrives. A look that finds no window in front says nothing.
 */
export const followFocus = async (deps: {
  /** When the shelf lost the focus. */
  readonly at: number;
  /** False once the shelf has the focus again or has lost it anew. */
  readonly away: () => boolean;
  readonly leftOther: () => void;
  readonly now: () => number;
  readonly probe: () => Promise<FrontKind | null>;
  readonly wait: (ms: number) => Promise<void>;
}): Promise<void> => {
  if (!deps.away() || deps.now() - deps.at >= REACH_MS) {
    return;
  }

  const kind = await deps.probe().catch(() => null);

  if (kind === "other") {
    deps.leftOther();

    return;
  }

  await deps.wait(SAMPLE_MS);

  await followFocus(deps);
};

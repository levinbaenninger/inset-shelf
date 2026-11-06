import { isAppChord, pressesAccelerator } from "@shared/menus";
import type { KeyboardEvent } from "react";

import { isMac } from "@/shared/platform";

/**
 * Keys inside any open menu, read in the capture phase before the menu
 * library sees them. A key an entry shows runs that entry, whichever one is
 * highlighted. Any other app shortcut stops here, so it never reaches the
 * list, the open entry or the menu bar. Return, Space, the arrows, Esc and
 * typing go on to the menu, which moves and chooses with them.
 */
export const answerMenuKey = (event: KeyboardEvent<HTMLElement>): void => {
  if (event.isPropagationStopped() || event.nativeEvent.isComposing) {
    return;
  }

  const shown = event.repeat
    ? undefined
    : [
        ...event.currentTarget.querySelectorAll<HTMLElement>(
          "[data-accelerator]"
        ),
      ].find(
        (entry) =>
          entry.dataset.disabled === undefined &&
          pressesAccelerator(event, entry.dataset.accelerator ?? "", isMac)
      );

  if (shown !== undefined) {
    event.preventDefault();
    event.stopPropagation();
    shown.click();

    return;
  }

  if (isAppChord(event, isMac)) {
    event.preventDefault();
    event.stopPropagation();
  }
};

let openMenus = 0;
let onChange: ((open: boolean) => void) | null = null;

/** Tells main when the first menu opens and the last one closes, so it holds back the menu bar's keys meanwhile. */
export const onMenusOpen = (listener: (open: boolean) => void): void => {
  onChange = listener;
};

/** A menu is open until the returned function is called. */
export const holdMenuOpen = (): (() => void) => {
  let held = true;

  openMenus += 1;

  if (openMenus === 1) {
    onChange?.(true);
  }

  return () => {
    if (!held) {
      return;
    }

    held = false;
    openMenus -= 1;

    if (openMenus === 0) {
      onChange?.(false);
    }
  };
};

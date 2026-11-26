import type { BrowserWindow } from "electron";

import { hideWindow } from "./hide-window";

/**
 * How the pill's window takes the keyboard for the why field and gives it
 * back, kept apart from the reducer (src/shared/pill.ts), which only says
 * when. The pill is a non-activating panel on macOS, so taking the keyboard
 * makes it the key window while the app in front stays active: no app
 * switch, no Space change.
 *
 * Measured in a prototype on macOS 27.2 with Electron 45.2.1 (plan
 * recall-and-say-why.md, section 1): focus() and webContents.focus() made the
 * panel key in 15 of 15 runs, but a real key reached the page in only 13 of
 * 15, cause unknown. setFocusable(false) alone left the panel key in 2 of 4
 * runs, so the window lets go of the keyboard first. Not verified yet:
 * Windows, a hidden app, full screen and another Space. The 300 ms fallback
 * in the reducer covers each of them.
 */

/** The pill's window becomes key and its page gets the keyboard. */
export const takeKeys = (window: BrowserWindow): void => {
  window.setIgnoreMouseEvents(false);
  window.setFocusable(true);
  window.focus();
  window.webContents.focus();
};

/**
 * The window lets go of the keyboard, then can't take it again until the
 * next takeKeys. On Windows, hideWindow hands activation to the window below;
 * the reducer shows the pill again inactive where it needs to.
 */
export const giveKeys = (
  window: BrowserWindow,
  options: { readonly raise: () => void }
): void => {
  if (process.platform === "win32") {
    hideWindow(window, options);
  } else {
    window.blur();
  }

  window.setFocusable(false);
};

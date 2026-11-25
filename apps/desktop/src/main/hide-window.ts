import type { BrowserWindow } from "electron";

export interface HideOptions {
  /** Puts the window back at its always-on-top level. */
  readonly raise: () => void;
  /** Gives the keyboard to another Inset window, if one should have it; true when it did. */
  readonly handOff?: () => boolean;
}

/**
 * Hides a window. On Windows, Chromium hides a window without activating
 * another, so the hidden window would keep the keyboard: typing would go
 * nowhere and the next shortcut would miss. Unless another Inset window takes
 * the keyboard, blurring it first hands activation to the visible window
 * below it. An always-on-top window would hand it to the taskbar, so it
 * leaves that band first and goes back once it is hidden.
 */
export const hideWindow = (
  window: BrowserWindow,
  options: HideOptions
): void => {
  if (
    process.platform !== "win32" ||
    !window.isFocused() ||
    options.handOff?.() === true
  ) {
    window.hide();

    return;
  }

  const onTop = window.isAlwaysOnTop();

  if (onTop) {
    window.setAlwaysOnTop(false);
  }

  window.blur();
  window.hide();

  if (onTop) {
    options.raise();
  }
};

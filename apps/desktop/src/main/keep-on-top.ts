import type { BrowserWindow } from "electron";

/** Long enough for Windows to finish handing the window the keyboard. */
const SETTLE_MS = 100;

/**
 * On Windows, Chromium can take a floating window out of the topmost band
 * when a system overlay that took the keyboard from it closes again, as
 * Snipping Tool's (Win+Shift+S) does: the shelf then falls behind the app
 * in front. Once the window has the keyboard back, it returns to its level.
 */
export const keepOnTop = (
  window: BrowserWindow,
  options: {
    /** Puts the window at its always-on-top level. */
    readonly raise: () => void;
    /** Whether it should float at all (Float on Top). */
    readonly wanted: () => boolean;
  }
): void => {
  if (process.platform !== "win32") {
    return;
  }

  window.on("focus", () => {
    setTimeout(() => {
      if (
        !window.isDestroyed() &&
        window.isVisible() &&
        options.wanted() &&
        !window.isAlwaysOnTop()
      ) {
        // Setting the same level again does nothing; it has to be left first.
        window.setAlwaysOnTop(false);
        options.raise();
      }
    }, SETTLE_MS);
  });
};

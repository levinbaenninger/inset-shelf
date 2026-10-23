import { nativeTheme } from "electron";
import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  TitleBarOverlay,
} from "electron";

export const isWindows = process.platform === "win32";

/** The page's background and text colours (styles.css), so the buttons sit on the page's header. */
const overlay = (height: number): TitleBarOverlay =>
  nativeTheme.shouldUseDarkColors
    ? { color: "#0a0a0a", height, symbolColor: "#fafafa" }
    : { color: "#ffffff", height, symbolColor: "#0a0a0a" };

/**
 * On Windows the window has no title bar, icon or name: only its caption
 * buttons, drawn over the top `height` DIP of the page, which keeps clear of
 * them with the `caption-clear` class. Elsewhere the window keeps its frame.
 */
export const captionButtons = (
  height: number
): Pick<BrowserWindowConstructorOptions, "titleBarOverlay"> => ({
  titleBarOverlay: isWindows ? overlay(height) : false,
});

/** Recolours the caption buttons when the system theme changes. */
export const followThemeInCaption = (
  window: BrowserWindow,
  height: number
): void => {
  if (!isWindows) {
    return;
  }

  nativeTheme.on("updated", () => {
    if (!window.isDestroyed()) {
      window.setTitleBarOverlay(overlay(height));
    }
  });
};

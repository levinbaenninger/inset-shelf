import { app, BrowserWindow, nativeTheme, screen } from "electron";
import type { WebContents } from "electron";

import { followThemeInCaption, headerChrome } from "./caption-buttons";
import { hideWindow } from "./hide-window";
import { keepOnTop } from "./keep-on-top";
import { harden, secureWebPreferences } from "./window-security";

const WIDTH = 600;
const HEIGHT = 520;

const isMac = process.platform === "darwin";

export interface PickerWindow {
  readonly webContents: WebContents;
  readonly load: () => Promise<void>;
  /** Opens in the middle of the display under the pointer, like New Drawing. */
  readonly open: () => void;
  readonly close: () => void;
  readonly isFocused: () => boolean;
  readonly isVisible: () => boolean;
  /** The window's own capture id, so it never lists itself. */
  readonly mediaSourceId: () => string;
}

/** The window-link picker: a regular window, above the floating shelf, closed once windows are picked. */
export const createPickerWindow = (options: {
  readonly preload: string;
  readonly url: string;
  /** Gives the keyboard back to the shelf when it is open; true when it did. */
  readonly handOff: () => boolean;
}): PickerWindow => {
  const window = new BrowserWindow({
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff",
    fullscreenable: false,
    height: HEIGHT,
    maximizable: false,
    minHeight: 360,
    minWidth: 440,
    minimizable: false,
    show: false,
    title: "New Window Link",
    ...headerChrome(),
    useContentSize: true,
    webPreferences: secureWebPreferences(options.preload),
    width: WIDTH,
  });

  const raise = (): void => {
    window.setAlwaysOnTop(true, "floating", 1);
  };

  raise();
  keepOnTop(window, { raise, wanted: () => true });
  harden(window.webContents, "picker");
  followThemeInCaption(window);

  window.on("close", (event) => {
    event.preventDefault();
    hideWindow(window, { handOff: options.handOff, raise });
  });

  return {
    close: () => {
      hideWindow(window, { handOff: options.handOff, raise });
    },
    isFocused: () =>
      !window.isDestroyed() && window.isVisible() && window.isFocused(),
    // Asked by the tutorial while the app quits, too: a destroyed window throws.
    isVisible: () => !window.isDestroyed() && window.isVisible(),
    load: async () => {
      await window.loadURL(options.url);
    },
    mediaSourceId: () => window.getMediaSourceId(),
    open: () => {
      const { workArea } = screen.getDisplayNearestPoint(
        screen.getCursorScreenPoint()
      );

      window.setContentBounds({
        height: HEIGHT,
        width: WIDTH,
        x: Math.round(workArea.x + (workArea.width - WIDTH) / 2),
        y: Math.round(workArea.y + (workArea.height - HEIGHT) / 3),
      });

      if (isMac) {
        app.show();
      }

      window.show();
      window.focus();
    },
    webContents: window.webContents,
  };
};

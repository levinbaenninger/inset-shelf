import { app, BrowserWindow, nativeTheme } from "electron";
import type { WebContents } from "electron";

import {
  captionButtons,
  followThemeInCaption,
  isWindows,
} from "./caption-buttons";
import { hideWindow } from "./hide-window";
import { harden, secureWebPreferences } from "./window-security";

const WIDTH = 460;

/** The strip at the top of the page under the Windows close button (settings-app.tsx). */
const CAPTION_DIP = 36;

// Elsewhere there is no Dock choice, but a caption strip and the About lines.
const HEIGHT = process.platform === "darwin" ? 330 : 250;

export interface SettingsWindow {
  readonly webContents: WebContents;
  readonly load: () => Promise<void>;
  readonly open: () => void;
  readonly close: () => void;
  readonly isFocused: () => boolean;
}

/** A small, fixed-size settings window, like a Mac app's Settings, kept above the shelf. */
export const createSettingsWindow = (options: {
  readonly preload: string;
  readonly url: string;
  /** Gives the keyboard back to the shelf when it is open; true when it did. */
  readonly handOff: () => boolean;
}): SettingsWindow => {
  const window = new BrowserWindow({
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff",
    fullscreenable: false,
    height: HEIGHT,
    maximizable: false,
    minimizable: false,
    resizable: false,
    show: false,
    title: "Settings",
    titleBarStyle: isWindows ? "hidden" : "default",
    ...captionButtons(CAPTION_DIP),
    useContentSize: true,
    webPreferences: secureWebPreferences(options.preload),
    width: WIDTH,
  });

  harden(window.webContents, "settings");
  followThemeInCaption(window, CAPTION_DIP);

  // One level above the floating shelf, which would otherwise cover it.
  const raise = (): void => {
    window.setAlwaysOnTop(true, "floating", 1);
  };

  raise();

  window.on("close", (event) => {
    event.preventDefault();
    hideWindow(window, { handOff: options.handOff, raise });
  });

  return {
    close: () => {
      hideWindow(window, { handOff: options.handOff, raise });
    },
    isFocused: () => window.isVisible() && window.isFocused(),
    load: async () => {
      await window.loadURL(options.url);
    },
    open: () => {
      if (!window.isVisible()) {
        // On Windows the app menu, attached and hidden after the window was made, changes its size.
        window.setContentSize(WIDTH, HEIGHT);
        window.center();
      }

      if (process.platform === "darwin") {
        app.show();
      }

      window.show();
      window.focus();
    },
    webContents: window.webContents,
  };
};

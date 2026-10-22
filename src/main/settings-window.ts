import { app, BrowserWindow, nativeTheme } from "electron";
import type { WebContents } from "electron";

import { harden, secureWebPreferences } from "./window-security";

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
}): SettingsWindow => {
  const window = new BrowserWindow({
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff",
    fullscreenable: false,
    height: 330,
    maximizable: false,
    minimizable: false,
    resizable: false,
    show: false,
    title: "Settings",
    useContentSize: true,
    webPreferences: secureWebPreferences(options.preload),
    width: 460,
  });

  harden(window.webContents, "settings");
  // One level above the floating shelf, which would otherwise cover it.
  window.setAlwaysOnTop(true, "floating", 1);

  window.on("close", (event) => {
    event.preventDefault();
    window.hide();
  });

  return {
    close: () => {
      window.hide();
    },
    isFocused: () => window.isVisible() && window.isFocused(),
    load: async () => {
      await window.loadURL(options.url);
    },
    open: () => {
      if (!window.isVisible()) {
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

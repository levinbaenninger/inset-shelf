import { app, BrowserWindow, nativeTheme } from "electron";
import type { WebContents } from "electron";

import { harden, secureWebPreferences } from "./window-security";

export interface SettingsWindow {
  readonly webContents: WebContents;
  readonly load: () => Promise<void>;
  readonly open: () => void;
}

/** A small, fixed-size settings window, like a Mac app's Settings. */
export const createSettingsWindow = (options: {
  readonly preload: string;
  readonly url: string;
}): SettingsWindow => {
  const window = new BrowserWindow({
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff",
    fullscreenable: false,
    height: 300,
    maximizable: false,
    minimizable: false,
    resizable: false,
    show: false,
    title: "Settings",
    webPreferences: secureWebPreferences(options.preload),
    width: 460,
  });

  harden(window.webContents, "settings");

  window.on("close", (event) => {
    event.preventDefault();
    window.hide();
  });

  return {
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

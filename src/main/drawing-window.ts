import { app, BrowserWindow, nativeTheme, screen } from "electron";
import type { WebContents } from "electron";

import { harden, secureWebPreferences } from "./window-security";

const WIDTH = 760;
const HEIGHT = 560;

export interface DrawingWindow {
  readonly webContents: WebContents;
  readonly load: () => Promise<void>;
  /** Opens a blank canvas in the middle of the display under the pointer. */
  readonly open: () => void;
  readonly close: () => void;
  readonly onReset: (listener: () => void) => void;
  readonly allowClose: () => void;
}

const ignore = (): void => undefined;

/** A regular window for one drawing; closing it throws the drawing away. */
export const createDrawingWindow = (options: {
  readonly preload: string;
  readonly url: string;
}): DrawingWindow => {
  let closable = false;
  let onReset: () => void = ignore;

  const window = new BrowserWindow({
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff",
    fullscreenable: false,
    height: HEIGHT,
    minHeight: 360,
    minWidth: 480,
    show: false,
    title: "New Drawing",
    webPreferences: secureWebPreferences(options.preload),
    width: WIDTH,
  });

  // Above the floating shelf, so the canvas is never behind it.
  window.setAlwaysOnTop(true, "floating");
  harden(window.webContents, "drawing");

  window.on("close", (event) => {
    if (!closable) {
      event.preventDefault();
      window.hide();
    }
  });

  return {
    allowClose: () => {
      closable = true;
    },
    close: () => {
      window.hide();
    },
    load: async () => {
      await window.loadURL(options.url);
    },
    onReset: (listener) => {
      onReset = listener;
    },
    open: () => {
      const { workArea } = screen.getDisplayNearestPoint(
        screen.getCursorScreenPoint()
      );

      onReset();
      window.setBounds({
        height: HEIGHT,
        width: WIDTH,
        x: Math.round(workArea.x + (workArea.width - WIDTH) / 2),
        y: Math.round(workArea.y + (workArea.height - HEIGHT) / 3),
      });

      if (process.platform === "darwin") {
        app.show();
      }

      window.show();
      window.focus();
    },
    webContents: window.webContents,
  };
};

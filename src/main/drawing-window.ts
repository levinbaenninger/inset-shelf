import { app, BrowserWindow, dialog, nativeTheme, screen } from "electron";
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
  /** Closes like the window's close button, asking first when there are marks. */
  readonly requestClose: () => void;
  readonly setDirty: (dirty: boolean) => void;
  readonly isFocused: () => boolean;
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
  let dirty = false;
  let onReset: () => void = ignore;

  const window = new BrowserWindow({
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff",
    fullscreenable: false,
    height: HEIGHT,
    minHeight: 360,
    minWidth: 480,
    show: false,
    title: "New Drawing",
    // The page's own header holds the traffic lights, centred in its 48 points.
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: secureWebPreferences(options.preload),
    width: WIDTH,
  });

  // Above the floating shelf, so the canvas is never behind it.
  window.setAlwaysOnTop(true, "floating", 1);
  harden(window.webContents, "drawing");

  /** A sheet on the window, which, unlike an app-modal alert, keeps the window's level. */
  const confirmDiscard = async (): Promise<void> => {
    const { response } = await dialog.showMessageBox(window, {
      buttons: ["Discard", "Cancel"],
      cancelId: 1,
      defaultId: 1,
      message: "Discard this drawing?",
      type: "warning",
    });

    if (response === 0) {
      window.hide();
    }
  };

  window.on("close", (event) => {
    if (closable) {
      return;
    }

    event.preventDefault();

    if (dirty) {
      void confirmDiscard();
    } else {
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
    isFocused: () => window.isVisible() && window.isFocused(),
    requestClose: () => {
      window.close();
    },
    setDirty: (next) => {
      dirty = next;
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

      dirty = false;
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

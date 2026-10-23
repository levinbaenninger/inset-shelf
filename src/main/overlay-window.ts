import type { OverlayView } from "@shared/contracts";
import type { DisplaySnapshot } from "@shared/geometry";
import { app, BrowserWindow } from "electron";
import type { WebContents } from "electron";

import { hideWindow } from "./hide-window";
import { harden, secureWebPreferences } from "./window-security";

const isMac = process.platform === "darwin";

export interface OverlayWindow {
  readonly webContents: WebContents;
  readonly load: () => Promise<void>;
  /** Covers the whole display, menu bar and Dock included, with the frozen frame. */
  readonly show: (display: DisplaySnapshot, view: OverlayView) => void;
  readonly hide: () => void;
  readonly isVisible: () => boolean;
  readonly onBlur: (listener: () => void) => void;
  readonly allowClose: () => void;
  readonly view: () => OverlayView | null;
  readonly onView: (listener: (view: OverlayView | null) => void) => void;
}

export interface OverlayOptions {
  readonly preload: string;
  readonly url: string;
}

const ignore = (): void => undefined;

export const createOverlayWindow = (options: OverlayOptions): OverlayWindow => {
  let current: OverlayView | null = null;
  let closable = false;
  let blurListener: () => void = ignore;
  let viewListener: (view: OverlayView | null) => void = ignore;

  const window = new BrowserWindow({
    backgroundColor: "#000000",
    enableLargerThanScreen: true,
    frame: false,
    fullscreenable: false,
    hasShadow: false,
    height: 600,
    movable: false,
    resizable: false,
    roundedCorners: false,
    show: false,
    skipTaskbar: true,
    title: "Inset Shelf area",
    type: isMac ? "panel" : undefined,
    webPreferences: secureWebPreferences(options.preload),
    width: 800,
  });

  // Above the menu bar and the Dock, which a "floating" window stays below.
  const raise = (): void => {
    window.setAlwaysOnTop(true, "screen-saver");
  };

  raise();
  window.setVisibleOnAllWorkspaces(true, {
    skipTransformProcessType: true,
    visibleOnFullScreen: true,
  });
  harden(window.webContents, "overlay");

  window.on("blur", () => {
    if (window.isVisible()) {
      blurListener();
    }
  });

  window.on("close", (event) => {
    if (!closable) {
      event.preventDefault();
      blurListener();
    }
  });

  const setView = (view: OverlayView | null): void => {
    current = view;
    viewListener(view);
  };

  return {
    allowClose: () => {
      closable = true;
    },
    hide: () => {
      if (window.isVisible()) {
        hideWindow(window, { raise });
      }

      setView(null);
    },
    isVisible: () => window.isVisible(),
    load: async () => {
      await window.loadURL(options.url);
    },
    onBlur: (listener) => {
      blurListener = listener;
    },
    onView: (listener) => {
      viewListener = listener;
    },
    show: (display, view) => {
      const { height, width, x, y } = display.bounds;

      setView(view);
      window.setBounds({ height, width, x, y });

      if (isMac) {
        app.show();
      }

      window.show();
      window.focus();
    },
    view: () => current,
    webContents: window.webContents,
  };
};

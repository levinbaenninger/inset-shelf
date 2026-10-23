import type { ToastView } from "@shared/contracts";
import { BrowserWindow, nativeTheme, screen } from "electron";
import type { WebContents } from "electron";

import { harden, secureWebPreferences } from "./window-security";

const WIDTH = 320;
const HEIGHT = 64;
const MARGIN = 12;
const VISIBLE_MS = 1800;

export interface ToastWindow {
  readonly webContents: WebContents;
  readonly load: () => Promise<void>;
  /** Shows a short confirmation without taking focus or mouse input. */
  readonly show: (title: string, detail: string) => void;
  readonly hide: () => void;
  readonly view: () => ToastView | null;
  readonly onView: (listener: (view: ToastView) => void) => void;
  readonly allowClose: () => void;
}

const ignore = (): void => undefined;

export const createToastWindow = (options: {
  readonly preload: string;
  readonly url: string;
}): ToastWindow => {
  let current: ToastView | null = null;
  let seq = 0;
  let timer: NodeJS.Timeout | undefined;
  let closable = false;
  let listener: (view: ToastView) => void = ignore;

  const window = new BrowserWindow({
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#171717" : "#ffffff",
    focusable: false,
    frame: false,
    hasShadow: true,
    height: HEIGHT,
    resizable: false,
    show: false,
    skipTaskbar: true,
    type: process.platform === "darwin" ? "panel" : undefined,
    webPreferences: secureWebPreferences(options.preload),
    width: WIDTH,
  });

  window.setAlwaysOnTop(true, "pop-up-menu");
  window.setVisibleOnAllWorkspaces(true, {
    skipTransformProcessType: true,
    visibleOnFullScreen: true,
  });
  window.setIgnoreMouseEvents(true);
  harden(window.webContents, "toast");

  window.on("close", (event) => {
    if (!closable) {
      event.preventDefault();
    }
  });

  const hide = (): void => {
    clearTimeout(timer);

    if (window.isVisible()) {
      window.hide();
    }
  };

  return {
    allowClose: () => {
      closable = true;
    },
    hide,
    load: async () => {
      await window.loadURL(options.url);
    },
    onView: (next) => {
      listener = next;
    },
    show: (title, detail) => {
      const { workArea } = screen.getDisplayNearestPoint(
        screen.getCursorScreenPoint()
      );

      seq += 1;
      current = { detail, seq, title };
      listener(current);
      window.setBounds({
        height: HEIGHT,
        width: WIDTH,
        x: workArea.x + workArea.width - WIDTH - MARGIN,
        y: workArea.y + MARGIN,
      });
      window.showInactive();
      clearTimeout(timer);
      timer = setTimeout(hide, VISIBLE_MS);
    },
    view: () => current,
    webContents: window.webContents,
  };
};

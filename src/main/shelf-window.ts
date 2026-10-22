import { dockShelf, rect, SHELF_MIN_HEIGHT_DIP } from "@shared/geometry";
import type { Rect } from "@shared/geometry";
import { app, BrowserWindow, screen } from "electron";
import type { Menu, Rectangle, WebContents } from "electron";

import { harden, secureWebPreferences } from "./window-security";

const MIN_WIDTH = 300;

const isMac = process.platform === "darwin";

export interface ShelfWindow {
  readonly webContents: WebContents;
  readonly load: () => Promise<void>;
  readonly isVisible: () => boolean;
  readonly isFocused: () => boolean;
  /** Docks to the given window, or opens at the top right without one. */
  readonly show: (target: Rect<"screen"> | null) => void;
  /** Hides and hands focus back to the app that was in front. */
  readonly hide: () => void;
  readonly onShown: (listener: (bounds: Rectangle) => void) => void;
  readonly onHidden: (listener: () => void) => void;
  readonly allowClose: () => void;
  /** On by default; the Window menu turns it off. */
  readonly setFloatOnTop: (on: boolean) => void;
  /** Opens a native menu at a point inside the shelf. */
  readonly popup: (menu: Menu, x: number, y: number) => void;
}

export interface ShelfWindowOptions {
  readonly preload: string;
  readonly url: string;
  /** Another Inset window is on screen, so app.hide() would hide it too. */
  readonly otherWindowVisible: () => boolean;
}

const ignore = (): void => undefined;

const toRect = (bounds: Rectangle): Rect<"screen"> =>
  rect(bounds.x, bounds.y, bounds.width, bounds.height);

const placement = (target: Rect<"screen"> | null): Rectangle => {
  const display =
    target === null
      ? screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      : screen.getDisplayMatching(target);

  return dockShelf(target, toRect(display.workArea));
};

/**
 * A window beside the window in front. It stays above other windows,
 * on every Space, until it is hidden on purpose; macOS draws its translucent
 * sidebar material behind the content.
 */
export const createShelfWindow = (options: ShelfWindowOptions): ShelfWindow => {
  let closable = false;
  let onShown: (bounds: Rectangle) => void = ignore;
  let onHidden: () => void = ignore;

  const window = new BrowserWindow({
    backgroundColor: isMac ? "#00000000" : undefined,
    frame: false,
    fullscreenable: false,
    hasShadow: true,
    maximizable: false,
    minHeight: SHELF_MIN_HEIGHT_DIP,
    minWidth: MIN_WIDTH,
    minimizable: false,
    show: false,
    skipTaskbar: true,
    title: "Inset Shelf",
    transparent: isMac,
    vibrancy: isMac ? "sidebar" : undefined,
    visualEffectState: isMac ? "active" : undefined,
    webPreferences: secureWebPreferences(options.preload),
    ...placement(null),
  });

  // "floating" sits above normal windows and below menus and the Dock.
  window.setAlwaysOnTop(true, "floating");
  window.setVisibleOnAllWorkspaces(true, {
    skipTransformProcessType: true,
    visibleOnFullScreen: true,
  });
  harden(window.webContents, "shelf");

  const hide = (): void => {
    if (!window.isVisible()) {
      return;
    }

    window.hide();

    if (isMac && !options.otherWindowVisible()) {
      app.hide();
    }

    onHidden();
  };

  window.on("close", (event) => {
    if (!closable) {
      event.preventDefault();
      hide();
    }
  });

  window.webContents.on("render-process-gone", () => {
    if (!window.isDestroyed()) {
      window.reload();
    }
  });

  return {
    allowClose: () => {
      closable = true;
    },
    hide,
    isFocused: () => window.isVisible() && window.isFocused(),
    isVisible: () => window.isVisible(),
    load: async () => {
      await window.loadURL(options.url);
    },
    onHidden: (listener) => {
      onHidden = listener;
    },
    onShown: (listener) => {
      onShown = listener;
    },
    setFloatOnTop: (on) => {
      window.setAlwaysOnTop(on, "floating");
    },
    popup: (menu, x, y) => {
      menu.popup({ window, x: Math.round(x), y: Math.round(y) });
    },
    show: (target) => {
      window.setBounds(placement(target));

      if (isMac) {
        app.show();
      }

      window.show();
      window.focus();
      onShown(window.getBounds());
    },
    webContents: window.webContents,
  };
};

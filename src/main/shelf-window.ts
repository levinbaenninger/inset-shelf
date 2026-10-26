import {
  dockShelf,
  rect,
  SHELF_MIN_HEIGHT_DIP,
  WINDOWS_FRAME_INSET_DIP,
} from "@shared/geometry";
import type { Rect } from "@shared/geometry";
import { app, BrowserWindow, screen } from "electron";
import type { Rectangle, WebContents } from "electron";

import { hideWindow } from "./hide-window";
import { keepOnTop } from "./keep-on-top";
import { harden, secureWebPreferences } from "./window-security";

const MIN_WIDTH = 300;

const isMac = process.platform === "darwin";

/**
 * Windows rounds a window by 8 px at most. The shelf's window is
 * transparent there, so the page can draw a panel whose corners match the
 * fields inside it.
 */
const ownsCorners = isMac || process.platform === "win32";

export interface ShelfWindow {
  readonly webContents: WebContents;
  readonly load: () => Promise<void>;
  readonly isVisible: () => boolean;
  readonly isFocused: () => boolean;
  /** Where the shelf is on screen, or null while it is hidden. */
  readonly bounds: () => Rectangle | null;
  /** Docks to the given window, or opens at the right, centred, without one. */
  readonly show: (target: Rect<"screen"> | null) => void;
  /** Hides and hands focus back to the app that was in front. */
  readonly hide: () => void;
  readonly onShown: (listener: (bounds: Rectangle) => void) => void;
  readonly onHidden: (listener: () => void) => void;
  /** Gives the shelf the keyboard, when another Inset window closes over it. */
  readonly focus: () => void;
  /** The window a file dialog belongs to, so it opens above the shelf. */
  readonly dialogParent: BrowserWindow;
  readonly allowClose: () => void;
  /** On by default; the Window menu turns it off. */
  readonly setFloatOnTop: (on: boolean) => void;
}

export interface ShelfWindowOptions {
  readonly preload: string;
  readonly url: string;
}

const ignore = (): void => undefined;

const toRect = (bounds: Rectangle): Rect<"screen"> =>
  rect(bounds.x, bounds.y, bounds.width, bounds.height);

const placement = (target: Rect<"screen"> | null): Rectangle => {
  const display =
    target === null
      ? screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      : screen.getDisplayMatching(target);

  return dockShelf(
    target,
    toRect(display.workArea),
    process.platform === "win32" ? WINDOWS_FRAME_INSET_DIP : 0
  );
};

/**
 * A window beside the window in front. It stays above other windows,
 * on every Space, until it is hidden on purpose; macOS draws its translucent
 * sidebar material behind the content, and on Windows the page draws its own
 * rounded panel.
 */
export const createShelfWindow = (options: ShelfWindowOptions): ShelfWindow => {
  let closable = false;
  let floating = true;
  let onShown: (bounds: Rectangle) => void = ignore;
  let onHidden: () => void = ignore;

  const window = new BrowserWindow({
    backgroundColor: ownsCorners ? "#00000000" : undefined,
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
    transparent: ownsCorners,
    vibrancy: isMac ? "sidebar" : undefined,
    visualEffectState: isMac ? "active" : undefined,
    webPreferences: secureWebPreferences(options.preload),
    ...placement(null),
  });

  // "floating" sits above normal windows and below menus and the Dock.
  const raise = (): void => {
    window.setAlwaysOnTop(true, "floating");
  };

  raise();
  keepOnTop(window, { raise, wanted: () => floating });
  window.setVisibleOnAllWorkspaces(true, {
    skipTransformProcessType: true,
    visibleOnFullScreen: true,
  });
  harden(window.webContents, "shelf");

  const hide = (): void => {
    if (!window.isVisible()) {
      return;
    }

    hideWindow(window, { raise });

    if (isMac) {
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
    dialogParent: window,
    focus: () => {
      window.focus();
    },
    bounds: () => (window.isVisible() ? window.getBounds() : null),
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
      floating = on;
      window.setAlwaysOnTop(on, "floating");
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

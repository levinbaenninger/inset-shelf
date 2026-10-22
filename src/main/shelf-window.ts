import { intersects, placeShelf, rect } from "@shared/geometry";
import type { Rect } from "@shared/geometry";
import { app, BrowserWindow, nativeTheme, screen } from "electron";
import type { Rectangle, WebContents } from "electron";

import { harden, secureWebPreferences } from "./window-security";

const MIN_WIDTH = 300;
const MIN_HEIGHT = 320;

const isMac = process.platform === "darwin";

export interface ShelfWindow {
  readonly webContents: WebContents;
  readonly load: () => Promise<void>;
  readonly isVisible: () => boolean;
  readonly isFocused: () => boolean;
  readonly show: () => void;
  /** Hides and hands focus back to the app that was in front. */
  readonly hide: () => void;
  readonly toggle: () => void;
  readonly bounds: () => Rectangle | null;
  readonly onShown: (listener: (bounds: Rectangle) => void) => void;
  readonly onHidden: (listener: () => void) => void;
  readonly allowClose: () => void;
}

export interface ShelfWindowOptions {
  readonly preload: string;
  readonly url: string;
  readonly remembered: Rect<"screen"> | null;
  readonly remember: (bounds: Rect<"screen">) => void;
  /** Another Inset window is on screen, so app.hide() would hide it too. */
  readonly otherWindowVisible: () => boolean;
}

const backgroundColor = (): string =>
  nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff";

const toRect = (bounds: Rectangle): Rect<"screen"> =>
  rect(bounds.x, bounds.y, bounds.width, bounds.height);

/** The last place still on some display, else the top right of the display under the pointer. */
const placement = (remembered: Rect<"screen"> | null): Rectangle => {
  const onScreen =
    remembered !== null &&
    screen
      .getAllDisplays()
      .some((display) => intersects(toRect(display.workArea), remembered));

  const workArea = onScreen
    ? screen.getDisplayMatching(remembered).workArea
    : screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;

  return placeShelf(toRect(workArea), onScreen ? remembered : null);
};

/** A floating panel that stays above other windows, on every Space, until it is hidden on purpose. */
export const createShelfWindow = (options: ShelfWindowOptions): ShelfWindow => {
  let { remembered } = options;
  let closable = false;

  const listeners = {
    hidden: (): void => undefined,
    shown: (_bounds: Rectangle): void => undefined,
  };

  const window = new BrowserWindow({
    backgroundColor: backgroundColor(),
    frame: false,
    fullscreenable: false,
    hasShadow: true,
    maximizable: false,
    minHeight: MIN_HEIGHT,
    minWidth: MIN_WIDTH,
    minimizable: false,
    show: false,
    skipTaskbar: true,
    title: "Inset Shelf",
    type: isMac ? "panel" : undefined,
    webPreferences: secureWebPreferences(options.preload),
    ...placement(remembered),
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

    listeners.hidden();
  };

  const keepBounds = (): void => {
    if (window.isVisible()) {
      remembered = toRect(window.getBounds());
      options.remember(remembered);
    }
  };

  window.on("moved", keepBounds);
  window.on("resized", keepBounds);

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

  const show = (): void => {
    if (!window.isVisible()) {
      window.setBounds(placement(remembered));
    }

    if (isMac) {
      app.show();
    }

    window.show();
    window.focus();
    listeners.shown(window.getBounds());
  };

  return {
    allowClose: () => {
      closable = true;
    },
    bounds: () => (window.isVisible() ? window.getBounds() : null),
    hide,
    isFocused: () => window.isVisible() && window.isFocused(),
    isVisible: () => window.isVisible(),
    load: async () => {
      await window.loadURL(options.url);
    },
    onHidden: (listener) => {
      listeners.hidden = listener;
    },
    onShown: (listener) => {
      listeners.shown = listener;
    },
    show,
    toggle: () => {
      if (window.isVisible() && window.isFocused()) {
        hide();
      } else {
        show();
      }
    },
    webContents: window.webContents,
  };
};

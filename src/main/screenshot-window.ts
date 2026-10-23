import type { ScreenshotView } from "@shared/contracts";
import { BrowserWindow, screen } from "electron";
import type { Rectangle, WebContents } from "electron";

import { harden, secureWebPreferences } from "./window-security";

const WIDTH = 280;
const MIN_HEIGHT = 180;
const MAX_HEIGHT = 260;
const GAP = 12;

/** Without the pointer on it, the card goes after this long. */
const VISIBLE_MS = 12_000;

export interface ScreenshotWindow {
  readonly webContents: WebContents;
  readonly load: () => Promise<void>;
  /** Shows the card beside the shelf, or at the screen's right edge without it. */
  readonly show: (view: ScreenshotView, shelf: Rectangle | null) => void;
  readonly hide: () => void;
  readonly isVisible: () => boolean;
  /** The pointer is on the card: it stays until the pointer leaves. */
  readonly hover: (on: boolean) => void;
  /** Keeps the card until it is used or dismissed. */
  readonly hold: () => void;
  readonly view: () => ScreenshotView | null;
  readonly onView: (listener: (view: ScreenshotView | null) => void) => void;
  readonly allowClose: () => void;
}

const ignore = (): void => undefined;

/** The card's height follows the screenshot's shape, within bounds. */
const heightFor = (view: ScreenshotView): number =>
  Math.round(
    Math.min(
      MAX_HEIGHT,
      Math.max(MIN_HEIGHT, (WIDTH * view.heightPx) / view.widthPx)
    )
  );

const placement = (height: number, shelf: Rectangle | null): Rectangle => {
  if (shelf !== null) {
    const { workArea } = screen.getDisplayMatching(shelf);
    const left = shelf.x - WIDTH - GAP;

    return {
      height,
      width: WIDTH,
      x: left >= workArea.x ? left : shelf.x + shelf.width + GAP,
      y: Math.max(workArea.y, shelf.y + shelf.height - height),
    };
  }

  const { workArea } = screen.getDisplayNearestPoint(
    screen.getCursorScreenPoint()
  );

  return {
    height,
    width: WIDTH,
    x: workArea.x + workArea.width - WIDTH - GAP,
    y: workArea.y + workArea.height - height - GAP,
  };
};

/**
 * A small card for a new screenshot, like the one macOS shows in the corner.
 * It floats above the shelf and takes clicks without taking focus from the
 * app in front; the first click acts at once.
 */
export const createScreenshotWindow = (options: {
  readonly preload: string;
  readonly url: string;
}): ScreenshotWindow => {
  let current: ScreenshotView | null = null;
  let closable = false;
  let hovered = false;
  let held = false;
  let timer: NodeJS.Timeout | undefined;
  let listener: (view: ScreenshotView | null) => void = ignore;

  const window = new BrowserWindow({
    acceptFirstMouse: true,
    backgroundColor: "#00000000",
    frame: false,
    fullscreenable: false,
    hasShadow: true,
    height: MIN_HEIGHT,
    maximizable: false,
    minimizable: false,
    resizable: false,
    show: false,
    skipTaskbar: true,
    transparent: true,
    type: process.platform === "darwin" ? "panel" : undefined,
    webPreferences: secureWebPreferences(options.preload),
    width: WIDTH,
  });

  // One level above the floating shelf, which would otherwise cover it.
  window.setAlwaysOnTop(true, "floating", 1);
  window.setVisibleOnAllWorkspaces(true, {
    skipTransformProcessType: true,
    visibleOnFullScreen: true,
  });
  harden(window.webContents, "screenshot");

  window.on("close", (event) => {
    if (!closable) {
      event.preventDefault();
    }
  });

  const hide = (): void => {
    clearTimeout(timer);
    hovered = false;
    held = false;
    current = null;
    listener(null);

    if (window.isVisible()) {
      window.hide();
    }
  };

  const hideLater = (): void => {
    clearTimeout(timer);
    timer = setTimeout(hide, VISIBLE_MS);
  };

  return {
    allowClose: () => {
      closable = true;
    },
    hide,
    hover: (on) => {
      hovered = on;

      if (hovered) {
        clearTimeout(timer);
      } else if (current !== null && !held) {
        hideLater();
      }
    },
    hold: () => {
      held = true;
      clearTimeout(timer);
    },
    isVisible: () => window.isVisible(),
    load: async () => {
      await window.loadURL(options.url);
    },
    onView: (next) => {
      listener = next;
    },
    show: (view, shelf) => {
      current = view;
      held = false;
      listener(view);
      window.setBounds(placement(heightFor(view), shelf));
      window.showInactive();

      if (!hovered) {
        hideLater();
      }
    },
    view: () => current,
    webContents: window.webContents,
  };
};

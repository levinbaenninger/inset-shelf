import { app, BrowserWindow, nativeTheme, screen } from "electron";
import type { WebContents } from "electron";

import { followThemeInCaption, headerChrome } from "./caption-buttons";
import type { Presentation } from "./permissions/onboarding";
import { harden, secureWebPreferences } from "./window-security";

const WIDTH = 460;

/** Until the page reports its own height (fitHeight). */
const FIRST_HEIGHT = 320;

/** Off the screen's edge, beside System Settings. */
const EDGE_GAP = 16;

const isMac = process.platform === "darwin";

const ignore = (): void => undefined;

const workArea = () =>
  screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;

const background = (): string => {
  if (isMac) {
    return "#00000000";
  }

  return nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff";
};

export interface OnboardingWindowHandle {
  readonly webContents: WebContents;
  readonly load: () => Promise<void>;
  readonly present: (presentation: Presentation) => void;
  readonly hide: () => void;
  readonly isFocused: () => boolean;
  readonly isVisible: () => boolean;
  /** The close button: the flow decides what closing means. */
  readonly onClose: (listener: () => void) => void;
  /** Sizes the window to the page, keeping its middle where it was. */
  readonly fitHeight: (height: number) => void;
}

/**
 * The first-run onboarding: a small window like Settings. While it asks for
 * a permission it floats above every window, on every Space and over
 * full-screen apps, so it stays beside System Settings.
 */
export const createOnboardingWindow = (options: {
  readonly preload: string;
  readonly url: string;
}): OnboardingWindowHandle => {
  const window = new BrowserWindow({
    backgroundColor: background(),
    fullscreenable: false,
    height: FIRST_HEIGHT,
    maximizable: false,
    minimizable: false,
    resizable: false,
    show: false,
    title: "Inset Shelf Setup",
    ...headerChrome(),
    useContentSize: true,
    vibrancy: isMac ? "sidebar" : undefined,
    webPreferences: secureWebPreferences(options.preload),
    width: WIDTH,
  });

  harden(window.webContents, "onboarding");
  followThemeInCaption(window);

  let onClose = ignore;
  let height = FIRST_HEIGHT;

  window.on("close", (event) => {
    event.preventDefault();
    onClose();
  });

  const float = (on: boolean): void => {
    if (on) {
      // One level above the floating shelf, as Settings and the picker are.
      window.setAlwaysOnTop(true, "floating", 1);
    } else {
      window.setAlwaysOnTop(false);
    }

    // Without skipTransformProcessType the app would lose its Dock icon and menu bar.
    window.setVisibleOnAllWorkspaces(on, {
      skipTransformProcessType: true,
      visibleOnFullScreen: on,
    });
  };

  const center = (): void => {
    const area = workArea();

    window.setContentBounds({
      height,
      width: WIDTH,
      x: Math.round(area.x + (area.width - WIDTH) / 2),
      y: Math.round(area.y + (area.height - height) / 3),
    });
  };

  /** System Settings opens near the middle of the screen: the right edge of the work area is clear of it. */
  const toEdge = (): void => {
    const area = workArea();

    window.setContentBounds({
      height,
      width: WIDTH,
      x: Math.round(area.x + area.width - WIDTH - EDGE_GAP),
      y: Math.round(area.y + (area.height - height) / 2),
    });
  };

  return {
    fitHeight: (next) => {
      if (next === height) {
        return;
      }

      const bounds = window.getContentBounds();
      const middle = bounds.y + bounds.height / 2;

      height = next;
      window.setContentBounds({
        ...bounds,
        height,
        y: Math.round(middle - height / 2),
      });
    },
    hide: () => {
      float(false);
      window.hide();
    },
    isFocused: () => window.isVisible() && window.isFocused(),
    isVisible: () => window.isVisible(),
    load: async () => {
      await window.loadURL(options.url);
    },
    onClose: (listener) => {
      onClose = listener;
    },
    present: ({ floating, focus, place }) => {
      float(floating);

      if (place === "center" || (place === "keep" && !window.isVisible())) {
        center();
      } else if (place === "edge") {
        toEdge();
      }

      if (!focus) {
        // Beside System Settings, which keeps the keyboard.
        window.showInactive();

        return;
      }

      if (isMac) {
        app.show();
        // After a grant the user is still in System Settings: the next step comes forward.
        app.focus({ steal: true });
      }

      window.show();
      window.focus();
    },
    webContents: window.webContents,
  };
};

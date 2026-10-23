import { app, BrowserWindow, nativeTheme } from "electron";
import type { WebContents } from "electron";

import {
  captionButtons,
  followThemeInCaption,
  isWindows,
} from "./caption-buttons";
import { hideWindow } from "./hide-window";
import { harden, secureWebPreferences } from "./window-security";

const WIDTH = 420;

/** The strip at the top of the page under the Windows close button (settings-app.tsx). */
const CAPTION_DIP = 36;

/** Until the page reports its own height (fitHeight). */
const FIRST_HEIGHT = 280;

const isMac = process.platform === "darwin";

/** On macOS the translucent material shows through; elsewhere the page's own background (styles.css). */
const background = (): string => {
  if (isMac) {
    return "#00000000";
  }

  return nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff";
};

/** On macOS the page draws the title under the traffic lights; on Windows only the caption buttons stay. */
const titleBar = (): "hiddenInset" | "hidden" | "default" => {
  if (isMac) {
    return "hiddenInset";
  }

  return isWindows ? "hidden" : "default";
};

export interface SettingsWindow {
  readonly webContents: WebContents;
  readonly load: () => Promise<void>;
  readonly open: () => void;
  readonly close: () => void;
  readonly isFocused: () => boolean;
  /** Sizes the window to the page's content. */
  readonly fitHeight: (height: number) => void;
}

/**
 * A small settings window, like a Mac app's Settings, kept above the shelf and
 * as tall as its content. On macOS it has the shelf's translucent material
 * and draws its own title under the traffic lights.
 */
export const createSettingsWindow = (options: {
  readonly preload: string;
  readonly url: string;
  /** Gives the keyboard back to the shelf when it is open; true when it did. */
  readonly handOff: () => boolean;
}): SettingsWindow => {
  let height = FIRST_HEIGHT;

  const window = new BrowserWindow({
    backgroundColor: background(),
    fullscreenable: false,
    height,
    maximizable: false,
    minimizable: false,
    resizable: false,
    show: false,
    title: "Settings",
    titleBarStyle: titleBar(),
    ...captionButtons(CAPTION_DIP),
    // Centred in the page's 40-point title strip (settings-app.tsx).
    trafficLightPosition: { x: 14, y: 13 },
    useContentSize: true,
    vibrancy: isMac ? "sidebar" : undefined,
    webPreferences: secureWebPreferences(options.preload),
    width: WIDTH,
  });

  harden(window.webContents, "settings");
  followThemeInCaption(window, CAPTION_DIP);

  // One level above the floating shelf, which would otherwise cover it.
  const raise = (): void => {
    window.setAlwaysOnTop(true, "floating", 1);
  };

  raise();

  window.on("close", (event) => {
    event.preventDefault();
    hideWindow(window, { handOff: options.handOff, raise });
  });

  return {
    close: () => {
      hideWindow(window, { handOff: options.handOff, raise });
    },
    fitHeight: (next) => {
      height = next;
      window.setContentSize(WIDTH, height);
    },
    isFocused: () => window.isVisible() && window.isFocused(),
    load: async () => {
      await window.loadURL(options.url);
    },
    open: () => {
      if (!window.isVisible()) {
        // On Windows the app menu, attached and hidden after the window was made, changes its size.
        window.setContentSize(WIDTH, height);
        window.center();
      }

      if (isMac) {
        app.show();
      }

      window.show();
      window.focus();
    },
    webContents: window.webContents,
  };
};

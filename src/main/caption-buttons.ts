import { WINDOW_HEADER_DIP } from "@shared/geometry";
import { nativeTheme } from "electron";
import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  TitleBarOverlay,
} from "electron";

export const isWindows = process.platform === "win32";

const isMac = process.platform === "darwin";

/** The caption buttons stop above the header's 1 px rule, which stays visible. */
const CAPTION_DIP = WINDOW_HEADER_DIP - 1;

/** The traffic lights, centred in the header's height. */
const TRAFFIC_LIGHTS = { x: 18, y: 18 } as const;

/** The page's background and text colours (styles.css), so the buttons sit on the page's header. */
const overlay = (): TitleBarOverlay =>
  nativeTheme.shouldUseDarkColors
    ? { color: "#0a0a0a", height: CAPTION_DIP, symbolColor: "#fafafa" }
    : { color: "#ffffff", height: CAPTION_DIP, symbolColor: "#0a0a0a" };

/**
 * The window's own buttons over the page's header (window-header.tsx), the
 * same in Settings and the drawing window: the traffic lights at its left on
 * macOS, the caption buttons at its right on Windows, which the header keeps
 * clear of with the `caption-clear` class. Elsewhere the window keeps its frame.
 */
export const headerChrome = (): Pick<
  BrowserWindowConstructorOptions,
  "titleBarOverlay" | "titleBarStyle" | "trafficLightPosition"
> => ({
  titleBarOverlay: isWindows ? overlay() : false,
  titleBarStyle: isMac || isWindows ? "hidden" : "default",
  trafficLightPosition: TRAFFIC_LIGHTS,
});

/** Recolours the caption buttons when the system theme changes. */
export const followThemeInCaption = (window: BrowserWindow): void => {
  if (!isWindows) {
    return;
  }

  nativeTheme.on("updated", () => {
    if (!window.isDestroyed()) {
      window.setTitleBarOverlay(overlay());
    }
  });
};

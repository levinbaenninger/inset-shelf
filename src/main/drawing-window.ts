import type { DrawingImage, DrawingView } from "@shared/contracts";
import { rect, size, viewerWindowSize } from "@shared/geometry";
import { app, BrowserWindow, nativeTheme, screen } from "electron";
import type { WebContents } from "electron";

import {
  captionButtons,
  followThemeInCaption,
  isWindows,
} from "./caption-buttons";
import { hideWindow } from "./hide-window";
import { harden, secureWebPreferences } from "./window-security";

const WIDTH = 760;
const HEIGHT = 560;

const isMac = process.platform === "darwin";

/** The page's header, which holds Save and, on macOS and Windows, the window's buttons. */
const HEADER_DIP = 48;

/** The caption buttons stop above the header's 1 px bottom border, which stays visible. */
const CAPTION_DIP = HEADER_DIP - 1;

export interface DrawingWindow {
  readonly webContents: WebContents;
  readonly load: () => Promise<void>;
  /**
   * Opens a blank canvas, or an image item to look at large and draw on, in
   * the middle of the display under the pointer.
   */
  readonly open: (image: DrawingImage | null) => void;
  readonly close: () => void;
  /** Closes like the window's close button, asking first when there are marks. */
  readonly requestClose: () => void;
  readonly setDirty: (dirty: boolean) => void;
  readonly isFocused: () => boolean;
  readonly view: () => DrawingView;
  readonly onView: (listener: (view: DrawingView) => void) => void;
  /** Closing with marks on the page: the page asks before throwing them away. */
  readonly onCloseRequest: (listener: () => void) => void;
  readonly allowClose: () => void;
}

const ignore = (): void => undefined;

/** A regular window for one drawing or image; closing it throws the marks away. */
export const createDrawingWindow = (options: {
  readonly preload: string;
  readonly url: string;
  /** Gives the keyboard back to the shelf when it is open; true when it did. */
  readonly handOff: () => boolean;
}): DrawingWindow => {
  let closable = false;
  let dirty = false;
  let current: DrawingView = { image: null, seq: 0 };
  let onView: (view: DrawingView) => void = ignore;
  let onCloseRequest: () => void = ignore;

  const window = new BrowserWindow({
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff",
    fullscreenable: false,
    height: HEIGHT,
    minHeight: 360,
    minWidth: 480,
    show: false,
    title: "New Drawing",
    // The page's own header holds the window's buttons: the traffic lights,
    // centred in its 48 points, or the Windows caption buttons at its right.
    titleBarStyle: isMac || isWindows ? "hidden" : "default",
    ...captionButtons(CAPTION_DIP),
    trafficLightPosition: { x: 18, y: 18 },
    useContentSize: true,
    webPreferences: secureWebPreferences(options.preload),
    width: WIDTH,
  });

  // Above the floating shelf, so the canvas is never behind it.
  const raise = (): void => {
    window.setAlwaysOnTop(true, "floating", 1);
  };

  raise();
  harden(window.webContents, "drawing");
  followThemeInCaption(window, CAPTION_DIP);

  window.on("close", (event) => {
    if (closable) {
      return;
    }

    event.preventDefault();

    if (dirty) {
      onCloseRequest();
    } else {
      hideWindow(window, { handOff: options.handOff, raise });
    }
  });

  return {
    allowClose: () => {
      closable = true;
    },
    close: () => {
      hideWindow(window, { handOff: options.handOff, raise });
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
    onCloseRequest: (listener) => {
      onCloseRequest = listener;
    },
    onView: (listener) => {
      onView = listener;
    },
    open: (image) => {
      const { workArea } = screen.getDisplayNearestPoint(
        screen.getCursorScreenPoint()
      );

      const content =
        image === null
          ? size<"screen">(WIDTH, HEIGHT)
          : viewerWindowSize(
              size(
                image.widthPx / image.pixelsPerDip,
                image.heightPx / image.pixelsPerDip
              ),
              rect(workArea.x, workArea.y, workArea.width, workArea.height)
            );

      dirty = false;
      current = { image, seq: current.seq + 1 };
      onView(current);
      window.setTitle(image === null ? "New Drawing" : "Image");
      window.setContentBounds({
        height: content.height,
        width: content.width,
        x: Math.round(workArea.x + (workArea.width - content.width) / 2),
        y: Math.round(workArea.y + (workArea.height - content.height) / 3),
      });

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

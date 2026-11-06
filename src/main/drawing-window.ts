import { once } from "node:events";

import type { DrawingImage, DrawingView } from "@shared/contracts";
import { rect, size, VIEWER_MIN, viewerWindowSize } from "@shared/geometry";
import { app, BrowserWindow, nativeTheme, screen } from "electron";
import type { WebContents } from "electron";

import { followThemeInCaption, headerChrome } from "./caption-buttons";
import { hideWindow } from "./hide-window";
import { keepOnTop } from "./keep-on-top";
import { harden, secureWebPreferences } from "./window-security";

const WIDTH = 760;
const HEIGHT = 560;

const isMac = process.platform === "darwin";

export interface DrawingWindow {
  readonly webContents: WebContents;
  readonly load: () => Promise<void>;
  /**
   * Opens a blank canvas, or an image item to look at large and draw on, in
   * the middle of the display under the pointer.
   */
  readonly open: (image: DrawingImage | null) => void;
  readonly close: () => void;
  /** Brings the open window to the front, marks and all. */
  readonly bringForward: () => void;
  /** A quit is under way: the page locks its marks until it ends. */
  readonly setQuitting: (quitting: boolean) => void;
  /** Closes like the window's close button, asking first when there are marks. */
  readonly requestClose: () => void;
  readonly setDirty: (dirty: boolean) => void;
  /** Marks on the page that aren't on the shelf; a quit counts them as one unsaved change. */
  readonly isDirty: () => boolean;
  /** Resolves once the page holds nothing unsaved, or once a save of its marks has ended, saved or not. */
  readonly whenSaved: () => Promise<void>;
  /** A save the page asked for has ended, saved or not. */
  readonly saveEnded: () => void;
  readonly isFocused: () => boolean;
  readonly isVisible: () => boolean;
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
  const settled = new EventTarget();
  let current: DrawingView = { image: null, quitting: false, seq: 0 };
  let onView: (view: DrawingView) => void = ignore;
  let onCloseRequest: () => void = ignore;

  const window = new BrowserWindow({
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff",
    fullscreenable: false,
    height: HEIGHT,
    minHeight: VIEWER_MIN.height,
    // The toolbar, with Save at its end, needs this much.
    minWidth: VIEWER_MIN.width,
    show: false,
    title: "New Drawing",
    // The page's own header holds the window's buttons, as in Settings.
    ...headerChrome(),
    useContentSize: true,
    webPreferences: secureWebPreferences(options.preload),
    width: WIDTH,
  });

  // Above the floating shelf, so the canvas is never behind it.
  const raise = (): void => {
    window.setAlwaysOnTop(true, "floating", 1);
  };

  const markClean = (): void => {
    dirty = false;
    settled.dispatchEvent(new Event("settled"));
  };

  // Hidden, the page's marks are gone: the next opening starts over.
  const hide = (): void => {
    markClean();
    hideWindow(window, { handOff: options.handOff, raise });
  };

  raise();
  keepOnTop(window, { raise, wanted: () => true });
  harden(window.webContents, "drawing");
  followThemeInCaption(window);

  window.on("close", (event) => {
    if (closable) {
      return;
    }

    event.preventDefault();

    if (dirty) {
      onCloseRequest();
    } else {
      hide();
    }
  });

  const bringForward = (): void => {
    if (isMac) {
      app.show();
    }

    window.show();
    window.focus();
  };

  return {
    allowClose: () => {
      closable = true;
    },
    bringForward,
    close: hide,
    isDirty: () => dirty,
    isFocused: () => window.isVisible() && window.isFocused(),
    isVisible: () => window.isVisible(),
    requestClose: () => {
      window.close();
    },
    setDirty: (next) => {
      if (next) {
        dirty = true;
      } else {
        markClean();
      }
    },
    setQuitting: (quitting) => {
      if (current.quitting !== quitting) {
        current = { ...current, quitting };
        onView(current);
      }
    },
    saveEnded: () => {
      settled.dispatchEvent(new Event("settled"));
    },
    whenSaved: async () => {
      if (!dirty) {
        return;
      }

      await once(settled, "settled");
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

      markClean();
      current = { ...current, image, seq: current.seq + 1 };
      onView(current);
      window.setTitle(image === null ? "New Drawing" : "Image");
      window.setContentBounds({
        height: content.height,
        width: content.width,
        x: Math.round(workArea.x + (workArea.width - content.width) / 2),
        y: Math.round(workArea.y + (workArea.height - content.height) / 3),
      });

      bringForward();
    },
    view: () => current,
    webContents: window.webContents,
  };
};

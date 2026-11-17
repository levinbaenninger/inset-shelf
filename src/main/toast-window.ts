import type { NoticeCorner, NoticeTone, ToastView } from "@shared/contracts";
import { noticeBesidePointer, pt, rect, size } from "@shared/geometry";
import type { Point, Rect, Size } from "@shared/geometry";
import { BrowserWindow, screen } from "electron";
import type { WebContents } from "electron";

import { harden, secureWebPreferences } from "./window-security";

/** The window is clear; the notice is drawn inside it, hugging the corner nearest the pointer, with room for its shadow. */
const SIZE: Readonly<Record<NoticeTone, Size<"screen">>> = {
  done: size(260, 44),
  failed: size(360, 72),
};

const VISIBLE_MS = 2500;

export interface ToastWindow {
  readonly webContents: WebContents;
  readonly load: () => Promise<void>;
  /** Shows a short confirmation beside the pointer, without taking focus or mouse input. */
  readonly show: (title: string, tone?: NoticeTone) => void;
  readonly hide: () => void;
  readonly view: () => ToastView | null;
  readonly onView: (listener: (view: ToastView) => void) => void;
  readonly allowClose: () => void;
}

const ignore = (): void => undefined;

const cornerNear = (
  pointer: Point<"screen">,
  bounds: Rect<"screen">
): NoticeCorner =>
  `${bounds.y >= pointer.y ? "top" : "bottom"}-${bounds.x >= pointer.x ? "left" : "right"}`;

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
    backgroundColor: "#00000000",
    focusable: false,
    frame: false,
    hasShadow: false,
    height: SIZE.done.height,
    resizable: false,
    show: false,
    skipTaskbar: true,
    transparent: true,
    type: process.platform === "darwin" ? "panel" : undefined,
    webPreferences: secureWebPreferences(options.preload),
    width: SIZE.done.width,
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
    show: (title, tone = "done") => {
      const cursor = screen.getCursorScreenPoint();
      const { workArea } = screen.getDisplayNearestPoint(cursor);
      const pointer = pt<"screen">(cursor.x, cursor.y);

      const bounds = noticeBesidePointer(
        pointer,
        SIZE[tone],
        rect(workArea.x, workArea.y, workArea.width, workArea.height)
      );

      seq += 1;
      current = { corner: cornerNear(pointer, bounds), seq, title, tone };
      listener(current);
      window.setBounds(bounds);
      window.showInactive();
      clearTimeout(timer);
      timer = setTimeout(hide, VISIBLE_MS);
    },
    view: () => current,
    webContents: window.webContents,
  };
};

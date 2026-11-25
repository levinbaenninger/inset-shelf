import type { NoticeCorner } from "@shared/contracts";
import { noticeBesidePointer, pt, rect, size } from "@shared/geometry";
import type { Point, Rect, Size } from "@shared/geometry";
import { INITIAL_PILL, stepPill } from "@shared/pill";
import type {
  PillBody,
  PillEffect,
  PillEvent,
  PillState,
  PillView,
} from "@shared/pill";
import type { ItemId } from "@shared/shelf";
import { BrowserWindow, screen } from "electron";
import type { WebContents } from "electron";

import { harden, secureWebPreferences } from "./window-security";

/** The window is clear; the pill is drawn inside it, hugging the corner nearest the pointer, with room for its shadow. */
const sizeOf = (view: PillBody): Size<"screen"> =>
  view.tone === "failed" ? size(360, 72) : size(260, 44);

export interface ToastWindow {
  readonly webContents: WebContents;
  readonly load: () => Promise<void>;
  /** What happened, for the pill to show, change or hide. See src/shared/pill.ts. */
  readonly send: (event: PillEvent) => void;
  readonly view: () => PillView | null;
  readonly onView: (listener: (view: PillView) => void) => void;
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
  /** A click on the pill: the shelf opens at the item it named. */
  readonly openShelf: (item: ItemId | null) => void;
}): ToastWindow => {
  let state: PillState = INITIAL_PILL;
  let current: PillView | null = null;
  let timer: NodeJS.Timeout | undefined;
  let closable = false;
  let listener: (view: PillView) => void = ignore;

  const window = new BrowserWindow({
    backgroundColor: "#00000000",
    focusable: false,
    frame: false,
    hasShadow: false,
    height: 44,
    resizable: false,
    show: false,
    skipTaskbar: true,
    transparent: true,
    type: process.platform === "darwin" ? "panel" : undefined,
    webPreferences: secureWebPreferences(options.preload),
    width: 260,
  });

  window.setAlwaysOnTop(true, "pop-up-menu");
  window.setVisibleOnAllWorkspaces(true, {
    skipTransformProcessType: true,
    visibleOnFullScreen: true,
  });

  // Forwarded moves tell the page when the pointer reaches the pill, which then takes the click.
  const passClicks = (): void => {
    window.setIgnoreMouseEvents(true, { forward: true });
  };

  passClicks();
  harden(window.webContents, "toast");

  window.on("close", (event) => {
    if (!closable) {
      event.preventDefault();
    }
  });

  const showBesidePointer = (view: PillBody): void => {
    const cursor = screen.getCursorScreenPoint();
    const { workArea } = screen.getDisplayNearestPoint(cursor);
    const pointer = pt<"screen">(cursor.x, cursor.y);

    const bounds = noticeBesidePointer(
      pointer,
      sizeOf(view),
      rect(workArea.x, workArea.y, workArea.width, workArea.height)
    );

    current = { ...view, corner: cornerNear(pointer, bounds) };
    listener(current);
    window.setBounds(bounds);
    window.showInactive();
  };

  const run = (effect: PillEffect): void => {
    switch (effect.type) {
      case "show": {
        showBesidePointer(effect.view);
        break;
      }

      case "hide": {
        passClicks();

        if (window.isVisible()) {
          window.hide();
        }

        break;
      }

      case "timer": {
        clearTimeout(timer);
        timer = setTimeout(() => {
          // oxlint-disable-next-line no-use-before-define -- a timer's end is the next event the pill steps through.
          send({ seq: effect.seq, type: "timeout" });
        }, effect.ms);
        break;
      }

      case "stopTimer": {
        clearTimeout(timer);
        break;
      }

      case "clicks": {
        if (effect.take) {
          window.setIgnoreMouseEvents(false);
        } else {
          passClicks();
        }

        break;
      }

      case "openShelf": {
        options.openShelf(effect.item);
        break;
      }

      default: {
        break;
      }
    }
  };

  const send = (event: PillEvent): void => {
    const step = stepPill(state, event);

    ({ state } = step);

    for (const effect of step.effects) {
      run(effect);
    }
  };

  return {
    allowClose: () => {
      closable = true;
    },
    load: async () => {
      await window.loadURL(options.url);
    },
    onView: (next) => {
      listener = next;
    },
    send,
    view: () => current,
    webContents: window.webContents,
  };
};

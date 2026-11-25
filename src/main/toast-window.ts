import type { NoticeCorner } from "@shared/contracts";
import {
  noticeBesidePointer,
  noticeInWindowCorner,
  pt,
  rect,
  resizeAtCorner,
  size,
} from "@shared/geometry";
import type { Point, Rect, Size } from "@shared/geometry";
import { holdsKeys, INITIAL_PILL, offerOf, stepPill } from "@shared/pill";
import type {
  PillBody,
  PillEffect,
  PillEvent,
  PillState,
  PillView,
  WhyOffer,
} from "@shared/pill";
import type { PlaceKey } from "@shared/recall";
import type { ItemId } from "@shared/shelf";
import { BrowserWindow, screen } from "electron";
import type { WebContents } from "electron";

import { e2eLog } from "./e2e-log";
import { giveKeys, takeKeys } from "./pill-keys";
import { harden, secureWebPreferences } from "./window-security";

/** The window is clear; the pill is drawn inside it, hugging the corner nearest the pointer, with room for its shadow. */
const sizeOf = (view: PillBody): Size<"screen"> => {
  if (view.kind === "why") {
    return size(320, 44);
  }

  return view.kind === "notice" && view.tone === "failed"
    ? size(360, 72)
    : size(260, 44);
};

export interface ToastWindow {
  readonly webContents: WebContents;
  readonly load: () => Promise<void>;
  /** What happened, for the pill to show, change or hide. See src/shared/pill.ts. */
  readonly send: (event: PillEvent) => void;
  /** The why field has the keyboard, or is taking it. */
  readonly holdsKeys: () => boolean;
  /** The why field the capture notice showing now offers. */
  readonly offer: () => (WhyOffer & { readonly seq: number }) | null;
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

const workAreaAt = (point: Point<"screen">): Rect<"screen"> => {
  const { workArea } = screen.getDisplayNearestPoint(point);

  return rect(workArea.x, workArea.y, workArea.width, workArea.height);
};

export const createToastWindow = (options: {
  readonly preload: string;
  readonly url: string;
  /** A click on the pill: the shelf opens at the item it named, in its details at `field` when one is given. */
  readonly openShelf: (
    item: ItemId | null,
    field: "description" | null
  ) => void;
  /** Return in the why field, or a click away from it: the item's description gets the words. */
  readonly saveWhy: (item: ItemId, text: string) => void;
  /** A click on the recall pill: the shelf opens filtered to the items from here. */
  readonly openRecall: (place: PlaceKey, ids: readonly ItemId[]) => void;
  /** The recall pill went: clicked, closed or left alone. */
  readonly recallEnded: (
    place: PlaceKey,
    how: "opened" | "dismissed" | "ignored"
  ) => void;
}): ToastWindow => {
  let state: PillState = INITIAL_PILL;
  let current: PillView | null = null;
  let timer: NodeJS.Timeout | undefined;
  let closable = false;
  let listener: (view: PillView) => void = ignore;
  // Events raised while effects run (the window's blur, which giveKeys causes) step after them.
  const queue: PillEvent[] = [];
  let stepping = false;

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

  const raise = (): void => {
    window.setAlwaysOnTop(true, "pop-up-menu");
  };

  raise();
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

  const draw = (
    view: PillBody,
    bounds: Rect<"screen">,
    corner: NoticeCorner
  ): void => {
    current = { ...view, corner };
    listener(current);
    window.setBounds(bounds);

    if (!window.isVisible()) {
      window.showInactive();
    }
  };

  const showBesidePointer = (view: PillBody): void => {
    const cursor = screen.getCursorScreenPoint();
    const pointer = pt<"screen">(cursor.x, cursor.y);

    const bounds = noticeBesidePointer(
      pointer,
      sizeOf(view),
      workAreaAt(pointer)
    );

    draw(view, bounds, cornerNear(pointer, bounds));
  };

  /** Inside a window's bottom-right corner, or the screen's under the pointer without one. */
  const showInWindow = (
    view: PillBody,
    target: Rect<"screen"> | null
  ): void => {
    const cursor = screen.getCursorScreenPoint();

    const near =
      target === null
        ? pt<"screen">(cursor.x, cursor.y)
        : pt<"screen">(
            target.x + target.width / 2,
            target.y + target.height / 2
          );

    draw(
      view,
      noticeInWindowCorner(target, sizeOf(view), workAreaAt(near)),
      "bottom-right"
    );
  };

  /** Where the pill already is, grown or shrunk around the corner it is drawn in. */
  const showInPlace = (view: PillBody): void => {
    if (current === null) {
      showBesidePointer(view);

      return;
    }

    const { height, width, x, y } = window.getBounds();
    const bounds = rect<"screen">(x, y, width, height);

    draw(
      view,
      resizeAtCorner(
        bounds,
        current.corner,
        sizeOf(view),
        workAreaAt(pt(x, y))
      ),
      current.corner
    );
  };

  const run = (effect: PillEffect): void => {
    switch (effect.type) {
      case "show": {
        if (effect.at === "window") {
          showInWindow(effect.view, effect.window);
        } else if (effect.at === "pointer") {
          showBesidePointer(effect.view);
        } else {
          showInPlace(effect.view);
        }

        if (effect.view.kind === "why" && effect.view.phase === "typing") {
          e2eLog("whyOpened");
        }

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

      case "takeKeys": {
        takeKeys(window);
        break;
      }

      case "giveKeys": {
        giveKeys(window, { raise });
        passClicks();
        break;
      }

      case "saveWhy": {
        options.saveWhy(effect.item, effect.text);
        e2eLog("whySaved", { itemId: effect.item, text: effect.text });
        break;
      }

      case "openShelf": {
        if (effect.field !== null) {
          e2eLog("whyFallback", { itemId: effect.item ?? undefined });
        }

        options.openShelf(effect.item, effect.field);
        break;
      }

      case "openRecall": {
        options.openRecall(effect.place, effect.ids);
        break;
      }

      case "recallEnded": {
        options.recallEnded(effect.place, effect.how);
        break;
      }

      default: {
        break;
      }
    }
  };

  const send = (event: PillEvent): void => {
    queue.push(event);

    if (stepping) {
      return;
    }

    stepping = true;

    try {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        const step = stepPill(state, next);

        ({ state } = step);

        for (const effect of step.effects) {
          run(effect);
        }
      }
    } finally {
      stepping = false;
    }
  };

  // A click elsewhere or another app took the keyboard from the why field.
  window.on("blur", () => {
    send({ type: "blurred" });
  });

  return {
    allowClose: () => {
      closable = true;
    },
    holdsKeys: () => holdsKeys(state),
    load: async () => {
      await window.loadURL(options.url);
    },
    offer: () => offerOf(state),
    onView: (next) => {
      listener = next;
    },
    send,
    view: () => current,
    webContents: window.webContents,
  };
};

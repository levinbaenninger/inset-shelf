import { INITIAL_TAP_STATE, stepTap } from "@shared/double-tap";
import type { TapKeyEvent } from "@shared/double-tap";
import { uIOhook, UiohookKey } from "uiohook-napi";

/** Input seen anywhere, by kind only: a pointer button let go, a key held with Cmd, Ctrl or Alt, or another key. */
export type InputKind = "pointer" | "chord" | "key";

export interface KeyMonitor {
  readonly onDoubleTap: (listener: () => void) => void;
  /** Recall's watcher (src/main/front-watch.ts): no key code is passed on or kept. */
  readonly onActivity: (listener: (kind: InputKind) => void) => void;
  readonly start: () => boolean;
  /** Sends Cmd+C (Ctrl+Insert on Windows) to the app in front. */
  readonly copy: () => void;
  readonly stop: () => void;
}

const keyOf = (keycode: number): TapKeyEvent["key"] => {
  if (keycode === UiohookKey.Shift) {
    return "leftShift";
  }

  return keycode === UiohookKey.ShiftRight ? "rightShift" : "other";
};

/**
 * Watches for a double tap on Shift system-wide. On macOS the hook only
 * receives keys once the app has Accessibility access.
 */
const ignore = (): void => undefined;

export const createKeyMonitor = (): KeyMonitor => {
  let state = INITIAL_TAP_STATE;
  let running = false;
  let onDoubleTap = ignore;
  let onActivity: (kind: InputKind) => void = ignore;

  // The synthetic copy is seen by the hook as other keys, which only resets the detector.
  const handle =
    (type: TapKeyEvent["type"]) => (event: { keycode: number }) => {
      const step = stepTap(state, {
        at: Date.now(),
        key: keyOf(event.keycode),
        type,
      });

      ({ state } = step);

      if (step.fired) {
        onDoubleTap();
      }
    };

  uIOhook.on("keydown", handle("down"));
  uIOhook.on("keyup", handle("up"));
  uIOhook.on("keydown", (event) => {
    onActivity(
      event.metaKey || event.ctrlKey || event.altKey ? "chord" : "key"
    );
  });
  uIOhook.on("mouseup", () => {
    onActivity("pointer");
  });

  return {
    onActivity: (listener) => {
      onActivity = listener;
    },
    onDoubleTap: (listener) => {
      onDoubleTap = listener;
    },
    copy: () => {
      // Windows' other copy shortcut: Ctrl+C would stop a program running in a terminal.
      if (process.platform === "darwin") {
        uIOhook.keyTap(UiohookKey.C, [UiohookKey.Meta]);
      } else {
        uIOhook.keyTap(UiohookKey.Insert, [UiohookKey.Ctrl]);
      }
    },
    start: () => {
      if (running) {
        return true;
      }

      try {
        uIOhook.start();
        running = true;
      } catch {
        running = false;
      }

      return running;
    },
    stop: () => {
      if (running) {
        uIOhook.stop();
        running = false;
      }
    },
  };
};

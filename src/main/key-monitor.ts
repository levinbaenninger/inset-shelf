import { INITIAL_TAP_STATE, stepTap } from "@shared/double-tap";
import type { TapKeyEvent } from "@shared/double-tap";
import { uIOhook, UiohookKey } from "uiohook-napi";

export interface KeyMonitor {
  readonly onDoubleTap: (listener: () => void) => void;
  readonly start: () => boolean;
  /** Sends Cmd+C (Ctrl+C elsewhere) to the app in front. */
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

  return {
    onDoubleTap: (listener) => {
      onDoubleTap = listener;
    },
    copy: () => {
      uIOhook.keyTap(UiohookKey.C, [
        process.platform === "darwin" ? UiohookKey.Meta : UiohookKey.Ctrl,
      ]);
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

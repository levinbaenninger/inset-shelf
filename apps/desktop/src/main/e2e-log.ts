import { appendFileSync } from "node:fs";

import { app, BrowserWindow } from "electron";
import type { Rectangle } from "electron";

export type E2eEvent =
  | "launch"
  | "keysReady"
  | "shelfShown"
  | "shelfHidden"
  | "doubleTap"
  | "selection"
  | "itemAdded"
  | "drawingShown"
  | "screenshotShown"
  | "saveFailed"
  | "copied";

export interface E2eDetails {
  readonly bounds?: Rectangle;
  readonly itemId?: string;
  readonly kind?: string;
  readonly via?: string;
  readonly text?: string;
  readonly restored?: boolean;
  /** Another app held the clipboard, so the selection wasn't copied. */
  readonly busy?: boolean;
  /** Another app still held the clipboard when time ran out: whether it was put back couldn't be read. */
  readonly unchecked?: boolean;
}

/**
 * An environment variable that only the dev run and the `package:e2e` build
 * honour: a released app ignores it, so no other process can steer it.
 */
export const e2eEnv = (name: string): string | undefined =>
  !app.isPackaged || (typeof __INSET_E2E__ !== "undefined" && __INSET_E2E__)
    ? process.env[name]
    : undefined;

export const e2eLog = (event: E2eEvent, details: E2eDetails = {}): void => {
  const logFile = e2eEnv("INSET_E2E_LOG");

  if (logFile === undefined || logFile === "") {
    return;
  }

  const windows = BrowserWindow.getAllWindows().filter((window) =>
    window.isVisible()
  ).length;

  appendFileSync(
    logFile,
    `${JSON.stringify({ event, t: Date.now(), ...details, windows })}\n`
  );
};

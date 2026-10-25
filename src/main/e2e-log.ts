import { appendFileSync } from "node:fs";

import { BrowserWindow } from "electron";
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
}

const logFile = process.env.INSET_E2E_LOG;

export const e2eLog = (event: E2eEvent, details: E2eDetails = {}): void => {
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

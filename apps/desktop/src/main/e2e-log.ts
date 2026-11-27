import { appendFileSync } from "node:fs";

import type { CodeEditor } from "@shared/code-editors";
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
  /** The screenshot card's own file came back in a drop on the shelf, and went the card's way: `to` an item, or the shelf. */
  | "shotDropped"
  | "saveFailed"
  | "copied"
  // Say why: the field has the keyboard, the disk holds its words or couldn't take them, or it gave way to the shelf's description field.
  | "whyOpened"
  | "whySaved"
  | "whyNotSaved"
  | "whyFallback"
  // Recall: the pill showed, with `count` open items from the window in front.
  | "recallShown"
  // A notice: main sent it (`text`, `tone`, and `via` the shelf page or the toast window), then the shelf page put it on screen. The toast window reports nothing, so a notice sent its way is never logged as shown.
  | "noticeSent"
  | "noticeShown"
  // Windows: a left click on the notification-area icon, and what it did (`kind`: show, focus or hide).
  | "trayClicked";

export interface E2eDetails {
  readonly bounds?: Rectangle;
  /** The work area of the display the shelf opened on. */
  readonly workArea?: Rectangle;
  readonly itemId?: string;
  readonly kind?: string;
  readonly via?: string;
  readonly text?: string;
  readonly restored?: boolean;
  /** Another app held the clipboard, so the selection wasn't copied. */
  readonly busy?: boolean;
  /** Another app still held the clipboard when time ran out: whether it was put back couldn't be read. */
  readonly unchecked?: boolean;
  readonly count?: number;
  /** Why something couldn't be saved. */
  readonly reason?: string;
  readonly tone?: string;
  /** Where a drop of the card's own file went: an item, or the shelf. */
  readonly to?: string;
}

const logFile = process.env.INSET_E2E_LOG;

/**
 * The desktop test's stand-in editor, scripts/e2e/source.swift, whose window
 * names a file, and which opens one through a scheme its bundle registers.
 * Only the capture's code place and its way back read it, never recall.
 */
export const E2E_EDITORS: readonly CodeEditor[] =
  logFile === undefined || logFile === ""
    ? []
    : [
        {
          apps: ["source"],
          document: "file",
          open: {
            atLine: "inset-e2e-source://file{path}:{line}",
            file: "inset-e2e-source://file{path}",
            scheme: "inset-e2e-source://",
          },
          title: ["file", "project"],
        },
      ];

export const e2eLog = (event: E2eEvent, details: E2eDetails = {}): void => {
  if (logFile === undefined || logFile === "") {
    return;
  }

  const windows = BrowserWindow.getAllWindows().filter((window) =>
    window.isVisible()
  ).length;

  // A trial's log is for the trial: a disk that refuses it never stops what the app was doing.
  try {
    appendFileSync(
      logFile,
      `${JSON.stringify({ event, t: Date.now(), ...details, windows })}\n`
    );
  } catch (error) {
    console.warn(`The test log couldn’t be written: ${String(error)}`);
  }
};

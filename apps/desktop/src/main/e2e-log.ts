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
  /** The item selected or open in details in the shelf changed. */
  | "itemSelected"
  | "drawingShown"
  | "screenshotShown"
  | "saveFailed"
  | "copied"
  // Say why: the field has the keyboard, the disk holds its words or couldn't take them, or it gave way to the shelf's description field.
  | "whyOpened"
  | "whySaved"
  | "whyNotSaved"
  | "whyFallback"
  // Recall: the pill showed, with `count` open items from the window in front.
  | "recallShown";

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
  readonly count?: number;
  /** Why something couldn't be saved. */
  readonly reason?: string;
}

const logFile = process.env.INSET_E2E_LOG;

/**
 * The desktop test's stand-in editor, scripts/e2e/source.swift, whose window
 * names a file. Only the capture's code place reads it, never recall.
 */
export const E2E_EDITORS: readonly CodeEditor[] =
  logFile === undefined || logFile === ""
    ? []
    : [{ apps: ["source"], document: "file", title: ["file", "project"] }];

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

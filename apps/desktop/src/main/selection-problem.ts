import { noticeText } from "./added-file";
import type { AddedNotice } from "./added-file";
import type { SelectionResult } from "./selection";

/** What Double Shift tells the user when the clipboard didn't go as planned, or null. */
export const selectionProblem = (result: SelectionResult): string | null => {
  if (result.unchecked) {
    return "Another app kept the clipboard busy, so Inset couldn't check it was put back after copying your selection.";
  }

  if (!result.restored) {
    return result.kind === "busy"
      ? "Another app kept the clipboard busy, so your selection wasn't copied and the clipboard couldn't be put back."
      : "The clipboard could not be put back after copying your selection.";
  }

  return result.kind === "busy"
    ? "Another app was using the clipboard, so your selection wasn't copied. Try again."
    : null;
};

/**
 * The notice that carries the clipboard problem to the user where they are.
 * The shelf's banner shows it only while the shelf is open; a hidden shelf
 * would keep it out of sight behind the capture's own notice (`shown`). Sent
 * after that notice, it is the one left showing, so it says a failed one's
 * headline first and each file's reason last: a failed toast shows two
 * lines, which the reasons of a few files would fill.
 */
export const warningToUser = (
  result: SelectionResult,
  shelfVisible: boolean,
  shown: AddedNotice | null = null
): { readonly message: string; readonly tone: "failed" } | null => {
  const message = selectionProblem(result);

  if (message === null || shelfVisible) {
    return null;
  }

  return {
    message:
      shown?.tone === "failed"
        ? noticeText({ ...shown, headline: `${shown.headline} ${message}` })
        : message,
    tone: "failed",
  };
};

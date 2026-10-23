import { useEffect, useEffectEvent, useSyncExternalStore } from "react";

import { isMac } from "@/shared/platform";

import { TOOLS } from "./sketch";
import type { Tool } from "./sketch";

export interface DrawingKeyActions {
  readonly undo: () => void;
  readonly redo: () => void;
  readonly pickTool: (tool: Tool) => void;
}

export const TOOL_KEYS: Readonly<Record<Tool, string>> = {
  arrow: "A",
  ellipse: "O",
  line: "L",
  pen: "P",
  rect: "R",
  text: "T",
};

const toolForKey = new Map(
  TOOLS.map((tool): [string, Tool] => [TOOL_KEYS[tool].toLowerCase(), tool])
);

export const UNDO_KEYS = isMac ? "⌘Z" : "Ctrl+Z";

export const REDO_KEYS = isMac ? "⇧⌘Z" : "Ctrl+Y";

export const SAVE_KEYS = isMac ? "⌘↩" : "Ctrl+↩";

const isTextField = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

/**
 * ⌘Z and ⇧⌘Z step through the history, as do Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z
 * elsewhere; a plain letter picks a tool. A text field keeps its own keys.
 * The letter is read from the layout, so Z is found on QWERTZ keyboards too.
 */
export const useDrawingKeys = (actions: DrawingKeyActions): void => {
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) {
      return;
    }

    if (isTextField(event.target)) {
      return;
    }

    const command = (isMac ? event.metaKey : event.ctrlKey) && !event.altKey;
    const letter = event.key.toLowerCase();

    if (command && letter === "z") {
      event.preventDefault();

      if (event.shiftKey) {
        actions.redo();
      } else {
        actions.undo();
      }

      return;
    }

    if (command && !isMac && letter === "y" && !event.shiftKey) {
      event.preventDefault();
      actions.redo();

      return;
    }

    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    const tool = toolForKey.get(event.key.toLowerCase());

    if (tool !== undefined) {
      event.preventDefault();
      actions.pickTool(tool);
    }
  });

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
};

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

const subscribeDark = (onChange: () => void): (() => void) => {
  darkQuery.addEventListener("change", onChange);

  return () => {
    darkQuery.removeEventListener("change", onChange);
  };
};

const isDark = (): boolean => darkQuery.matches;

/** The canvas paints its own colours, so it follows the system theme as well as the page does. */
export const useDark = (): boolean =>
  useSyncExternalStore(subscribeDark, isDark);

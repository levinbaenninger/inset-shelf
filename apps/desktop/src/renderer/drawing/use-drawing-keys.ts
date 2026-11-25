import { DRAWING_TOOL_KEYS } from "@shared/shortcuts";
import { useEffect, useEffectEvent, useSyncExternalStore } from "react";

import { isMac } from "@/shared/platform";

import { TOOLS } from "./sketch";
import type { Tool } from "./sketch";

export interface DrawingKeyActions {
  /** False while a save or a quit is under way: no key changes the marks. */
  readonly enabled: boolean;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly pickTool: (tool: Tool) => void;
  /** ⇧P: a pin at the pointer, or the middle of the image. */
  readonly dropPin: () => void;
  /** 1–9: selects that pin. */
  readonly selectPin: (index: number) => void;
  /** ⌫ or Delete: removes what is selected; false when nothing is, so the key does nothing. */
  readonly remove: () => boolean;
  /** The arrow keys, 10 with Shift; held is true for a held key's repeats. False when nothing is selected. */
  readonly nudge: (dx: number, dy: number, held: boolean) => boolean;
  /** ⌘D: copies of what is selected. */
  readonly duplicate: () => void;
}

/** Excalidraw's letters; P is the Pin tool (P toggles it), so the pen is X. */
export const TOOL_KEYS: Readonly<Record<Tool, string>> = DRAWING_TOOL_KEYS;

const NUDGE = new Map<string, readonly [number, number]>([
  ["ArrowDown", [0, 1]],
  ["ArrowLeft", [-1, 0]],
  ["ArrowRight", [1, 0]],
  ["ArrowUp", [0, -1]],
]);

const toolForKey = new Map(
  TOOLS.map((tool): [string, Tool] => [TOOL_KEYS[tool].toLowerCase(), tool])
);

export const UNDO_KEYS = isMac ? "⌘Z" : "Ctrl+Z";

export const REDO_KEYS = isMac ? "⇧⌘Z" : "Ctrl+Y";

export const SAVE_KEYS = isMac ? "⌘↩" : "Ctrl+Enter";

const isTextField = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

/** ⌘Z and ⇧⌘Z, or Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z elsewhere, and ⌘D; true when the key was one of them. */
const commandKey = (
  event: KeyboardEvent,
  actions: DrawingKeyActions
): boolean => {
  const command = (isMac ? event.metaKey : event.ctrlKey) && !event.altKey;
  const letter = event.key.toLowerCase();

  if (command && letter === "d" && !event.shiftKey) {
    actions.duplicate();

    return true;
  }

  if (command && letter === "z") {
    if (event.shiftKey) {
      actions.redo();
    } else {
      actions.undo();
    }

    return true;
  }

  if (command && !isMac && letter === "y" && !event.shiftKey) {
    actions.redo();

    return true;
  }

  return false;
};

/** ⇧P drops a pin, 1–9 select one, the arrows nudge the selection (10 px with Shift), ⌫ removes it; true when the key was used. */
const selectionKey = (
  event: KeyboardEvent,
  actions: DrawingKeyActions
): boolean => {
  if (event.shiftKey && event.key.toLowerCase() === "p") {
    actions.dropPin();

    return true;
  }

  if (/^[1-9]$/u.test(event.key)) {
    actions.selectPin(Number(event.key) - 1);

    return true;
  }

  const nudge = NUDGE.get(event.key);

  if (nudge !== undefined) {
    const step = event.shiftKey ? 10 : 1;

    return actions.nudge(nudge[0] * step, nudge[1] * step, event.repeat);
  }

  return (
    (event.key === "Backspace" || event.key === "Delete") && actions.remove()
  );
};

/**
 * The history keys and ⌘D, the selection and pin keys, and a plain letter
 * for each tool (P toggles the Pin tool). A text field keeps its own keys.
 * The letter is read from the layout, so Z is found on QWERTZ keyboards too.
 */
export const useDrawingKeys = (actions: DrawingKeyActions): void => {
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (
      !actions.enabled ||
      event.defaultPrevented ||
      event.isComposing ||
      isTextField(event.target)
    ) {
      return;
    }

    if (commandKey(event, actions)) {
      event.preventDefault();

      return;
    }

    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    if (selectionKey(event, actions)) {
      event.preventDefault();

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

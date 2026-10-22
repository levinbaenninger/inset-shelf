import { useEffect, useEffectEvent } from "react";

import { isMac } from "@/shared/platform";

/** What the shelf does for each key; every action is optional, so a missing selection simply skips it. */
export interface ShelfKeyActions {
  readonly toggleMenu: () => void;
  readonly undo: (() => void) | null;
  readonly move: (offset: 1 | -1) => void;
  readonly hide: () => void;
  readonly copy: (() => void) | null;
  readonly toggleDone: (() => void) | null;
  readonly edit: (() => void) | null;
  readonly remove: (() => void) | null;
  /** Typing a character while the list has focus starts a note. */
  readonly startNote: () => void;
}

const isTextField = (target: EventTarget | null): boolean =>
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLInputElement ||
  (target instanceof HTMLElement &&
    (target.isContentEditable || target.closest('[role="menu"]') !== null));

const isPrintable = (event: KeyboardEvent): boolean =>
  event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey;

/** Keys with a command modifier work everywhere; plain keys only outside text fields. */
const actionFor = (
  event: KeyboardEvent,
  actions: ShelfKeyActions
): (() => void) | null => {
  const command = isMac ? event.metaKey : event.ctrlKey;

  if (command && event.key === "k") {
    return actions.toggleMenu;
  }

  if (isTextField(event.target)) {
    return null;
  }

  if (command) {
    // A text selection inside an item keeps the normal copy.
    const selecting = window.getSelection()?.isCollapsed === false;

    if (event.key === "z") {
      return actions.undo;
    }

    return event.key === "c" && !selecting ? actions.copy : null;
  }

  const plain = new Map<string, (() => void) | null>([
    [
      "ArrowDown",
      () => {
        actions.move(1);
      },
    ],
    [
      "ArrowUp",
      () => {
        actions.move(-1);
      },
    ],
    ["Escape", actions.hide],
    [" ", actions.toggleDone],
    ["Enter", actions.edit],
    ["Backspace", actions.remove],
    ["Delete", actions.remove],
  ]);

  if (plain.has(event.key)) {
    return plain.get(event.key) ?? null;
  }

  return isPrintable(event) ? actions.startNote : null;
};

export const useShelfKeys = (actions: ShelfKeyActions): void => {
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) {
      return;
    }

    const action = actionFor(event, actions);

    if (action === null) {
      return;
    }

    // A printable key goes on into the note field, which takes focus first.
    if (action !== actions.startNote) {
      event.preventDefault();
    }

    action();
  });

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
};

import { useEffect, useEffectEvent } from "react";

/** Plain keys for the item list; Copy, Undo and the rest come from the app's menu bar. */
export interface ShelfKeyActions {
  readonly move: (offset: 1 | -1) => void;
  readonly hide: () => void;
  readonly toggleDone: (() => void) | null;
  readonly edit: (() => void) | null;
  readonly remove: (() => void) | null;
  /** Typing a character while the list has focus starts a note. */
  readonly startNote: () => void;
}

export const isTextField = (target: EventTarget | null): boolean =>
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLInputElement ||
  (target instanceof HTMLElement && target.isContentEditable);

const isPrintable = (event: KeyboardEvent): boolean =>
  event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey;

const actionFor = (
  event: KeyboardEvent,
  actions: ShelfKeyActions
): (() => void) | null => {
  if (isTextField(event.target) || event.metaKey || event.ctrlKey) {
    return null;
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

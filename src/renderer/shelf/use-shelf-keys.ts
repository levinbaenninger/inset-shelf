import { useEffect, useEffectEvent } from "react";

/** Plain keys for the item list; Copy, Undo and the rest come from the app's menu bar. */
export interface ShelfKeyActions {
  readonly move: ((offset: 1 | -1) => void) | null;
  /** Escape, layered: the shelf decides what it closes first. */
  readonly hide: () => void;
  /** → opens details, ← goes back to the list. */
  readonly forward: (() => void) | null;
  readonly back: (() => void) | null;
  readonly toggleDone: (() => void) | null;
  readonly edit: (() => void) | null;
  readonly remove: (() => void) | null;
  /** Typing a character while the list has focus starts a note; null where nothing should start one. */
  readonly startNote: (() => void) | null;
}

export const isTextField = (target: EventTarget | null): boolean =>
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLInputElement ||
  (target instanceof HTMLElement && target.isContentEditable);

/** On Windows AltGr, which types # and @ on many layouts, arrives as Ctrl+Alt. */
const commandKey = (event: KeyboardEvent): boolean =>
  event.metaKey || (event.ctrlKey && !event.getModifierState("AltGraph"));

const isPrintable = (event: KeyboardEvent): boolean =>
  event.key.length === 1 &&
  !commandKey(event) &&
  (!event.altKey || event.getModifierState("AltGraph"));

/**
 * A button, checkbox or link that Return and Space press, as anywhere else:
 * a step's checkbox, a window to reopen, Details. Only the buttons that stand
 * for the row itself (data-row-keys) keep Return to edit and Space to check off.
 */
const pressesItself = (target: EventTarget | null): boolean => {
  const control =
    target instanceof Element
      ? target.closest<HTMLElement>("button, a, [role=checkbox], [role=button]")
      : null;

  return control !== null && control.dataset.rowKeys === undefined;
};

/** An open menu handles its own keys, typing included. */
const inMenu = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest("[role=menu]") !== null;

const actionFor = (
  event: KeyboardEvent,
  actions: ShelfKeyActions
): (() => void) | null => {
  if (isTextField(event.target) || inMenu(event.target) || commandKey(event)) {
    return null;
  }

  const { move } = actions;

  const plain = new Map<string, (() => void) | null>([
    [
      "ArrowDown",
      move === null
        ? null
        : () => {
            move(1);
          },
    ],
    [
      "ArrowUp",
      move === null
        ? null
        : () => {
            move(-1);
          },
    ],
    ["ArrowRight", actions.forward],
    ["ArrowLeft", actions.back],
    ["Escape", actions.hide],
    [" ", actions.toggleDone],
    ["Enter", actions.edit],
    ["Backspace", actions.remove],
    ["Delete", actions.remove],
  ]);

  if (
    (event.key === "Enter" || event.key === " ") &&
    pressesItself(event.target)
  ) {
    return null;
  }

  if (plain.has(event.key)) {
    return plain.get(event.key) ?? null;
  }

  return isPrintable(event) ? actions.startNote : null;
};

/** In details only Escape, ← and Return act; the list's own keys wait until it is back. */
const detailsKeys = (actions: ShelfKeyActions): ShelfKeyActions => ({
  back: actions.back,
  edit: actions.edit,
  forward: null,
  hide: actions.hide,
  move: null,
  remove: null,
  startNote: null,
  toggleDone: null,
});

export const useShelfKeys = (
  actions: ShelfKeyActions,
  inDetails: boolean
): void => {
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) {
      return;
    }

    const action = actionFor(
      event,
      inDetails ? detailsKeys(actions) : { ...actions, back: null }
    );

    if (action === null) {
      return;
    }

    // A printable key goes on into the note field, which takes focus first.
    if (inDetails || action !== actions.startNote) {
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

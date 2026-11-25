import { useState } from "react";
import type { MouseEvent } from "react";

import type { ScreenPoint } from "./markdown-field";

/** A click on an item's words, as far as starting an edit cares. */
export interface WordsClick {
  readonly x: number;
  readonly y: number;
  /** It landed on a link, which opens instead. */
  readonly onLink: boolean;
  /** It ended a drag that selected words, which stay selected to copy. */
  readonly selecting: boolean;
}

/** Where a click on an item's words starts an edit: at the click, unless it opens a link or selects words. Null when it starts none. */
export const editPoint = (click: WordsClick): ScreenPoint | null =>
  click.onLink || click.selecting ? null : { x: click.x, y: click.y };

/** A click event in the page, read as a click on an item's words. */
export const wordsClick = (event: MouseEvent): WordsClick => ({
  onLink: event.target instanceof Element && event.target.closest("a") !== null,
  selecting: window.getSelection()?.isCollapsed === false,
  x: event.clientX,
  y: event.clientY,
});

/** Where the caret starts, and whether an edit was under way when that was last looked at. */
export interface CaretStart<T> {
  readonly start: T | null;
  readonly wasEditing: boolean;
}

/** The caret start once `editing` is as given: kept while an edit starts and runs, forgotten once it ends. */
export const caretStartAfter = <T>(
  state: CaretStart<T>,
  editing: boolean
): CaretStart<T> => {
  if (editing === state.wasEditing) {
    return state;
  }

  return { start: editing ? state.start : null, wasEditing: editing };
};

/**
 * Where a click asked for the caret, kept from the click until the edit it
 * starts mounts, and forgotten once that edit ends.
 */
export const useCaretStart = <T>(editing: boolean) => {
  const [state, setState] = useState<CaretStart<T>>({
    start: null,
    wasEditing: editing,
  });

  const next = caretStartAfter(state, editing);

  if (next !== state) {
    setState(next);
  }

  const setStart = (start: T | null): void => {
    setState((current) => ({ ...current, start }));
  };

  return [next.start, setStart] as const;
};

import type { MouseEvent } from "react";

import type { MenuAnchor } from "./menus";

// How a row's parts read and answer alike: the row (item-row.tsx) and the note under its picture or file (note.tsx).

/** A row's words, read or edited: the same type either way, so starting an edit moves nothing. */
export const WORDS = "text-sm leading-snug break-words";

export const DONE = "text-muted-foreground line-through";

/** Words being typed in where they are read, in the row's text or the note under its picture: the tint details' fields have (textarea.tsx IN_PLACE), a little above and below them and exactly as wide as their column, so nothing moves and the tint ends where the picture and the foot line do. */
export const EDITING = "bg-foreground/5 -my-1 rounded-xs py-1";

/** A right-click on any part of an item opens its menu at the pointer. */
export const contextMenuAt =
  (open: (anchor: MenuAnchor) => void) =>
  (event: MouseEvent): void => {
    event.preventDefault();
    open({
      align: "start",
      height: 0,
      width: 0,
      x: event.clientX,
      y: event.clientY,
    });
  };

/**
 * Focus on an item's row itself, where Return edits, Space checks off and ⌫
 * deletes. False when the row is gone or hidden.
 */
export const focusRow = (row: Element | null): boolean => {
  const target =
    row?.querySelector<HTMLElement>("[data-row-keys]") ??
    row?.querySelector<HTMLElement>("[data-details-button]") ??
    null;

  target?.focus({ preventScroll: true });

  return target !== null && document.activeElement === target;
};

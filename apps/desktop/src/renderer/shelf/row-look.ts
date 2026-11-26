import type { MouseEvent } from "react";

import type { MenuAnchor } from "./menus";

// How a row's parts read and answer alike: the row (item-row.tsx) and the note under its picture or file (note.tsx).

/** A row's words, read or edited: the same type either way, so starting an edit moves nothing. */
export const WORDS = "text-sm leading-snug break-words";

export const DONE = "text-muted-foreground line-through";

/** Words being typed in where they are read: the quiet tint details' fields have, drawn around them, so nothing moves (as the inline Textarea). */
export const EDITING =
  "bg-muted ring-muted dark:bg-muted/50 dark:ring-muted/50 rounded-xs ring-4";

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

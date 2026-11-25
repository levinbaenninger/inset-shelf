import { createContext } from "react";
import type { MouseEvent } from "react";

import type { MenuAnchor } from "./menus";

// How a row's parts read and answer alike: the row (item-row.tsx) and the note under its picture or file (note.tsx).

/** A row's words, read or edited: the same type either way, so starting an edit moves nothing. */
export const WORDS = "text-sm leading-snug break-words";

/** How many lines of its words, caption or description an open row shows before Show more. */
export const OPEN_LINES = 10;

/** An open row takes at most this share of the list's height: past it, its words or caption show fewer lines. */
export const OPEN_SHARE = 0.6;

/** The fewest lines an open row's words or caption show before Show more, however little room is left. */
export const MIN_OPEN_LINES = 3;

/** How many lines the open row's words or caption show now: OPEN_LINES, or fewer when the row's other parts take the room (item-row.tsx). */
export const OpenLines = createContext(OPEN_LINES);

export const DESCRIPTION_LINES = 3;

export const TITLE_LINES = 3;

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

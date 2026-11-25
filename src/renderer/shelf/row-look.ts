import { createContext } from "react";
import type { MouseEvent } from "react";

import type { MenuAnchor } from "./menus";
import { ROW_CAPS } from "./open-row";
import type { RowBudget, TextPart } from "./open-row";

// How a row's parts read and answer alike: the row (item-row.tsx) and the note under its picture or file (note.tsx).

/** A row's words, read or edited: the same type either way, so starting an edit moves nothing. */
export const WORDS = "text-sm leading-snug break-words";

/** How much of the open row shows, which of its words are cut, and its one Show more (open-row.ts decides, item-row.tsx measures). */
export interface OpenRowView {
  readonly budget: RowBudget;
  /** The text parts cut now, in the row's order; the last carries Show more. */
  readonly cut: readonly TextPart[];
  /** Show more opened every cut part. */
  readonly expanded: boolean;
  readonly toggle: () => void;
  /** What Show more names each part ("Show more of the note and the description"). */
  readonly names: Readonly<Record<TextPart, string>>;
}

/** Null outside an open row. */
export const OpenRow = createContext<OpenRowView | null>(null);

/** How much an open row shows: all of it outside one. */
export const budgetOf = (view: OpenRowView | null): RowBudget =>
  view?.budget ?? ROW_CAPS;

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

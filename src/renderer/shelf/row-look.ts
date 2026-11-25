import { createContext } from "react";
import type { MouseEvent } from "react";

import type { MenuAnchor } from "./menus";

// How a row's parts read and answer alike: the row (item-row.tsx) and the note under its picture or file (note.tsx).

/** A row's words, read or edited: the same type either way, so starting an edit moves nothing. */
export const WORDS = "text-sm leading-snug break-words";

/** How many lines of its words or caption an open row shows before Show more. */
export const OPEN_LINES = 10;

export const DESCRIPTION_LINES = 3;

export const TITLE_LINES = 3;

/** An open row takes at most this share of the list's height: past it, its words, description and title show fewer lines. */
export const OPEN_SHARE = 0.6;

/** The parts of an open row that give way, in the order they do. */
export type RowPart = "words" | "description" | "title";

export type RowLines = Readonly<Record<RowPart, number>>;

/** Each part's own cap, which the row never goes past. */
export const ROW_CAPS: RowLines = {
  description: DESCRIPTION_LINES,
  title: TITLE_LINES,
  words: OPEN_LINES,
};

/** The fewest lines each part shows before Show more, however little room is left. */
const ROW_FLOORS: RowLines = { description: 1, title: 1, words: 3 };

const GIVES_WAY: readonly RowPart[] = ["words", "description", "title"];

/** One part as measured: how many lines its words take whole, and one line's height. */
export interface MeasuredPart {
  readonly part: RowPart;
  readonly lines: number;
  readonly line: number;
}

/** A part's height at `cap` lines: whole when at most one line would hide (Clamp), else `cap` lines and its Show more. */
const partHeight = (
  measured: MeasuredPart,
  cap: number,
  button: number
): number =>
  measured.lines <= cap + 1
    ? measured.lines * measured.line
    : cap * measured.line + button;

/**
 * How many lines each part of an open row shows so the row fits `budget`
 * pixels: the words give way first (to 3), then the description and the
 * title (to 1). `fixed` is the rest of the row, which never changes with
 * these caps, so the answer doesn't feed back into what it is measured from.
 */
export const fitOpenRow = (
  parts: readonly MeasuredPart[],
  fixed: number,
  budget: number,
  button: number
): RowLines => {
  const caps: Record<RowPart, number> = { ...ROW_CAPS };

  const total = (): number =>
    fixed +
    parts.reduce(
      (sum, measured) =>
        sum + partHeight(measured, caps[measured.part], button),
      0
    );

  for (const part of GIVES_WAY) {
    const lines = parts.find((each) => each.part === part)?.lines ?? 0;

    // Only a part longer than its floor and one line can give any room.
    while (
      total() > budget &&
      caps[part] > ROW_FLOORS[part] &&
      lines > ROW_FLOORS[part] + 1
    ) {
      caps[part] -= 1;
    }
  }

  return caps;
};

/** How many lines each part of the open row shows now (item-row.tsx). */
export const OpenLines = createContext<RowLines>(ROW_CAPS);

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

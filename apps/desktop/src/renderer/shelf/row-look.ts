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

const focusSearch = (): void => {
  document
    .querySelector<HTMLElement>("[data-search-field]")
    ?.focus({ preventScroll: true });
};

/** How long main's view of an edit may take to arrive after the row took the keyboard back. */
const LATE_VIEW_MS = 2000;

/**
 * Gives the keyboard to the search if the row's `target` leaves the page
 * still holding it, before the user presses a key or the pointer: main's
 * view of an edit can arrive after the row took the keyboard, and take the
 * row out of the search's results.
 */
const searchIfRowLeaves = (target: Element): void => {
  const watching = new AbortController();

  const stop = (): void => {
    watching.abort();
  };

  const observer = new MutationObserver(() => {
    if (target.isConnected) {
      return;
    }

    stop();

    if (
      document.activeElement === null ||
      document.activeElement === document.body
    ) {
      focusSearch();
    }
  });

  const timer = setTimeout(stop, LATE_VIEW_MS);

  watching.signal.addEventListener("abort", () => {
    observer.disconnect();
    clearTimeout(timer);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  for (const type of ["keydown", "pointerdown"]) {
    document.addEventListener(type, stop, {
      capture: true,
      signal: watching.signal,
    });
  }
};

/**
 * Focus on an item's row itself, where Return edits, Space checks off and ⌫
 * deletes. False when the row is gone or hidden. The row can leave the
 * search's results after it took the keyboard (`searchIfRowLeaves`).
 */
export const focusRow = (row: Element | null): boolean => {
  const target =
    row?.querySelector<HTMLElement>("[data-row-keys]") ??
    row?.querySelector<HTMLElement>("[data-details-button]") ??
    null;

  target?.focus({ preventScroll: true });

  const focused = target !== null && document.activeElement === target;

  if (focused) {
    searchIfRowLeaves(target);
  }

  return focused;
};

/**
 * Focus on the row, else on the search field: an edit can take away the
 * row's match, and the search is where the keyboard was before the results.
 */
export const focusRowOrSearch = (row: Element | null): void => {
  if (!focusRow(row)) {
    focusSearch();
  }
};

/**
 * `focusRowOrSearch` a frame on, once the field that had the keyboard is
 * gone, and only if nothing took the keyboard meanwhile: a Tab or click
 * before that frame keeps it where it went.
 */
export const focusRowOrSearchLater = (row: Element | null): void => {
  const from = document.activeElement;

  requestAnimationFrame(() => {
    const now = document.activeElement;

    if (now === null || now === document.body || now === from) {
      focusRowOrSearch(row);
    }
  });
};

/**
 * How the shelf came forward: main showed it (the shortcut, the tray, a
 * notice), or a window closing over the open shelf (a drawing, the picker)
 * gave it the keyboard back.
 */
export type Arrival = "shown" | "refocused";

/** Where the keyboard is as the shelf comes forward, and what is under way. */
export interface KeyboardPlace {
  /**
   * `nothing`: the page itself. `emptySearch` and `search`: the search
   * field, without and with words. `text`: a field being typed in.
   * `control`: an item, a button.
   */
  readonly on: "nothing" | "emptySearch" | "search" | "text" | "control";
  readonly inDetails: boolean;
  readonly menuOpen: boolean;
  /** An item's words are being edited. */
  readonly editing: boolean;
}

/**
 * Whether the note field takes the keyboard as the shelf comes forward:
 * it is ready for a note unless something is under way (an edit, details,
 * a menu, a search with words). Shown again, an item that kept the
 * keyboard lets go of it; a window closing over the open shelf leaves it.
 */
export const noteFieldTakesKeyboard = (
  arrival: Arrival,
  place: KeyboardPlace
): boolean => {
  // An edit, details or a menu is under way wherever the keyboard is, the page itself included.
  if (place.editing || place.inDetails || place.menuOpen) {
    return false;
  }

  if (place.on === "control") {
    return arrival === "shown";
  }

  // A field being typed in, or a search with words, keeps the keyboard.
  return place.on === "nothing" || place.on === "emptySearch";
};

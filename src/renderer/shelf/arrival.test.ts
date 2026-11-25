import { describe, expect, it } from "vitest";

import { noteFieldTakesKeyboard } from "./arrival";
import type { KeyboardPlace } from "./arrival";

const place = (patch: Partial<KeyboardPlace>): KeyboardPlace => ({
  editing: false,
  inDetails: false,
  menuOpen: false,
  on: "nothing",
  ...patch,
});

describe(noteFieldTakesKeyboard, () => {
  it("puts the caret in the note field when nothing has the keyboard, however the shelf came forward", () => {
    expect(noteFieldTakesKeyboard("shown", place({}))).toBe(true);
    expect(noteFieldTakesKeyboard("refocused", place({}))).toBe(true);
    expect(
      noteFieldTakesKeyboard("refocused", place({ on: "emptySearch" }))
    ).toBe(true);
  });

  it("takes the keyboard off an item when the shelf is shown again", () => {
    expect(noteFieldTakesKeyboard("shown", place({ on: "control" }))).toBe(
      true
    );
  });

  it("leaves the keyboard on an item when a window closes over the open shelf", () => {
    expect(
      noteFieldTakesKeyboard("refocused", place({ on: "control" }))
    ).toBe(false);
  });

  it("leaves what is under way alone: an edit, details, a menu, a search with words, a field", () => {
    expect(
      noteFieldTakesKeyboard("shown", place({ editing: true, on: "control" }))
    ).toBe(false);
    expect(
      noteFieldTakesKeyboard("shown", place({ inDetails: true, on: "control" }))
    ).toBe(false);
    expect(
      noteFieldTakesKeyboard("shown", place({ menuOpen: true, on: "control" }))
    ).toBe(false);
    expect(noteFieldTakesKeyboard("shown", place({ on: "search" }))).toBe(
      false
    );
    expect(noteFieldTakesKeyboard("shown", place({ on: "text" }))).toBe(false);
  });

  it("lands the same whichever of the focus and the shown message comes first", () => {
    // Focus first: the item keeps the keyboard, then shown moves it to the note field, which then keeps it.
    const focusFirst =
      !noteFieldTakesKeyboard("refocused", place({ on: "control" })) &&
      noteFieldTakesKeyboard("shown", place({ on: "control" }));

    // Shown first: the note field takes it; the focus that follows finds a field and leaves it there.
    const shownFirst =
      noteFieldTakesKeyboard("shown", place({ on: "control" })) &&
      !noteFieldTakesKeyboard("refocused", place({ on: "text" }));

    expect(focusFirst).toBe(true);
    expect(shownFirst).toBe(true);
  });
});

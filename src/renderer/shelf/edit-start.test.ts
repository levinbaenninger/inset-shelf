import { describe, expect, it } from "vitest";

import { caretStartAfter, editPoint } from "./edit-start";
import type { CaretStart } from "./edit-start";

const click = { onLink: false, selecting: false, x: 40, y: 12 };

describe(editPoint, () => {
  it("starts the edit where the words were clicked", () => {
    expect(editPoint(click)).toStrictEqual({ x: 40, y: 12 });
  });

  it("starts none on a link, which opens, or after a drag that selected words", () => {
    expect(editPoint({ ...click, onLink: true })).toBeNull();
    expect(editPoint({ ...click, selecting: true })).toBeNull();
  });
});

describe(caretStartAfter, () => {
  const closed: CaretStart<number> = { start: null, wasEditing: false };

  it("keeps the clicked place from the click until the edit it starts, and through it", () => {
    const clicked = { ...closed, start: 7 };
    const started = caretStartAfter(clicked, true);

    expect(started).toStrictEqual({ start: 7, wasEditing: true });
    expect(caretStartAfter(started, true)).toBe(started);
  });

  it("forgets it once the edit ends, so Return later starts at the end", () => {
    expect(
      caretStartAfter({ start: 7, wasEditing: true }, false)
    ).toStrictEqual(closed);
  });

  it("changes nothing while no edit starts or ends", () => {
    const clicked = { ...closed, start: 3 };

    expect(caretStartAfter(clicked, false)).toBe(clicked);
  });
});

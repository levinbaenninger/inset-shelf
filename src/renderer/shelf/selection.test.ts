import { ItemIdSchema } from "@shared/shelf";
import { describe, expect, it } from "vitest";

import { selectionAfterRemoval, stepSelection } from "./selection";

const id = (n: number) =>
  ItemIdSchema.parse(
    `3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1b${String(n).padStart(2, "0")}`
  );

const ids = [id(1), id(2), id(3)];

describe(stepSelection, () => {
  it("moves by one and stops at the top", () => {
    expect(stepSelection(ids, id(2), 1)).toBe(id(3));
    expect(stepSelection(ids, id(1), -1)).toBe(id(1));
  });

  it("leaves the list below the last item, toward the note field", () => {
    expect(stepSelection(ids, id(3), 1)).toBeNull();
  });

  it("enters the list from below at the newest item", () => {
    expect(stepSelection(ids, null, -1)).toBe(id(3));
    expect(stepSelection(ids, null, 1)).toBeNull();
    expect(stepSelection([], null, -1)).toBeNull();
  });
});

describe(selectionAfterRemoval, () => {
  it("selects the next item, else the one before", () => {
    expect(selectionAfterRemoval(ids, id(2))).toBe(id(3));
    expect(selectionAfterRemoval(ids, id(3))).toBe(id(2));
    expect(selectionAfterRemoval([id(1)], id(1))).toBeNull();
  });
});

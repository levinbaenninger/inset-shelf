import type { ShelfHere } from "@shared/contracts";
import { ItemIdSchema } from "@shared/shelf";
import { describe, expect, it } from "vite-plus/test";

import { noteHere } from "./from-here";

const HERE: ShelfHere = {
  filter: true,
  ids: [ItemIdSchema.parse("3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1b14")],
  label: "GitHub · inset/shelf #482",
  seq: 1,
};

describe(noteHere, () => {
  it("is the opening while the list shows the items from here", () => {
    expect(noteHere(HERE, true, null)).toBe(HERE);
  });

  it("is nothing once × took the chip off for this opening, so the note is plain", () => {
    expect(noteHere(HERE, true, 1)).toBeNull();
  });

  it("comes back with the next opening", () => {
    const next = { ...HERE, seq: 2 };

    expect(noteHere(next, true, 1)).toBe(next);
  });

  it("is nothing while the list shows everything, or nothing came from the window", () => {
    expect(noteHere(HERE, false, null)).toBeNull();
    expect(noteHere(null, true, null)).toBeNull();
    expect(noteHere({ ...HERE, ids: [] }, true, null)).toBeNull();
  });
});

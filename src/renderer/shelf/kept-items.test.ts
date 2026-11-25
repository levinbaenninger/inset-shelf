import { emptyShelf, ItemIdSchema, SectionIdSchema } from "@shared/shelf";
import type { ShelfItem } from "@shared/shelf";
import { describe, expect, it } from "vitest";

import { keptItems } from "./kept-items";

const section = SectionIdSchema.parse("00000000-0000-4000-8000-000000000001");

const note = (n: number, text: string): ShelfItem => ({
  attachments: [],
  color: null,
  context: null,
  createdAt: "2026-11-25T10:00:00.000Z",
  description: "",
  done: false,
  due: null,
  html: null,
  id: ItemIdSchema.parse(
    `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`
  ),
  kind: "text",
  links: [],
  sectionId: section,
  steps: [],
  text,
  via: "typed",
  windows: [],
});

const doc = (items: readonly ShelfItem[]) => ({
  ...emptyShelf(section),
  items: [...items],
});

describe(keptItems, () => {
  it("keeps every unchanged item as the object the page holds, and takes the changed one", () => {
    const before = doc([note(10, "Ask"), note(11, "Book")]);
    const copy = structuredClone(doc([note(10, "Ask"), note(11, "Book it")]));
    const [first, second] = keptItems(before, copy).items;

    expect(first).toBe(before.items[0]);
    expect(second).toBe(copy.items[1]);
  });
});

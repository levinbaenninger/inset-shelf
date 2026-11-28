import { ItemIdSchema, TextItemSchema } from "@shared/shelf";
import type { ItemId } from "@shared/shelf";
import { describe, expect, it } from "vite-plus/test";

import { lookAt } from "./made-items";

const uuid = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const id = (n: number): ItemId => ItemIdSchema.parse(uuid(n));

const item = (n: number) =>
  TextItemSchema.parse({
    attachments: [],
    color: null,
    context: null,
    createdAt: "2026-11-25T10:00:00.000Z",
    description: "",
    done: false,
    due: null,
    id: uuid(n),
    kind: "text",
    sectionId: uuid(900),
    steps: [],
    text: `Item ${n}`,
    via: "typed",
    windows: [],
  });

const HELD = new Set([id(1), id(2), id(3)]);

describe(lookAt, () => {
  it("finds the item the page has never held, and holds it from then on", () => {
    const looked = lookAt(HELD, [item(1), item(2), item(3), item(4)]);

    expect(looked.made).toBe(id(4));
    expect(lookAt(looked.held, [item(1), item(4)]).made).toBeUndefined();
  });

  it("finds the last of several made at once, as files dropped together", () => {
    expect(lookAt(HELD, [item(1), item(4), item(5)]).made).toBe(id(5));
  });

  it("finds none when the newest item is deleted, items only move, or Undo brings one back", () => {
    expect(lookAt(HELD, [item(1), item(2)]).made).toBeUndefined();
    expect(lookAt(HELD, [item(3), item(1), item(2)]).made).toBeUndefined();

    const deleted = lookAt(HELD, [item(1), item(2)]);

    expect(
      lookAt(deleted.held, [item(1), item(2), item(3)]).made
    ).toBeUndefined();
  });

  it("takes the items the shelf loads with as not new, even when they arrive after an empty first view", () => {
    const empty = lookAt(null, []);
    const loaded = lookAt(empty.held, [item(1), item(2)]);

    expect(loaded.made).toBeUndefined();
    expect(lookAt(loaded.held, [item(1), item(2), item(3)]).made).toBe(id(3));
  });
});

import { ItemIdSchema } from "@shared/shelf";
import { describe, expect, it } from "vite-plus/test";

import { cardAdds } from "./card-adds";

const target = {
  id: ItemIdSchema.parse("3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1c09"),
  label: "Quote from the movers",
};

const MESSAGE = "The disk is full.";

/** A failed save with the screenshot nowhere on the shelf: `to` reads Retry. */
const failed = (to: "shelf" | "item" | null) =>
  ({ message: MESSAGE, placed: null, state: "failed", to }) as const;

/** The screenshot attached to the item, not saved. */
const onItem = { ...target, to: "item" } as const;

/** The screenshot as a row of its own, not saved. */
const onShelf = { to: "shelf" } as const;

describe(cardAdds, () => {
  it("offers Add to Shelf alone when no item can be named", () => {
    expect(cardAdds({ save: { state: "idle" }, target: null })).toStrictEqual({
      line: null,
      pill: {
        add: "shelf",
        item: null,
        label: "Add to Shelf",
        name: "Add to Shelf",
      },
      sole: false,
    });
  });

  it("names the item on a line under Add to Shelf", () => {
    expect(cardAdds({ save: { state: "idle" }, target })).toMatchObject({
      line: {
        item: target.id,
        kind: "add",
        lead: "Add to",
        name: target.label,
        stacked: false,
      },
      pill: { item: null, label: "Add to Shelf" },
    });
  });

  it("offers Retry on the line that failed, and keeps Add to Shelf beside it", () => {
    expect(cardAdds({ save: failed("item"), target })).toMatchObject({
      line: { kind: "add", lead: "Retry adding to", stacked: true },
      pill: { item: null, label: "Add to Shelf" },
      sole: false,
    });
  });

  it("makes Retry the pill once the screenshot is on its item, not saved, and only names the item under it", () => {
    expect(
      cardAdds({
        save: { message: MESSAGE, placed: onItem, state: "failed" },
        target: null,
      })
    ).toStrictEqual({
      line: { kind: "caption", lead: "adding to", name: target.label },
      pill: {
        add: `item:${target.id}`,
        item: target.id,
        label: "Retry",
        name: "Retry adding to “Quote from the movers”",
      },
      sole: true,
    });
  });

  it("brings no other add back while a Retry for the item saves, whatever item could be named", () => {
    expect(
      cardAdds({ save: { placed: onItem, state: "saving" }, target })
    ).toStrictEqual({
      line: { kind: "caption", lead: "adding to", name: target.label },
      pill: {
        add: `item:${target.id}`,
        item: target.id,
        label: "Saving…",
        name: "Saving…",
      },
      sole: true,
    });
  });

  it("keeps Add to Shelf beside the line while a first Add to “…” saves", () => {
    expect(
      cardAdds({ save: { placed: null, state: "saving", to: "item" }, target })
    ).toMatchObject({
      line: { add: `item:${target.id}`, item: target.id, kind: "saving" },
      pill: { item: null, label: "Add to Shelf" },
      sole: false,
    });
  });

  it("offers Retry alone, and no Add to “…”, while the screenshot is a row of its own, not saved", () => {
    expect(
      cardAdds({
        save: { message: MESSAGE, placed: onShelf, state: "failed" },
        target,
      })
    ).toStrictEqual({
      line: null,
      pill: { add: "shelf", item: null, label: "Retry", name: "Retry" },
      sole: false,
    });
    expect(
      cardAdds({ save: { placed: onShelf, state: "saving" }, target })
    ).toMatchObject({ line: null, pill: { label: "Saving…" } });
  });

  it("reads Retry on the pill when Add to Shelf failed with the screenshot nowhere, and keeps Add to “…” beside it", () => {
    expect(cardAdds({ save: failed("shelf"), target })).toMatchObject({
      line: { kind: "add", lead: "Add to" },
      pill: { item: null, label: "Retry" },
    });
  });

  it("offers both adds with no Retry when the failed add can't be tried again", () => {
    expect(cardAdds({ save: failed(null), target })).toMatchObject({
      line: { kind: "add", lead: "Add to" },
      pill: { label: "Add to Shelf" },
      sole: false,
    });
  });

  it("gives Retry on the item one add, as the line and as the only pill, so the card keeps one button for it", () => {
    const line = cardAdds({ save: failed("item"), target });

    const pill = cardAdds({
      save: { message: MESSAGE, placed: onItem, state: "failed" },
      target: null,
    });

    expect(line.line).toMatchObject({ add: `item:${target.id}`, kind: "add" });
    expect(pill.pill.add).toBe(`item:${target.id}`);
    // Add to Shelf is another add: its button is never the one Retry had.
    expect(line.pill.add).toBe("shelf");
  });

  it("makes adding to another item another add", () => {
    const other = {
      id: ItemIdSchema.parse("7b2d4c1a-9e3f-4d55-8a6b-1c0f2e3d4b5a"),
      label: target.label,
    };

    const add = (to: typeof target) =>
      cardAdds({ save: { state: "idle" }, target: to }).line;

    expect(add(target)).toMatchObject({ add: `item:${target.id}` });
    expect(add(other)).toMatchObject({ add: `item:${other.id}` });
  });
});

import { ItemIdSchema } from "@shared/shelf";
import { describe, expect, it } from "vite-plus/test";

import { cardAdds } from "./card-adds";

const item = {
  id: ItemIdSchema.parse("3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1c09"),
  label: "Quote from the movers",
};

const MESSAGE = "The disk is full.";

/** A failed save with the screenshot nowhere on the shelf: with "shelf", Add to Shelf reads Retry. */
const failed = (to: "shelf" | null) =>
  ({ message: MESSAGE, placed: null, state: "failed", to }) as const;

/** The screenshot attached to the item, not saved. */
const onItem = { ...item, to: "item" } as const;

/** The screenshot as a row of its own, not saved. */
const onShelf = { to: "shelf" } as const;

const ADD_TO_SHELF = {
  line: null,
  pill: {
    add: "shelf",
    item: null,
    label: "Add to Shelf",
    name: "Add to Shelf",
  },
  sole: false,
};

describe(cardAdds, () => {
  it("offers Add to Shelf alone, and names no item: adding to one is a drag", () => {
    expect(cardAdds({ save: { state: "idle" } })).toStrictEqual(ADD_TO_SHELF);
  });

  it("reads Saving… on the pill while a drop's save to an item writes, before it placed anything", () => {
    expect(cardAdds({ save: { placed: null, state: "saving" } })).toStrictEqual(
      {
        line: null,
        pill: { add: "shelf", item: null, label: "Saving…", name: "Saving…" },
        sole: false,
      }
    );
  });

  it("makes Retry the pill once the screenshot is on its item, not saved, and only names the item under it", () => {
    expect(
      cardAdds({ save: { message: MESSAGE, placed: onItem, state: "failed" } })
    ).toStrictEqual({
      line: { lead: "adding to", name: item.label },
      pill: {
        add: `item:${item.id}`,
        item: item.id,
        label: "Retry",
        name: "Retry adding to “Quote from the movers”",
      },
      sole: true,
    });
  });

  it("brings no other add back while a Retry for the item saves", () => {
    expect(
      cardAdds({ save: { placed: onItem, state: "saving" } })
    ).toStrictEqual({
      line: { lead: "adding to", name: item.label },
      pill: {
        add: `item:${item.id}`,
        item: item.id,
        label: "Saving…",
        name: "Saving…",
      },
      sole: true,
    });
  });

  it("offers Retry alone while the screenshot is a row of its own, not saved", () => {
    expect(
      cardAdds({ save: { message: MESSAGE, placed: onShelf, state: "failed" } })
    ).toStrictEqual({
      line: null,
      pill: { add: "shelf", item: null, label: "Retry", name: "Retry" },
      sole: false,
    });
    expect(
      cardAdds({ save: { placed: onShelf, state: "saving" } })
    ).toMatchObject({ line: null, pill: { label: "Saving…" } });
  });

  it("reads Retry on the pill when Add to Shelf failed with the screenshot nowhere", () => {
    expect(cardAdds({ save: failed("shelf") })).toMatchObject({
      line: null,
      pill: { item: null, label: "Retry" },
    });
  });

  it("offers Add to Shelf, not Retry, when a drop failed with the screenshot nowhere: another drag is its retry", () => {
    expect(cardAdds({ save: failed(null) })).toStrictEqual(ADD_TO_SHELF);
  });

  it("gives Retry on the item another add than Add to Shelf, so the keyboard's button never comes to add elsewhere", () => {
    const sole = cardAdds({
      save: { message: MESSAGE, placed: onItem, state: "failed" },
    });

    expect(sole.pill.add).toBe(`item:${item.id}`);
    expect(cardAdds({ save: failed(null) }).pill.add).toBe("shelf");
  });
});

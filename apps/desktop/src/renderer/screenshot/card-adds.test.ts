import { ItemIdSchema } from "@shared/shelf";
import { describe, expect, it } from "vite-plus/test";

import { cardAdds } from "./card-adds";

const target = {
  id: ItemIdSchema.parse("3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1c09"),
  label: "Quote from the movers",
};

const failed = (to: "shelf" | "item", only: boolean) =>
  ({ message: "The disk is full.", only, state: "failed", to }) as const;

describe(cardAdds, () => {
  it("offers Add to Shelf alone when no item can be named", () => {
    expect(
      cardAdds({ save: { state: "idle" }, target: null }, false)
    ).toStrictEqual({
      line: null,
      pill: {
        add: "shelf",
        label: "Add to Shelf",
        name: "Add to Shelf",
        to: "shelf",
      },
      sole: false,
    });
  });

  it("names the item on a line under Add to Shelf", () => {
    expect(cardAdds({ save: { state: "idle" }, target }, false)).toMatchObject({
      line: { kind: "add", lead: "Add to", name: target.label, stacked: false },
      pill: { label: "Add to Shelf", to: "shelf" },
    });
  });

  it("offers Retry on the line that failed, and keeps Add to Shelf beside it", () => {
    expect(
      cardAdds({ save: failed("item", false), target }, false)
    ).toMatchObject({
      line: { kind: "add", lead: "Retry adding to", stacked: true },
      pill: { label: "Add to Shelf", to: "shelf" },
      sole: false,
    });
  });

  it("makes Retry the pill once the screenshot is on its item, not saved, and only names the item under it", () => {
    expect(
      cardAdds({ save: failed("item", true), target }, false)
    ).toStrictEqual({
      line: { kind: "caption", lead: "adding to", name: target.label },
      pill: {
        add: `item:${target.id}`,
        label: "Retry",
        name: "Retry adding to “Quote from the movers”",
        to: "item",
      },
      sole: true,
    });
  });

  it("brings no other add back while that only Retry saves", () => {
    const saving = { save: { state: "saving", to: "item" }, target } as const;

    expect(cardAdds(saving, true)).toMatchObject({
      line: { kind: "caption" },
      pill: { label: "Saving…", name: "Saving…", to: "item" },
      sole: true,
    });
    expect(cardAdds(saving, false)).toMatchObject({
      line: { kind: "saving" },
      pill: { label: "Add to Shelf", to: "shelf" },
      sole: false,
    });
  });

  it("offers both adds again once a Retry that was the only one fails with the screenshot off its item", () => {
    expect(
      cardAdds({ save: failed("item", false), target }, true)
    ).toMatchObject({
      line: { kind: "add" },
      pill: { label: "Add to Shelf" },
      sole: false,
    });
  });

  it("reads Retry on the pill when Add to Shelf failed, with or without another add", () => {
    expect(
      cardAdds({ save: failed("shelf", true), target: null }, false).pill
    ).toStrictEqual({
      add: "shelf",
      label: "Retry",
      name: "Retry",
      to: "shelf",
    });
    expect(
      cardAdds({ save: failed("shelf", false), target }, false)
    ).toMatchObject({
      line: { kind: "add", lead: "Add to" },
      pill: { label: "Retry", to: "shelf" },
    });
  });

  it("gives Retry on the item one add, as the line and as the only pill, so the card keeps one button for it", () => {
    const line = cardAdds({ save: failed("item", false), target }, true);
    const pill = cardAdds({ save: failed("item", true), target }, false);

    expect(line.line).toMatchObject({ add: `item:${target.id}`, kind: "add" });
    expect(pill.pill.add).toBe(`item:${target.id}`);
    // Add to Shelf is another add: its button is never the one Retry had.
    expect(line.pill.add).toBe("shelf");
  });

  it("keeps that add while it writes, in either place", () => {
    const saving = { save: { state: "saving", to: "item" }, target } as const;

    expect(cardAdds(saving, true).pill.add).toBe(`item:${target.id}`);
    expect(cardAdds(saving, false).line).toStrictEqual({
      add: `item:${target.id}`,
      kind: "saving",
    });
  });

  it("makes adding to another item another add", () => {
    const other = {
      id: ItemIdSchema.parse("7b2d4c1a-9e3f-4d55-8a6b-1c0f2e3d4b5a"),
      label: target.label,
    };

    const add = (to: typeof target) =>
      cardAdds({ save: { state: "idle" }, target: to }, false).line;

    expect(add(target)).toMatchObject({ add: `item:${target.id}` });
    expect(add(other)).toMatchObject({ add: `item:${other.id}` });
  });
});

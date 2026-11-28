import {
  applyOp,
  emptyShelf,
  ItemIdSchema,
  SectionIdSchema,
} from "@shared/shelf";
import type { ItemContext, MainOp, ShelfDoc, ShelfOp } from "@shared/shelf";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import { SETTLE_MS } from "./front-watch";
import { createShelfHere } from "./shelf-here";

const uuid = (n: number) =>
  `7d2e4c1a-9b3f-4e8d-a1c6-2f5b8e9d0c${String(n).padStart(2, "0")}`;

/** The docs page in Zen, as a capture from it saved it. */
const DOCS: ItemContext = {
  app: "Zen",
  appLink: null,
  code: null,
  title: "Introduction · Inset Shelf docs",
  url: "https://inset-shelf.levexis.workers.dev/docs",
};

const T3_CODE: ItemContext = {
  app: "T3 Code",
  appLink: null,
  code: null,
  title: "school/inset-shelf / Fast, Focused Information Capture UX",
  url: null,
};

/** The window in front as the shelf's opening reads it: no page address. */
const cheap = (context: ItemContext): ItemContext => ({
  ...context,
  url: null,
});

const note = (text: string, context: ItemContext | null): MainOp => ({
  context,
  html: null,
  text,
  type: "addText",
  via: "selection",
});

/** Three notes captured on the docs page, and one from nowhere. */
const shelf = (): ShelfDoc => {
  let next = 10;

  const env = {
    newItemId: () => ItemIdSchema.parse(uuid((next += 1))),
    newSectionId: () => SectionIdSchema.parse(uuid((next += 1))),
    now: () => new Date("2026-11-28T20:26:00.000Z"),
  };

  const ops: readonly MainOp[] = [
    note("A small side window", DOCS),
    note("screenshots, from a card", DOCS),
    note("screenshots, from a card that appears", DOCS),
    note("asdf", null),
  ];

  let doc = emptyShelf(SectionIdSchema.parse(uuid(1)));

  for (const op of ops) {
    ({ doc } = applyOp(doc, op, env, []));
  }

  return doc;
};

const FROM_DOCS = [uuid(11), uuid(12), uuid(13)];

/** The shelf's here over a front window the test changes; null in front is one of Inset's own windows. */
const beside = () => {
  const doc = shelf();
  let front: ItemContext | null = null;
  let changes = 0;

  const here = createShelfHere({
    changed: () => {
      changes += 1;
    },
    doc: () => doc,
    idleSeconds: () => 0,
    probe: async (address) =>
      await Promise.resolve(
        front === null
          ? null
          : { bounds: null, source: address ? front : cheap(front) }
      ),
    setTimer: (run, ms) => {
      const timer = setTimeout(run, ms);

      return () => {
        clearTimeout(timer);
      };
    },
    visible: () => true,
  });

  return {
    changes: () => changes,
    doc,
    here,
    /** The user clicks `window` to the front, and it stays there. */
    switchTo: async (window: ItemContext | null) => {
      front = window;
      here.activity("pointer");
      await vi.advanceTimersByTimeAsync(SETTLE_MS);
    },
  };
};

const compose = (
  seq: number | undefined
): Extract<ShelfOp, { readonly type: "compose" }> => ({
  here: seq,
  text: "Ask about the docs",
  type: "compose",
});

describe(createShelfHere, () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("names the notes from the docs page when the shelf opens beside it", () => {
    const { here } = beside();

    here.opened(cheap(DOCS));

    expect(here.here()?.ids).toStrictEqual(FROM_DOCS);
  });

  it("drops the docs page's notes once another app comes to the front of the open shelf", async () => {
    const { changes, here, switchTo } = beside();

    here.opened(cheap(DOCS));
    await switchTo(T3_CODE);

    expect(here.here()).toBeNull();
    expect(changes()).toBe(1);
  });

  it("keeps them while the user reads the docs page beside the shelf, and drops them on leaving it", async () => {
    const { here, switchTo } = beside();

    here.opened(cheap(DOCS));
    const opened = here.here();

    await switchTo(DOCS);

    expect(here.here()).toStrictEqual(opened);

    await switchTo(T3_CODE);

    expect(here.here()).toBeNull();
  });

  it("keeps them while one of Inset's own windows is in front", async () => {
    const { here, switchTo } = beside();

    here.opened(cheap(DOCS));
    await switchTo(null);

    expect(here.here()?.ids).toStrictEqual(FROM_DOCS);
  });

  it("names them again when the docs page comes back to the front", async () => {
    const { here, switchTo } = beside();

    here.opened(cheap(DOCS));
    await switchTo(T3_CODE);
    await switchTo(DOCS);

    expect(here.here()?.ids).toStrictEqual(FROM_DOCS);
  });

  it("drops a recall pill's opening once another app comes to the front", async () => {
    const { here, switchTo } = beside();

    here.opened(T3_CODE);
    await switchTo(T3_CODE);
    here.recalled(DOCS, {
      ids: FROM_DOCS.map((id) => ItemIdSchema.parse(id)),
      label: "Docs",
    });
    await switchTo(T3_CODE);

    expect(here.here()).toBeNull();
  });

  it("gives a note typed under the chip no source from the docs page once T3 Code is in front", async () => {
    const { here, switchTo } = beside();

    here.opened(cheap(DOCS));
    const chip = here.here()?.seq;

    await switchTo(T3_CODE);

    expect(here.typed(compose(chip))).toStrictEqual(compose(chip));
  });
});

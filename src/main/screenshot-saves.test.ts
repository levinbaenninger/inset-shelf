import { setImmediate } from "node:timers/promises";

import type { ScreenshotView } from "@shared/contracts";
import {
  AttachmentIdSchema,
  ATTACHMENTS_MAX,
  emptyShelf,
  ItemIdSchema,
  SectionIdSchema,
} from "@shared/shelf";
import type { AttachmentId, ItemId } from "@shared/shelf";
import { describe, expect, it } from "vitest";

import { createCardClock } from "./card-clock";
import {
  CARD_RETARGETED,
  cardLabel,
  createShotSaves,
  ITEM_GONE,
  RECENT_ITEM_MS,
} from "./screenshot-saves";
import type { Shot } from "./screenshot-saves";
import { createShelfController } from "./shelf-controller";
import type { WriteResult } from "./shelf-store";

const uuid = (n: number) =>
  `5b2d8f4e-1c3a-4e6b-9d0f-2a3b4c5d6e${String(n).padStart(2, "0")}`;

const NOW = Date.parse("2026-11-25T10:00:00.000Z");

const shot = (seq: number): Shot => ({
  heightPx: 600,
  png: new Uint8Array([137, 80, 78, 71, seq]),
  seq,
  widthPx: 800,
});

const ITEM_FULL = `Nothing was attached. An item holds up to ${ATTACHMENTS_MAX}.`;

const pictureAttachment = (id: AttachmentId, each: Shot) => ({
  addedAt: new Date(NOW).toISOString(),
  id,
  image: {
    file: `${id}.png`,
    heightPx: each.heightPx,
    pixelsPerDip: 2,
    widthPx: each.widthPx,
  },
  kind: "image" as const,
  name: "Screenshot",
  pins: [],
});

const DISK_FULL = Object.assign(new Error("no space"), { code: "ENOSPC" });

/** One turn of the event loop, as a write to the disk takes. */
const turn = async (): Promise<void> => {
  await setImmediate();
};

/**
 * The real controller over a disk the test can fail, a card that keeps the
 * view it was given, and the notices said. `items` are made `minutesAgo`
 * before now.
 */
const setup = (options: { readonly minutesAgo?: number } = {}) => {
  let next = 10;
  let clock = NOW - (options.minutesAgo ?? 60) * 60_000;
  let writes: WriteResult = { ok: true };
  let attachmentWrites: Error | null = null;
  let selection: ItemId | null = null;
  let shelfVisible = false;
  const notices: string[] = [];
  const attached: ItemId[] = [];
  const events: string[] = [];
  let view: ScreenshotView | null = null;
  let held = false;

  const controller = createShelfController({
    deleteAttachment: async () => {
      await Promise.resolve();
    },
    env: {
      newItemId: () => ItemIdSchema.parse(uuid((next += 1))),
      newSectionId: () => SectionIdSchema.parse(uuid((next += 1))),
      now: () => new Date(clock),
    },
    initial: emptyShelf(SectionIdSchema.parse(uuid(1))),
    restore: async () => await Promise.resolve(false),
    save: async () => {
      await turn();

      return writes;
    },
    setTimer: () => () => {},
    status: {
      floatOnTop: true,
      keys: "granted",
      problem: null,
      quitPrompt: null,
      readOnly: false,
      saveError: null,
      selectionCapture: true,
    },
  });

  const note = controller.apply({
    text: "Quote from the movers",
    type: "compose",
  });

  clock = NOW;

  const saves = createShotSaves<Shot>({
    addItem: async (each) => {
      await turn();

      if (attachmentWrites !== null) {
        throw attachmentWrites;
      }

      return controller.apply({
        context: null,
        image: {
          file: `${uuid(90 + each.seq)}.png`,
          heightPx: each.heightPx,
          pixelsPerDip: 2,
          widthPx: each.widthPx,
        },
        pins: [],
        source: null,
        type: "addImage",
        via: "screenshot",
      });
    },
    attach: async (each, id) => {
      await turn();

      if (attachmentWrites !== null) {
        throw attachmentWrites;
      }

      // A full item takes nothing, as attachResult in attachments.ts says it.
      if ((controller.item(id)?.attachments.length ?? 0) >= ATTACHMENTS_MAX) {
        return { attached: [], message: ITEM_FULL };
      }

      const attachment = AttachmentIdSchema.parse(uuid((next += 1)));

      attached.push(id);
      controller.apply({
        attachments: [pictureAttachment(attachment, each)],
        id,
        type: "attach",
      });

      return { attached: [attachment], message: null };
    },
    card: {
      hide: () => {
        view = null;
        held = false;
        events.push("hide");
      },
      hold: () => {
        held = true;
      },
      isVisible: () => view !== null,
      show: (shown) => {
        view = shown;
        held = false;
      },
      update: (change) => {
        if (view !== null) {
          view = { ...view, ...change };
        }
      },
      view: () => view,
    },
    imageUrl: (each) => `inset://shot/${each.seq}`,
    item: controller.item,
    items: () => controller.snapshot().doc.items,
    notify: (message) => {
      notices.push(message);
    },
    now: () => clock,
    persisted: async () =>
      await controller.persisted(controller.snapshot().rev),
    selection: () => selection,
    shelfVisible: () => shelfVisible,
  });

  return {
    controller,
    /** Fills the item to its 12 attachments, as drops in the shelf would. */
    fill: (id: ItemId) => {
      controller.apply({
        attachments: Array.from({ length: ATTACHMENTS_MAX }, () =>
          pictureAttachment(
            AttachmentIdSchema.parse(uuid((next += 1))),
            shot(0)
          )
        ),
        id,
        type: "attach",
      });
    },
    failAttachments: (error: Error | null) => {
      attachmentWrites = error;
    },
    failWrites: (result: WriteResult) => {
      writes = result;
    },
    held: () => held,
    images: () =>
      controller.snapshot().doc.items.filter((each) => each.kind === "image"),
    /** How many attachments an item holds now. */
    attachmentsOn: (id: ItemId) => controller.item(id)?.attachments.length,
    note: ItemIdSchema.parse(note),
    notices,
    attached,
    saves,
    select: (id: ItemId | null, visible: boolean) => {
      selection = id;
      shelfVisible = visible;
      saves.retarget();
    },
    view: () => view,
  };
};

describe("the screenshot card's save path", () => {
  it("adds the screenshot, then the card goes once the disk holds it", async () => {
    const card = setup();

    card.saves.show(shot(1));

    const saving = card.saves.addToShelf(1);

    expect(card.view()?.save).toStrictEqual({ state: "saving", to: "shelf" });
    expect(card.held()).toBeTruthy();

    const id = await saving;

    expect(id).not.toBeNull();
    expect(card.view()).toBeNull();
    expect(card.images()).toHaveLength(1);
  });

  it("keeps the card and says why when the attachment can't be written", async () => {
    const card = setup();

    card.saves.show(shot(1));
    card.failAttachments(DISK_FULL);

    await expect(card.saves.addToShelf(1)).resolves.toBeNull();
    expect(card.view()?.save).toStrictEqual({
      message: "The disk is full.",
      state: "failed",
      to: "shelf",
    });
    expect(card.held()).toBeTruthy();
  });

  it("adds the screenshot once on Retry after its attachment couldn't be written", async () => {
    const card = setup();

    card.saves.show(shot(1));
    card.failAttachments(DISK_FULL);
    await card.saves.addToShelf(1);

    expect(card.images()).toHaveLength(0);

    card.failAttachments(null);

    await expect(card.saves.addToShelf(1)).resolves.not.toBeNull();
    expect(card.images()).toHaveLength(1);
    expect(card.view()).toBeNull();
  });

  it("keeps the card when the shelf can't be written, and Retry never adds the screenshot twice", async () => {
    const card = setup();

    card.saves.show(shot(1));
    card.failWrites({ message: "The disk is full.", ok: false });

    await expect(card.saves.addToShelf(1)).resolves.toBeNull();
    expect(card.view()?.save).toMatchObject({ state: "failed", to: "shelf" });

    card.failWrites({ ok: true });

    await expect(card.saves.addToShelf(1)).resolves.not.toBeNull();
    expect(card.images()).toHaveLength(1);
    expect(card.view()).toBeNull();
  });

  it("adds the screenshot again on Retry when its unsaved row was deleted meanwhile", async () => {
    const card = setup();

    card.saves.show(shot(1));
    card.failWrites({ message: "The disk is full.", ok: false });
    await card.saves.addToShelf(1);

    const [unsaved] = card.images();

    card.controller.apply({
      id: ItemIdSchema.parse(unsaved?.id),
      type: "remove",
    });
    card.failWrites({ ok: true });

    const id = await card.saves.addToShelf(1);

    expect(id).not.toBeNull();
    expect(card.controller.item(ItemIdSchema.parse(id))).toBeDefined();
    expect(card.images()).toHaveLength(1);
  });

  it("never marks a newer card with an older card's failure, and says it in a notice instead", async () => {
    const card = setup();

    card.saves.show(shot(1));
    card.failWrites({ message: "The disk is full.", ok: false });

    const older = card.saves.addToShelf(1);

    card.saves.show(shot(2));

    await expect(older).resolves.toBeNull();
    expect(card.view()?.seq).toBe(2);
    expect(card.view()?.save).toStrictEqual({ state: "idle" });
    expect(card.held()).toBeFalsy();
    expect(card.notices).toStrictEqual(["The disk is full."]);
  });

  it("leaves a newer card on screen when an older save succeeds", async () => {
    const card = setup();

    card.saves.show(shot(1));

    const older = card.saves.addToShelf(1);

    card.saves.show(shot(2));
    await older;

    expect(card.view()?.seq).toBe(2);
  });

  it("ignores a second click while the save runs", async () => {
    const card = setup();

    card.saves.show(shot(1));

    const [first, second] = await Promise.all([
      card.saves.addToShelf(1),
      card.saves.addToShelf(1),
    ]);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(card.images()).toHaveLength(1);
  });
});

describe("Add to “…” on the screenshot card", () => {
  it("names nothing for a selection on a hidden shelf", () => {
    const card = setup();

    card.select(card.note, false);
    card.saves.show(shot(1));

    expect(card.view()?.target).toBeNull();
  });

  it("names the item open on the visible shelf, and drops it when the shelf hides", () => {
    const card = setup();

    card.select(card.note, true);
    card.saves.show(shot(1));

    expect(card.view()?.target).toStrictEqual({
      id: card.note,
      label: "Quote from the movers",
    });

    card.select(card.note, false);

    expect(card.view()?.target).toBeNull();
  });

  it("names the item made in the last two minutes, even with the shelf hidden", () => {
    const card = setup({ minutesAgo: 1 });

    card.saves.show(shot(1));

    expect(card.view()?.target).toStrictEqual({
      id: card.note,
      label: "Quote from the movers",
    });
  });

  it("names nothing once the newest item is older than two minutes", () => {
    const card = setup({ minutesAgo: RECENT_ITEM_MS / 60_000 + 1 });

    card.saves.show(shot(1));

    expect(card.view()?.target).toBeNull();
  });

  it("attaches once, and Retry after a failed write never attaches twice", async () => {
    const card = setup();

    card.select(card.note, true);
    card.saves.show(shot(1));
    card.failWrites({ message: "The disk is full.", ok: false });

    await expect(card.saves.addToItem(1, card.note)).resolves.toBeNull();
    expect(card.view()?.save).toMatchObject({ state: "failed", to: "item" });

    card.failWrites({ ok: true });

    await expect(card.saves.addToItem(1, card.note)).resolves.toBe(card.note);
    expect(card.attached).toStrictEqual([card.note]);
  });

  it("attaches to the item the card showed, and refuses with a notice once the card names another", async () => {
    const card = setup();

    const other = ItemIdSchema.parse(
      card.controller.apply({ text: "Book the lift", type: "compose" })
    );

    card.select(card.note, true);
    card.saves.show(shot(1));
    // The click left the card while it named the note; the shelf's selection moved before it reached main.
    card.select(other, true);

    await expect(card.saves.addToItem(1, card.note)).resolves.toBeNull();
    expect(card.attached).toStrictEqual([]);
    expect(card.notices).toStrictEqual([CARD_RETARGETED]);
    expect(card.view()?.target).toStrictEqual({
      id: other,
      label: "Book the lift",
    });
  });

  it("attaches again on Retry when Discard changes took the unsaved screenshot off the item", async () => {
    const card = setup();

    await card.controller.flush();
    card.select(card.note, true);
    card.saves.show(shot(1));
    card.failWrites({ message: "The disk is full.", ok: false });
    await card.saves.addToItem(1, card.note);

    expect(card.controller.discard(card.note)).toBeTruthy();
    expect(card.attachmentsOn(card.note)).toBe(0);

    card.failWrites({ ok: true });

    await expect(card.saves.addToItem(1, card.note)).resolves.toBe(card.note);
    expect(card.attachmentsOn(card.note)).toBe(1);
    expect(card.view()).toBeNull();
  });

  it("says the item is gone when it was deleted before Retry, and never reports it added", async () => {
    const card = setup();

    card.select(card.note, true);
    card.saves.show(shot(1));
    card.failAttachments(DISK_FULL);
    await card.saves.addToItem(1, card.note);
    card.controller.apply({ id: card.note, type: "remove" });
    card.failAttachments(null);

    await expect(card.saves.addToItem(1, card.note)).resolves.toBeNull();
    expect(card.view()?.save).toStrictEqual({
      message: ITEM_GONE,
      state: "failed",
      to: null,
    });
    expect(card.attached).toStrictEqual([]);
  });

  it("offers no Retry, and names the item no more, when the item filled up before the click arrived", async () => {
    const card = setup();

    card.select(card.note, true);
    card.saves.show(shot(1));
    card.fill(card.note);

    await expect(card.saves.addToItem(1, card.note)).resolves.toBeNull();
    expect(card.view()).toMatchObject({
      save: { message: ITEM_FULL, state: "failed", to: null },
      target: null,
    });
    expect(card.attachmentsOn(card.note)).toBe(ATTACHMENTS_MAX);
  });

  it("offers no Retry when Discard changes took the screenshot off and the item filled up meanwhile", async () => {
    const card = setup();

    await card.controller.flush();
    card.select(card.note, true);
    card.saves.show(shot(1));
    card.failWrites({ message: "The disk is full.", ok: false });
    await card.saves.addToItem(1, card.note);
    card.controller.discard(card.note);
    card.failWrites({ ok: true });
    card.fill(card.note);

    await expect(card.saves.addToItem(1, card.note)).resolves.toBeNull();
    expect(card.view()).toMatchObject({
      save: { message: ITEM_FULL, state: "failed", to: null },
      target: null,
    });
  });

  it("still offers Retry adding to the item when the disk refused the screenshot", async () => {
    const card = setup();

    card.select(card.note, true);
    card.saves.show(shot(1));
    card.failAttachments(DISK_FULL);
    await card.saves.addToItem(1, card.note);

    expect(card.view()).toMatchObject({
      save: { state: "failed", to: "item" },
      target: { id: card.note },
    });
  });

  it("offers no Retry once the card names another item, so a press never goes somewhere unseen", async () => {
    const card = setup();

    const other = ItemIdSchema.parse(
      card.controller.apply({ text: "Book the lift", type: "compose" })
    );

    card.select(card.note, true);
    card.saves.show(shot(1));
    card.failAttachments(DISK_FULL);
    await card.saves.addToItem(1, card.note);
    card.controller.apply({ id: card.note, type: "remove" });
    card.select(other, true);

    expect(card.view()?.target).toStrictEqual({
      id: other,
      label: "Book the lift",
    });
    expect(card.view()?.save).toMatchObject({ state: "failed", to: null });
  });
});

/** A screenshot item made at 13:02 UTC with this note and title. */
const picture = (note: string, title: string | null = null) => ({
  item: {
    attachments: [],
    color: null,
    context: null,
    createdAt: "2026-11-25T13:02:00.000Z",
    description: "",
    done: false,
    due: null,
    id: ItemIdSchema.parse(uuid(40)),
    image: { file: "a.png", heightPx: 10, pixelsPerDip: 1, widthPx: 10 },
    kind: "image" as const,
    links: [],
    note,
    pins: [],
    sectionId: SectionIdSchema.parse(uuid(1)),
    source: null,
    steps: [],
    title,
    via: "screenshot" as const,
    windows: [],
  },
});

describe(cardLabel, () => {
  it("names a picture by its title, else its note, else its kind and time, never a bare Image", () => {
    const at = new Date("2026-11-25T13:02:00.000Z");
    const time = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;

    expect(
      [picture("", "Login error"), picture("the red banner"), picture("")].map(
        ({ item }) => cardLabel(item)
      )
    ).toStrictEqual(["Login error", "the red banner", `Screenshot ${time}`]);
  });
});

/** The card's clock with a timer the test runs by hand. */
const timed = () => {
  let pending: (() => void) | null = null;
  let expired = 0;

  const clock = createCardClock({
    expire: () => {
      expired += 1;
    },
    setTimer: (run) => {
      pending = run;

      return () => {
        pending = null;
      };
    },
  });

  return {
    clock,
    elapse: () => {
      const run = pending;

      pending = null;
      run?.();
    },
    expired: () => expired,
    running: () => pending !== null,
  };
};

describe("the screenshot card's time", () => {
  it("runs out on its own", () => {
    const card = timed();

    card.clock.shown();
    card.elapse();

    expect(card.expired()).toBe(1);
  });

  it("stops while the keyboard or the pointer is on the card, and runs again once both leave", () => {
    const card = timed();

    card.clock.shown();
    card.clock.hover(true);

    expect(card.running()).toBeFalsy();

    card.clock.hover(false);

    expect(card.running()).toBeTruthy();
  });

  it("stays stopped after a hold, even once the keyboard leaves", () => {
    const card = timed();

    card.clock.shown();
    card.clock.hover(true);
    card.clock.hold();
    card.clock.hover(false);

    expect(card.running()).toBeFalsy();
  });

  it("gives a new screenshot its own time, whatever held the last one", () => {
    const card = timed();

    card.clock.shown();
    card.clock.hold();
    card.clock.shown();

    expect(card.running()).toBeTruthy();
  });
});

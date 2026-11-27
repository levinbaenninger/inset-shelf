import { once } from "node:events";
import { setImmediate } from "node:timers/promises";

import type { ScreenshotView } from "@shared/contracts";
import {
  AttachmentIdSchema,
  ATTACHMENTS_MAX,
  emptyShelf,
  ItemIdSchema,
  SectionIdSchema,
} from "@shared/shelf";
import type { AttachmentId, ItemId, ShelfDoc } from "@shared/shelf";
import { describe, expect, it } from "vite-plus/test";

import { cardAdds } from "../renderer/screenshot/card-adds";
import { createCardClock } from "./card-clock";
import {
  CARD_CLEARED,
  CARD_RETARGETED,
  CARD_TARGET_GONE,
  cardLabel,
  createShotSaves,
  RECENT_ITEM_MS,
  SHOT_REMOVAL_UNSAVED,
  SHOT_STAYS,
} from "./screenshot-saves";
import type { Shot } from "./screenshot-saves";
import { createShelfController } from "./shelf-controller";
import type { WriteResult } from "./shelf-store";

const SAVE_TOO_SLOW = "Saving didn’t finish in time.";

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
  // The scale of the display the pointer is on.
  let scale = 2;
  const notices: string[] = [];
  const saved: string[] = [];
  // The card's waits for the disk that are still running, each by what ends it.
  const waits = new Set<() => void>();
  // Filled by holdWrite(): the next writes, in order, each stay on the disk's way until the test ends it.
  const heldWrites: Promise<WriteResult>[] = [];
  // Filled by holdPicture(): the next picture files, in order, each stay unwritten until the test ends it.
  const heldPictures: Promise<unknown>[] = [];
  const attached: ItemId[] = [];
  const events: string[] = [];
  const disk: ShelfDoc[] = [];
  const deleted: string[] = [];
  // The picture files the card wrote for a place it then didn't make, and took away again.
  const dropped: string[] = [];
  let view: ScreenshotView | null = null;
  let held = false;

  const controller = createShelfController({
    deleteAttachment: async (file) => {
      await Promise.resolve();
      deleted.push(file);
    },
    env: {
      newItemId: () => ItemIdSchema.parse(uuid((next += 1))),
      newSectionId: () => SectionIdSchema.parse(uuid((next += 1))),
      now: () => new Date(clock),
    },
    initial: emptyShelf(SectionIdSchema.parse(uuid(1))),
    restore: async () => await Promise.resolve(false),
    save: async (doc) => {
      await turn();

      const result = (await heldWrites.shift()) ?? writes;

      if (result.ok) {
        disk.push(doc);
      }

      return result;
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

  const noteId = controller.apply({
    text: "Quote from the movers",
    type: "compose",
  });

  clock = NOW;

  const saves = createShotSaves<Shot>({
    addItem: (image) =>
      controller.apply({
        context: null,
        image,
        pins: [],
        source: null,
        type: "addImage",
        via: "screenshot",
      }),
    attach: (image, id) => {
      // A full item takes nothing, as attachResult in attachments.ts says it.
      if ((controller.item(id)?.attachments.length ?? 0) >= ATTACHMENTS_MAX) {
        return { attached: [], message: ITEM_FULL };
      }

      const attachment = AttachmentIdSchema.parse(uuid((next += 1)));

      attached.push(id);
      controller.apply({
        attachments: [{ ...pictureAttachment(attachment, shot(1)), image }],
        id,
        type: "attach",
      });

      return { attached: [attachment], message: null };
    },
    dropPicture: (file) => {
      dropped.push(file);
    },
    card: {
      hide: () => {
        view = null;
        held = false;
        events.push("hide");
      },
      holdForSave: () => {
        held = true;
      },
      isVisible: () => view !== null,
      releaseSave: () => {
        held = false;
      },
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
    onItsWay: (id) => controller.onItsWay(id),
    onWrite: (listener) => controller.onWrite(listener),
    persisted: async () =>
      await controller.persisted(controller.snapshot().rev),
    // As index.ts wires it: the reason the shelf gives for an item its last write was refused.
    refusal: (id) => {
      const state = controller.copyState([id], controller.snapshot().doc);

      return state.kind === "failed" ? state.message : null;
    },
    saved: (to) => {
      saved.push(to);
    },
    scale: () => scale,
    selection: () => selection,
    setTimer: (run) => {
      waits.add(run);

      return () => {
        waits.delete(run);
      };
    },
    shelfVisible: () => shelfVisible,
    stored: (id) => controller.stored(id),
    writePicture: async () => {
      await turn();
      await heldPictures.shift();

      if (attachmentWrites !== null) {
        throw attachmentWrites;
      }

      return `${uuid((next += 1))}.png`;
    },
  });

  // As index.ts wires it: the card looks again after every change to the shelf or its save.
  controller.subscribe(saves.retarget);

  const note = ItemIdSchema.parse(noteId);

  /** Where a shelf holds screenshots: as items of their own, and attached to the note. */
  const holds = (doc: ShelfDoc) => ({
    attached:
      doc.items.find((each) => each.id === note)?.attachments.length ?? 0,
    items: doc.items.filter((each) => each.kind === "image").length,
  });

  return {
    controller,
    /** The picture files deleted so far. */
    deleted,
    dropped,
    /** What every shelf written to the disk so far held, oldest first. */
    disk: () => disk.map(holds),
    /** What the shelf shows now. */
    shown: () => holds(controller.snapshot().doc),
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
    /** The pointer moves to a display with this scale. */
    pointerOn: (display: number) => {
      scale = display;
    },
    held: () => held,
    images: () =>
      controller.snapshot().doc.items.filter((each) => each.kind === "image"),
    /** How many attachments an item holds now. */
    attachmentsOn: (id: ItemId) => controller.item(id)?.attachments.length,
    note,
    notices,
    attached,
    /** The card's wait for the disk runs out, as it does after three seconds; the write it waited for goes on. */
    giveUpWaiting: async () => {
      while (waits.size === 0) {
        // oxlint-disable-next-line no-await-in-loop -- until the save reaches its wait.
        await turn();
      }

      for (const run of waits) {
        run();
      }
    },
    /** Keeps the next picture file no call before this one holds unwritten, until the returned function is called. */
    holdPicture: (): (() => void) => {
      const file = new EventTarget();

      heldPictures.push(once(file, "written"));

      return () => {
        file.dispatchEvent(new Event("written"));
      };
    },
    /** Keeps the next write no call before this one holds on the disk's way, until the returned function ends it, with how it went. */
    holdWrite: (): ((result: WriteResult) => void) => {
      const write = new EventTarget();
      let result: WriteResult = { ok: true };

      heldWrites.push(
        (async () => {
          await once(write, "end");

          return result;
        })()
      );

      return (ended) => {
        result = ended;
        write.dispatchEvent(new Event("end"));
      };
    },
    /** Where the card said its screenshot was saved, when a write other than its own save landed it. */
    saved,
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

    expect(card.view()?.save).toStrictEqual({
      placed: null,
      state: "saving",
      to: "shelf",
    });
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
      placed: null,
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
    expect(card.view()?.save).toMatchObject({
      placed: { to: "shelf" },
      state: "failed",
    });

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
    expect(card.view()?.save).toMatchObject({
      placed: { id: card.note, to: "item" },
      state: "failed",
    });

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

  it("says so in one notice when the item the card showed was deleted before the click arrived", async () => {
    const card = setup();

    card.select(card.note, true);
    card.saves.show(shot(1));
    // The click left the card while it named the note; the note was deleted before it reached main.
    card.controller.apply({ id: card.note, type: "remove" });
    card.select(null, true);

    await expect(card.saves.addToItem(1, card.note)).resolves.toBeNull();
    expect(card.attached).toStrictEqual([]);
    expect(card.notices).toStrictEqual([CARD_TARGET_GONE]);
  });

  it("says the card names no item any more when it stopped naming one before the click arrived", async () => {
    const card = setup();

    card.select(card.note, true);
    card.saves.show(shot(1));
    // The note filled up and the card let go of it before the click reached main.
    card.fill(card.note);
    card.select(card.note, true);

    await expect(card.saves.addToItem(1, card.note)).resolves.toBeNull();
    expect(card.notices).toStrictEqual([CARD_CLEARED]);
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

  it("refuses a Retry that names the item once it was deleted, with one notice, and attaches nothing", async () => {
    const card = setup();

    card.select(card.note, true);
    card.saves.show(shot(1));
    card.failWrites({ message: "The disk is full.", ok: false });
    await card.saves.addToItem(1, card.note);
    card.controller.apply({ id: card.note, type: "remove" });
    card.failWrites({ ok: true });

    await expect(card.saves.addToItem(1, card.note)).resolves.toBeNull();
    expect(card.notices).toStrictEqual([CARD_TARGET_GONE]);
    expect(card.view()).toMatchObject({
      save: { placed: null, state: "failed", to: null },
      target: null,
    });
    // Once, by the refused save; the Retry attached nothing.
    expect(card.attached).toStrictEqual([card.note]);
  });

  it("offers no Retry, and names the item no more, when the item filled up while the screenshot's file was written", async () => {
    const card = setup();

    card.select(card.note, true);
    card.saves.show(shot(1));

    const adding = card.saves.addToItem(1, card.note);

    card.fill(card.note);

    await expect(adding).resolves.toBeNull();
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

    expect(card.view()).toMatchObject({
      save: { placed: null, state: "failed", to: null },
      target: null,
    });

    // A press that left the card while it still named the note.
    await expect(card.saves.addToItem(1, card.note)).resolves.toBeNull();
    expect(card.notices).toStrictEqual([CARD_CLEARED]);
    expect(card.attachmentsOn(card.note)).toBe(ATTACHMENTS_MAX);
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

/** A card whose first save the disk refused: the shelf holds the screenshot where that save put it, unsaved. */
const refused = async (first: "item" | "shelf") => {
  const card = setup();

  await card.controller.flush();
  card.select(card.note, true);
  card.saves.show(shot(1));
  card.failWrites({ message: "The disk is full.", ok: false });
  await (first === "item"
    ? card.saves.addToItem(1, card.note)
    : card.saves.addToShelf(1));

  return card;
};

/** A press of the destination the first save didn't go to. */
const pressOther = async (
  card: Awaited<ReturnType<typeof refused>>,
  first: "item" | "shelf"
) =>
  await (first === "item"
    ? card.saves.addToShelf(1)
    : card.saves.addToItem(1, card.note));

describe("the place a refused save put the screenshot", () => {
  it("shows the screenshot where the refused save put it, not saved", async () => {
    const onItem = await refused("item");
    const onShelf = await refused("shelf");

    expect(onItem.shown()).toStrictEqual({ attached: 1, items: 0 });
    expect(onItem.controller.view().notSaved).toStrictEqual([
      { id: onItem.note, undo: "discard" },
    ]);
    expect(onShelf.shown()).toStrictEqual({ attached: 0, items: 1 });
    expect(onShelf.controller.view().notSaved).toMatchObject([
      { undo: "delete" },
    ]);
  });

  it("never names the screenshot's own unsaved row as the item to add it to", async () => {
    const card = setup();

    card.saves.show(shot(1));
    card.failWrites({ message: "The disk is full.", ok: false });
    await card.saves.addToShelf(1);

    const [row] = card.images();

    expect(card.view()?.target).toBeNull();

    // Selecting the row in the shelf changes nothing: a screenshot is never attached to itself.
    card.select(ItemIdSchema.parse(row?.id), true);

    expect(card.view()?.target).toBeNull();
  });
});

/** The row Add to Shelf made of the card's screenshot. */
const rowOf = (card: ReturnType<typeof setup>) =>
  ItemIdSchema.parse(card.images().at(0)?.id);

/** The card after a failed save when Retry alone is offered: for the place the shelf holds the screenshot, the note or a row of its own. */
const retryOnly = (card: ReturnType<typeof setup>, to: "item" | "shelf") => ({
  save: {
    placed: to === "item" ? { id: card.note, to } : { to },
    state: "failed",
  },
  target: null,
});

/** Where the last shelf written to disk holds screenshots, and every written shelf that held one twice. */
const written = (card: ReturnType<typeof setup>) => ({
  doubled: card.disk().filter((each) => each.attached + each.items > 1),
  last: card.disk().at(-1),
});

describe("a screenshot a refused save put on the shelf", () => {
  it.each(["shelf", "item"] as const)(
    "offers only Retry for that place after a refused add to the %s",
    async (first) => {
      const card = await refused(first);

      expect(card.view()).toMatchObject(retryOnly(card, first));
    }
  );

  it.each(["shelf", "item"] as const)(
    "leaves the screenshot where a refused add to the %s put it, with one notice, when a press of the other add reaches main, and Retry saves it there once",
    async (first) => {
      const card = await refused(first);
      const before = card.shown();

      card.failWrites({ ok: true });

      // A press of the other add that left the card before it offered only Retry.
      await expect(pressOther(card, first)).resolves.toBeNull();
      expect({
        notices: card.notices.length,
        shown: card.shown(),
        view: card.view(),
      }).toMatchObject({
        notices: 1,
        shown: before,
        view: retryOnly(card, first),
      });

      await expect(
        first === "item"
          ? card.saves.addToItem(1, card.note)
          : card.saves.addToShelf(1)
      ).resolves.not.toBeNull();
      expect(written(card)).toStrictEqual({ doubled: [], last: before });
    }
  );

  it("offers both adds again once the user deletes its row, and Add to “…” then holds it once, on the item", async () => {
    const card = await refused("shelf");

    card.controller.apply({ id: rowOf(card), type: "remove" });

    expect(card.view()).toMatchObject({
      save: { placed: null, state: "failed", to: "shelf" },
      target: { id: card.note },
    });

    card.failWrites({ ok: true });

    await expect(card.saves.addToItem(1, card.note)).resolves.toBe(card.note);
    expect(card.shown()).toStrictEqual({ attached: 1, items: 0 });
    expect(written(card)).toStrictEqual({
      doubled: [],
      last: { attached: 1, items: 0 },
    });
    expect(card.view()).toBeNull();
  });

  it("offers both adds again once Discard changes takes its attachment off the item, and Add to Shelf then holds it once, as an item", async () => {
    const card = await refused("item");

    card.controller.discard(card.note);

    expect(card.view()).toMatchObject({
      save: { placed: null, state: "failed", to: "item" },
      target: { id: card.note },
    });

    card.failWrites({ ok: true });

    await expect(card.saves.addToShelf(1)).resolves.not.toBeNull();
    expect(card.shown()).toStrictEqual({ attached: 0, items: 1 });
    expect(written(card)).toStrictEqual({
      doubled: [],
      last: { attached: 0, items: 1 },
    });
    expect(card.view()).toBeNull();
  });
});

/** The attachment Add to “…” made of the card's screenshot. */
const tileOf = (card: ReturnType<typeof setup>) =>
  AttachmentIdSchema.parse(
    card.controller.item(card.note)?.attachments.at(0)?.id
  );

const PIN = { label: "the red banner", x: 40, y: 60 };

/** The user writes a note on the screenshot's row; the shelf's write of it runs, and is refused while the disk refuses. */
const writeOnRow = async (card: ReturnType<typeof setup>) => {
  const row = rowOf(card);

  card.controller.apply({ id: row, note: "the red banner", type: "editNote" });
  await card.controller.flush();

  return row;
};

/** The user puts a pin on the attached screenshot, as drawing on it does. */
const drawOnTile = async (card: ReturnType<typeof setup>) => {
  const tile = tileOf(card);

  card.controller.apply({
    attachmentId: tile,
    id: card.note,
    pins: [PIN],
    type: "setAttachmentPins",
  });
  await card.controller.flush();

  return tile;
};

describe("a screenshot the user or a later write touched in its place", () => {
  it("keeps the note written on its row: the card goes once a later write saves the row", async () => {
    const card = await refused("shelf");

    card.failWrites({ ok: true });

    const row = await writeOnRow(card);

    // A press of Add to “…” that left the card before it went.
    await card.saves.addToItem(1, card.note);

    expect(card.images()).toMatchObject([{ id: row, note: "the red banner" }]);
    expect(card.shown()).toStrictEqual({ attached: 0, items: 1 });
    expect(card.view()).toBeNull();
    expect(card.saved).toStrictEqual(["shelf"]);
  });

  it("keeps what was drawn on it on the item: the card goes once a later write saves the item", async () => {
    const card = await refused("item");

    card.failWrites({ ok: true });

    const tile = await drawOnTile(card);

    // A press of Add to Shelf that left the card before it went.
    await card.saves.addToShelf(1);

    expect(card.controller.item(card.note)?.attachments).toMatchObject([
      { id: tile, pins: [PIN] },
    ]);
    expect(card.shown()).toStrictEqual({ attached: 1, items: 0 });
    expect(card.view()).toBeNull();
    expect(card.saved).toStrictEqual(["item"]);
  });

  it("never drops a row the user wrote on, and Retry saves it with their words", async () => {
    const card = await refused("shelf");
    const row = await writeOnRow(card);

    // A press of Add to “…” that left the card while it still named the note.
    await card.saves.addToItem(1, card.note);

    expect(card.images()).toMatchObject([{ id: row, note: "the red banner" }]);
    expect(card.notices).toStrictEqual([SHOT_STAYS]);

    card.failWrites({ ok: true });

    await expect(card.saves.addToShelf(1)).resolves.toBe(row);
    expect(card.disk().at(-1)).toStrictEqual({ attached: 0, items: 1 });
    expect(card.images()).toMatchObject([{ id: row, note: "the red banner" }]);
  });

  it("never takes off an attachment the user drew on, and Retry saves it with their marks", async () => {
    const card = await refused("item");
    const tile = await drawOnTile(card);

    // A press of Add to Shelf that left the card before the button went.
    await card.saves.addToShelf(1);

    expect(card.controller.item(card.note)?.attachments).toMatchObject([
      { id: tile, pins: [PIN] },
    ]);
    expect(card.notices).toStrictEqual([SHOT_STAYS]);

    card.failWrites({ ok: true });

    await expect(card.saves.addToItem(1, card.note)).resolves.toBe(card.note);
    expect(card.disk().at(-1)).toStrictEqual({ attached: 1, items: 0 });
    expect(card.controller.item(card.note)?.attachments).toMatchObject([
      { id: tile, pins: [PIN] },
    ]);
  });

  it("goes once the shelf's own Retry saves its screenshot, and moves nothing afterwards", async () => {
    const card = await refused("item");

    card.failWrites({ ok: true });
    await card.controller.flush();

    expect(card.view()).toBeNull();
    expect(card.saved).toStrictEqual(["item"]);

    await expect(card.saves.addToShelf(1)).resolves.toBeNull();
    expect(card.disk().at(-1)).toStrictEqual({ attached: 1, items: 0 });
    expect(card.shown()).toStrictEqual({ attached: 1, items: 0 });
  });

  it("holds the screenshot once after the shelf's Retry, a second refused write and Discard changes", async () => {
    const card = await refused("item");

    card.failWrites({ ok: true });
    await card.controller.flush();
    card.failWrites({ message: "The disk is full.", ok: false });
    await card.saves.addToShelf(1);
    card.controller.discard(card.note);

    expect(card.shown()).toStrictEqual({ attached: 1, items: 0 });
  });

  it("goes once the shelf's own Retry lands its screenshot, though another item is still not saved", async () => {
    const card = await refused("shelf");
    const row = rowOf(card);

    const other = ItemIdSchema.parse(
      card.controller.apply({ text: "Book the lift", type: "compose" })
    );

    await card.controller.flush();
    card.failWrites({ ok: true });

    const end = card.holdWrite();
    const retry = card.controller.flush();

    // One turn, and the write is on its way with the shelf as it is now.
    await turn();
    // Edited while the shelf's Retry is on its way: that write lands the row, and the shelf still shows its save error for this item.
    card.controller.apply({
      id: other,
      text: "Book the lift for Friday",
      type: "editText",
    });
    end({ ok: true });
    await retry;

    expect(card.controller.view().notSaved).toMatchObject([{ id: other }]);
    expect(card.view()).toBeNull();

    // A press that was already on its way moves nothing.
    await card.saves.addToItem(1, card.note);

    expect(card.shown()).toStrictEqual({ attached: 0, items: 1 });
    expect(card.images()).toMatchObject([{ id: row }]);
    expect(card.saved).toStrictEqual(["shelf"]);
  });

  it("says saved once when the card's own Retry lands it", async () => {
    const card = await refused("shelf");

    card.failWrites({ ok: true });

    await expect(card.saves.addToShelf(1)).resolves.not.toBeNull();
    expect(card.view()).toBeNull();
    // The press's own answer says it; no second notice from the write landing.
    expect(card.saved).toStrictEqual([]);
  });

  it("brings back a row the user deleted, with what they wrote on it, after the screenshot went to an item", async () => {
    const card = await refused("shelf");
    const row = rowOf(card);

    card.controller.apply({
      id: row,
      note: "the red banner",
      type: "editNote",
    });
    card.controller.apply({ id: row, type: "remove" });
    card.failWrites({ ok: true });
    await card.saves.addToItem(1, card.note);
    // The user's own Undo of their own delete: both now hold the picture, and nothing written is lost.
    card.controller.apply({ type: "undoRemove" });

    expect(card.images()).toMatchObject([{ id: row, note: "the red banner" }]);
    expect(card.shown()).toStrictEqual({ attached: 1, items: 1 });
  });
});

/** A card whose first save gave up waiting: its write is still on the disk's way, until `end` says how it went. */
const waitedOut = async (first: "item" | "shelf") => {
  const card = setup();

  await card.controller.flush();
  card.select(card.note, true);
  card.saves.show(shot(1));

  const end = card.holdWrite();

  const adding =
    first === "item"
      ? card.saves.addToItem(1, card.note)
      : card.saves.addToShelf(1);

  await card.giveUpWaiting();
  await adding;

  return { card, end };
};

/** Every write on its way ends, and what follows it has run. */
const settled = async (card: ReturnType<typeof setup>) => {
  await card.controller.flush();
  await turn();
};

const DISK_REFUSES: WriteResult = { message: "The disk is full.", ok: false };

const NO_ACCESS: WriteResult = {
  message: "Inset can’t write to its data folder.",
  ok: false,
};

describe("a save that gave up waiting while its write was still on its way", () => {
  it("says it isn't saved yet, and offers only Retry for that place", async () => {
    const onItem = await waitedOut("item");
    const onShelf = await waitedOut("shelf");

    expect(onItem.card.view()).toMatchObject({
      save: {
        message: SAVE_TOO_SLOW,
        placed: { id: onItem.card.note, to: "item" },
        state: "failed",
      },
      target: null,
    });
    expect(onShelf.card.view()).toMatchObject({
      save: {
        message: SAVE_TOO_SLOW,
        placed: { to: "shelf" },
        state: "failed",
      },
      target: null,
    });
  });

  it("goes once that write lands, with nothing else changing, and says where the screenshot is", async () => {
    const { card, end } = await waitedOut("shelf");

    end({ ok: true });
    await settled(card);

    expect(card.view()).toBeNull();
    expect(card.saved).toStrictEqual(["shelf"]);
    expect(card.disk().at(-1)).toStrictEqual({ attached: 0, items: 1 });
  });

  it("holds the screenshot once when Add to Shelf is pressed before a waited-out Add to “…” lands", async () => {
    const { card, end } = await waitedOut("item");

    // A press of Add to Shelf while the first write is still on its way; every later write is refused.
    const moving = card.saves.addToShelf(1);

    card.failWrites(DISK_REFUSES);
    end({ ok: true });
    await moving;
    await settled(card);
    card.controller.discard(card.note);

    expect(card.shown()).toStrictEqual({ attached: 1, items: 0 });
    expect(card.disk().at(-1)).toStrictEqual({ attached: 1, items: 0 });
    expect(card.view()).toBeNull();
    expect(card.saved).toStrictEqual(["item"]);
    expect(card.notices).toStrictEqual([SHOT_STAYS]);
  });

  it("holds the screenshot once when Add to “…” is pressed before a waited-out Add to Shelf lands", async () => {
    const { card, end } = await waitedOut("shelf");

    // A press of Add to “…” that left the card while it still named the note.
    const moving = card.saves.addToItem(1, card.note);

    card.failWrites(DISK_REFUSES);
    end({ ok: true });
    await moving;
    await settled(card);

    expect(card.shown()).toStrictEqual({ attached: 0, items: 1 });
    expect(card.disk().at(-1)).toStrictEqual({ attached: 0, items: 1 });
    expect(card.view()).toBeNull();
    expect(card.saved).toStrictEqual(["shelf"]);
    expect(card.notices).toStrictEqual([SHOT_STAYS]);
  });

  it("says why once that write is refused, and Retry then saves the screenshot once", async () => {
    const { card, end } = await waitedOut("item");

    end(DISK_REFUSES);
    await settled(card);

    expect(card.view()?.save).toStrictEqual({
      message: "The disk is full.",
      placed: { id: card.note, label: "Quote from the movers", to: "item" },
      state: "failed",
    });

    await expect(card.saves.addToItem(1, card.note)).resolves.toBe(card.note);
    expect(card.attachmentsOn(card.note)).toBe(1);
    expect(card.disk().at(-1)).toStrictEqual({ attached: 1, items: 0 });
    expect(card.view()).toBeNull();
  });

  it("says saved once when Retry waits for that write and it lands", async () => {
    const { card, end } = await waitedOut("shelf");
    const retrying = card.saves.addToShelf(1);

    end({ ok: true });

    await expect(retrying).resolves.toBe(rowOf(card));
    await settled(card);

    expect(card.images()).toHaveLength(1);
    expect(card.view()).toBeNull();
    // The press's own answer says it; no second notice from the write the card followed.
    expect(card.saved).toStrictEqual([]);
  });

  it("holds the screenshot once when Add to Shelf is pressed while the shelf's own Retry is on its way", async () => {
    const card = await refused("item");

    card.failWrites({ ok: true });

    const end = card.holdWrite();
    const retry = card.controller.flush();

    // One turn, and the write is on its way with the screenshot on the item.
    await turn();

    const moving = card.saves.addToShelf(1);

    card.failWrites(DISK_REFUSES);
    end({ ok: true });
    await retry;
    await moving;
    await settled(card);
    card.controller.discard(card.note);

    expect(card.shown()).toStrictEqual({ attached: 1, items: 0 });
    expect(card.view()).toBeNull();
    expect(card.saved).toStrictEqual(["item"]);
    expect(card.notices).toStrictEqual([SHOT_STAYS]);
  });

  it("offers only Retry, with the real reason, once that write is refused", async () => {
    const onItem = await waitedOut("item");
    const onShelf = await waitedOut("shelf");

    onItem.end(DISK_REFUSES);
    onShelf.end(DISK_REFUSES);
    // The refusal arrives; nothing writes again until a Retry.
    await turn();

    expect(onItem.card.view()).toMatchObject({
      save: {
        message: "The disk is full.",
        placed: { id: onItem.card.note, to: "item" },
        state: "failed",
      },
      target: null,
    });
    expect(onShelf.card.view()).toMatchObject({
      save: {
        message: "The disk is full.",
        placed: { to: "shelf" },
        state: "failed",
      },
      target: null,
    });
  });

  it("offers only Retry while its write waits behind another, and goes once it lands", async () => {
    const card = setup();

    await card.controller.flush();
    card.select(card.note, true);
    card.saves.show(shot(1));

    const endAhead = card.holdWrite();
    const end = card.holdWrite();

    card.controller.apply({
      id: card.note,
      text: "Quote from the movers, by Friday",
      type: "editText",
    });

    const ahead = card.controller.flush();
    const adding = card.saves.addToShelf(1);

    await card.giveUpWaiting();
    await adding;

    expect(card.view()).toMatchObject(retryOnly(card, "shelf"));

    endAhead({ ok: true });
    await ahead;
    await turn();

    expect(card.view()).toMatchObject(retryOnly(card, "shelf"));

    end({ ok: true });
    await settled(card);

    expect(card.view()).toBeNull();
    expect(card.saved).toStrictEqual(["shelf"]);
  });

  it("offers both adds, and says nothing of saved, when a write that holds its row lands after the user deleted the row", async () => {
    const { card, end } = await waitedOut("shelf");

    card.controller.apply({ id: rowOf(card), type: "remove" });
    end({ ok: true });
    await settled(card);

    expect(card.view()).toMatchObject({
      save: { placed: null, state: "failed", to: "shelf" },
      target: { id: card.note },
    });
    expect(card.saved).toStrictEqual([]);
  });

  it("keeps what a newer save of the screenshot said when the write an older save waited for is refused", async () => {
    const card = setup();

    await card.controller.flush();
    card.select(card.note, true);
    card.saves.show(shot(1));

    const end = card.holdWrite();

    card.controller.apply({
      id: card.note,
      text: "Quote from the movers, by Friday",
      type: "editText",
    });

    const ahead = card.controller.flush();
    const adding = card.saves.addToShelf(1);

    await card.giveUpWaiting();
    await adding;
    // The user deletes the row, so the screenshot is nowhere and the next add writes its file anew.
    card.controller.apply({ id: rowOf(card), type: "remove" });
    // The newer save: Add to “…”, and the screenshot's file can't be written.
    card.failAttachments(DISK_FULL);
    await card.saves.addToItem(1, card.note);
    card.failWrites(NO_ACCESS);
    end(NO_ACCESS);
    await ahead;
    await settled(card);

    expect(card.view()?.save).toStrictEqual({
      message: "The disk is full.",
      placed: null,
      state: "failed",
      to: "item",
    });
  });

  it("keeps what a newer screenshot's card says when the write an older screenshot waited for is refused", async () => {
    const { card, end } = await waitedOut("shelf");

    card.saves.show(shot(2));
    card.failAttachments(DISK_FULL);
    await card.saves.addToShelf(2);
    end(NO_ACCESS);
    await settled(card);

    expect(card.view()).toMatchObject({
      save: { message: "The disk is full.", state: "failed", to: "shelf" },
      seq: 2,
    });
  });

  it("goes with one notice once the first write lands, though Retry gave up waiting too and a later write is still held", async () => {
    const { card, end } = await waitedOut("shelf");
    const endLater = card.holdWrite();

    // A separate change to the shelf: its write waits behind the first.
    card.controller.apply({ text: "Book the lift", type: "compose" });

    const retrying = card.saves.addToShelf(1);

    await card.giveUpWaiting();
    await retrying;

    expect(card.view()?.save).toStrictEqual({
      message: SAVE_TOO_SLOW,
      placed: { to: "shelf" },
      state: "failed",
    });

    end({ ok: true });
    await turn();

    // The later write is still on its way: the disk holds the first alone.
    expect(card.disk()).toStrictEqual([
      { attached: 0, items: 0 },
      { attached: 0, items: 1 },
    ]);
    expect({ saved: card.saved, view: card.view() }).toStrictEqual({
      saved: ["shelf"],
      view: null,
    });

    endLater({ ok: true });
    await settled(card);

    expect(card.saved).toStrictEqual(["shelf"]);
    expect(card.notices).toStrictEqual([]);
  });

  it("goes with one notice, and no word of a failure, when its write lands while Retry still waits for a later one", async () => {
    const { card, end } = await waitedOut("shelf");
    const endLater = card.holdWrite();

    card.controller.apply({ text: "Book the lift", type: "compose" });

    const retrying = card.saves.addToShelf(1);

    end({ ok: true });
    await turn();

    // Retry waits for every change so far: its own answer comes with the later write, or with its limit.
    expect(card.view()?.save).toStrictEqual({
      placed: { to: "shelf" },
      state: "saving",
    });

    await card.giveUpWaiting();
    await retrying;

    expect({ saved: card.saved, view: card.view() }).toStrictEqual({
      saved: ["shelf"],
      view: null,
    });

    endLater({ ok: true });
    await settled(card);

    expect(card.saved).toStrictEqual(["shelf"]);
    expect(card.notices).toStrictEqual([]);
  });
});

/**
 * What the card draws for the view main last sent: the name of each add the
 * user can press, the pill first, and whether Annotate can be pressed.
 */
const offers = (card: ReturnType<typeof setup>) => {
  const view = card.view();

  if (view === null) {
    return null;
  }

  const { line, pill, sole } = cardAdds(view);

  return {
    adds: [
      pill.name,
      ...(line?.kind === "add" ? [`${line.lead} “${line.name}”`] : []),
    ],
    annotate: !sole,
  };
};

const NOTE = "Quote from the movers";

/** Retry for the note is the card's one add, and Annotate is off. */
const RETRY_ON_NOTE = { adds: [`Retry adding to “${NOTE}”`], annotate: false };

/** Each way the user takes the attached screenshot off its note on the shelf. */
const TAKE_OFF = {
  "Discard changes": (card: ReturnType<typeof setup>) => {
    card.controller.discard(card.note);
  },
  "deleting the note": (card: ReturnType<typeof setup>) => {
    card.controller.apply({ id: card.note, type: "remove" });
  },
  "removing its tile": (card: ReturnType<typeof setup>) => {
    card.controller.apply({
      attachmentId: tileOf(card),
      id: card.note,
      type: "removeAttachment",
    });
  },
};

/** Until the save under way has put the screenshot on the shelf. */
const placedOnShelf = async (card: ReturnType<typeof setup>) => {
  while (card.shown().attached + card.shown().items === 0) {
    // oxlint-disable-next-line no-await-in-loop -- until the add reaches the shelf.
    await turn();
  }
};

describe("the adds the card shows after the shelf changed under it", () => {
  it("offers only Retry for the note, with Annotate off, once Undo brings back the note deleted with the unsaved screenshot on it", async () => {
    const card = await refused("item");

    card.controller.apply({ id: card.note, type: "remove" });
    card.controller.apply({ type: "undoRemove" });

    expect(card.shown()).toStrictEqual({ attached: 1, items: 0 });
    expect(offers(card)).toStrictEqual(RETRY_ON_NOTE);

    card.failWrites({ ok: true });

    await expect(card.saves.addToItem(1, card.note)).resolves.toBe(card.note);
    expect(written(card)).toStrictEqual({
      doubled: [],
      last: { attached: 1, items: 0 },
    });
  });

  it.each(Object.entries(TAKE_OFF))(
    "names the item selected now after a refused Add to “…” and %s, attaches there, and refuses a press that still names the note",
    async (_, takeOff) => {
      const card = await refused("item");

      const other = ItemIdSchema.parse(
        card.controller.apply({ text: "Book the lift", type: "compose" })
      );

      takeOff(card);
      card.select(other, true);

      expect(offers(card)).toStrictEqual({
        adds: ["Add to Shelf", "Add to “Book the lift”"],
        annotate: true,
      });

      card.failWrites({ ok: true });

      // A press that left the card while it still named the note.
      await expect(card.saves.addToItem(1, card.note)).resolves.toBeNull();
      expect({
        notices: card.notices.length,
        onOther: card.attachmentsOn(other),
      }).toStrictEqual({ notices: 1, onOther: 0 });

      await expect(card.saves.addToItem(1, other)).resolves.toBe(other);
      expect({
        onOther: card.attachmentsOn(other),
        view: card.view(),
      }).toStrictEqual({ onOther: 1, view: null });
    }
  );

  it("names no item once the screenshot is off its note and the note has filled up", async () => {
    const card = await refused("item");

    card.controller.apply({
      attachmentId: tileOf(card),
      id: card.note,
      type: "removeAttachment",
    });
    card.fill(card.note);

    expect(offers(card)).toStrictEqual({
      adds: ["Add to Shelf"],
      annotate: true,
    });
  });

  it("doesn't say added, stays, and offers both adds when its row is deleted before the write of it lands", async () => {
    const card = setup();

    await card.controller.flush();
    card.select(card.note, true);
    card.saves.show(shot(1));

    const end = card.holdWrite();
    const adding = card.saves.addToShelf(1);

    await placedOnShelf(card);
    card.controller.apply({ id: rowOf(card), type: "remove" });
    end({ ok: true });

    // Null: main says Added for an id, and focuses its row.
    await expect(adding).resolves.toBeNull();
    expect(card.saved).toStrictEqual([]);
    expect(offers(card)).toStrictEqual({
      adds: ["Add to Shelf", `Add to “${NOTE}”`],
      annotate: true,
    });
  });

  it("offers only Retry again once Undo brings that deleted row back and the disk refuses it", async () => {
    const card = setup();

    await card.controller.flush();
    card.saves.show(shot(1));

    const end = card.holdWrite();
    const adding = card.saves.addToShelf(1);

    await placedOnShelf(card);
    card.controller.apply({ id: rowOf(card), type: "remove" });
    end({ ok: true });
    await adding;
    // The write of the delete lands too: the disk holds no screenshot.
    await settled(card);
    card.failWrites(DISK_REFUSES);
    card.controller.apply({ type: "undoRemove" });
    await settled(card);

    expect(card.shown()).toStrictEqual({ attached: 0, items: 1 });
    expect(card.view()?.save).toMatchObject({ message: "The disk is full." });
    expect(offers(card)).toStrictEqual({ adds: ["Retry"], annotate: true });
  });

  it("doesn't say added, stays, and offers both adds when its tile is removed before the write of it lands", async () => {
    const card = setup();

    await card.controller.flush();
    card.select(card.note, true);
    card.saves.show(shot(1));

    const end = card.holdWrite();
    const adding = card.saves.addToItem(1, card.note);

    await placedOnShelf(card);
    card.controller.apply({
      attachmentId: tileOf(card),
      id: card.note,
      type: "removeAttachment",
    });
    end({ ok: true });

    await expect(adding).resolves.toBeNull();
    expect(card.saved).toStrictEqual([]);
    expect(offers(card)).toStrictEqual({
      adds: ["Add to Shelf", `Add to “${NOTE}”`],
      annotate: true,
    });
  });

  it("holds the screenshot once when Undo brings its deleted row back while a new add's picture file is refused", async () => {
    const card = await refused("shelf");
    const row = rowOf(card);

    card.controller.apply({ id: row, type: "remove" });
    card.failAttachments(DISK_FULL);

    const adding = card.saves.addToItem(1, card.note);

    // The user's Undo of their delete, while the picture file is on its way.
    card.controller.apply({ type: "undoRemove" });

    await expect(adding).resolves.toBeNull();
    expect(offers(card)).toStrictEqual({ adds: ["Retry"], annotate: true });

    card.failAttachments(null);
    card.failWrites({ ok: true });

    await expect(card.saves.addToShelf(1)).resolves.toBe(row);
    expect(written(card)).toStrictEqual({
      doubled: [],
      last: { attached: 0, items: 1 },
    });
  });

  it("says the reason the shelf's own Retry was refused for, not the first one", async () => {
    const card = await refused("item");

    card.failWrites(NO_ACCESS);
    await card.controller.flush();

    expect(card.view()?.save).toMatchObject({
      message: "Inset can’t write to its data folder.",
      state: "failed",
    });
    expect(offers(card)).toStrictEqual(RETRY_ON_NOTE);
  });

  it("keeps the reason the disk gave, not that saving took too long, once the screenshot is taken off the shelf", async () => {
    const { card, end } = await waitedOut("shelf");

    end(DISK_REFUSES);
    await turn();
    card.controller.apply({ id: rowOf(card), type: "remove" });
    await turn();

    expect(card.view()?.save).toStrictEqual({
      message: "The disk is full.",
      placed: null,
      state: "failed",
      to: "shelf",
    });
  });

  it("attaches once when Add to “…” is pressed twice while the first save runs", async () => {
    const card = setup();

    card.select(card.note, true);
    card.saves.show(shot(1));

    const [first, second] = await Promise.all([
      card.saves.addToItem(1, card.note),
      card.saves.addToItem(1, card.note),
    ]);

    expect(first).toBe(card.note);
    expect(second).toBeNull();
    expect(card.attachmentsOn(card.note)).toBe(1);
    expect(written(card).doubled).toStrictEqual([]);
  });
});

/** A press of the pill, the add the card shows first: it goes where the pill says. */
const pressPill = async (card: ReturnType<typeof setup>) => {
  const view = card.view();

  if (view === null) {
    return null;
  }

  const { item } = cardAdds(view).pill;

  return await (item === null
    ? card.saves.addToShelf(view.seq)
    : card.saves.addToItem(view.seq, item));
};

/** Retry for the screenshot's own row is the card's one add. */
const RETRY_ON_ROW = { adds: ["Retry"], annotate: true };

describe("a screenshot the user's Undo brought back to a place an earlier add made", () => {
  it("offers Retry for the restored row, never a fresh Add to Shelf, and holds the screenshot once, after a refused Add to “…”, Undo of the row's delete and the new tile's removal", async () => {
    const card = await refused("shelf");
    const row = rowOf(card);

    card.controller.apply({ id: row, type: "remove" });
    // Refused at the shelf's write: the screenshot is on the note, not saved.
    await card.saves.addToItem(1, card.note);
    card.controller.apply({ type: "undoRemove" });
    await settled(card);
    card.controller.apply({
      attachmentId: tileOf(card),
      id: card.note,
      type: "removeAttachment",
    });
    await settled(card);

    const offered = offers(card);

    card.failWrites({ ok: true });

    const pressed = await pressPill(card);

    await settled(card);

    expect({ offered, pressed, written: written(card) }).toStrictEqual({
      offered: RETRY_ON_ROW,
      pressed: row,
      written: { doubled: [], last: { attached: 0, items: 1 } },
    });
  });

  it("offers one Retry, which main accepts, and no fresh add while the shelf shows the screenshot in both places after the user's Undo", async () => {
    const card = await refused("shelf");

    card.controller.apply({ id: rowOf(card), type: "remove" });
    await card.saves.addToItem(1, card.note);
    // The user's own Undo, after the new add put the screenshot on the note: the shelf shows both because they asked for both.
    card.controller.apply({ type: "undoRemove" });
    await settled(card);

    expect(card.shown()).toStrictEqual({ attached: 1, items: 1 });
    expect(offers(card)).toStrictEqual(RETRY_ON_NOTE);

    card.failWrites({ ok: true });

    await expect(pressPill(card)).resolves.toBe(card.note);
    expect(card.notices).toStrictEqual([]);
    expect(card.view()).toBeNull();
  });

  it("attaches nothing, and holds the screenshot once, when Undo brings its deleted row back while Add to “…” writes its picture file and the shelf's write is then refused", async () => {
    const card = await refused("shelf");
    const row = rowOf(card);

    card.controller.apply({ id: row, type: "remove" });

    const adding = card.saves.addToItem(1, card.note);

    // The user's Undo of their delete, while the picture file is on its way.
    card.controller.apply({ type: "undoRemove" });

    await expect(adding).resolves.toBeNull();
    await settled(card);

    const offered = offers(card);

    card.failWrites({ ok: true });

    const pressed = await pressPill(card);

    await settled(card);

    expect({
      dropped: card.dropped.length,
      notices: card.notices,
      offered,
      pressed,
      written: written(card),
    }).toStrictEqual({
      // The picture file written for the note, where nothing was attached, is gone again.
      dropped: 1,
      notices: [SHOT_STAYS],
      offered: RETRY_ON_ROW,
      pressed: row,
      written: { doubled: [], last: { attached: 0, items: 1 } },
    });
  });

  it("makes no row, and holds the screenshot once, when Undo brings its removed tile back while Add to Shelf writes its picture file and the shelf's write is then refused", async () => {
    const card = await refused("item");
    const tile = tileOf(card);

    card.controller.apply({
      attachmentId: tile,
      id: card.note,
      type: "removeAttachment",
    });

    const adding = card.saves.addToShelf(1);

    // The user's Undo of the tile's removal in details, while the picture file is on its way.
    card.controller.apply({
      attachmentId: tile,
      id: card.note,
      type: "restoreAttachment",
    });

    await expect(adding).resolves.toBeNull();
    await settled(card);

    const offered = offers(card);

    card.failWrites({ ok: true });

    const pressed = await pressPill(card);

    await settled(card);

    expect({
      dropped: card.dropped.length,
      notices: card.notices,
      offered,
      pressed,
      written: written(card),
    }).toStrictEqual({
      dropped: 1,
      notices: [SHOT_STAYS],
      offered: RETRY_ON_NOTE,
      pressed: card.note,
      written: { doubled: [], last: { attached: 1, items: 0 } },
    });
  });
});

/**
 * Add to Shelf pressed while an earlier shelf write is held; the row is
 * deleted before the next write reads the shelf, another change makes that
 * write happen without the row, and Undo brings the row back once that write
 * is on its way. `endRestore` ends the write that holds the row again.
 */
const restoredAfterItsWriteBegan = async () => {
  const card = setup();

  await card.controller.flush();
  card.saves.show(shot(1));

  const endAhead = card.holdWrite();
  const endWithout = card.holdWrite();
  const endRestore = card.holdWrite();

  card.controller.apply({
    id: card.note,
    text: "Quote from the movers, by Friday",
    type: "editText",
  });

  const ahead = card.controller.flush();
  const adding = card.saves.addToShelf(1);

  await placedOnShelf(card);

  const row = rowOf(card);

  card.controller.apply({ id: row, type: "remove" });
  card.controller.apply({ text: "Book the lift", type: "compose" });
  endAhead({ ok: true });
  await ahead;
  // One turn, and the next write is on its way with the shelf as it is now: without the row.
  await turn();
  card.controller.apply({ id: row, type: "undoRemove" });
  endWithout({ ok: true });
  await turn();
  await turn();

  return { adding, card, endRestore, row };
};

describe("a write that landed while the user had the screenshot off the shelf", () => {
  it("keeps the card as Saving…, and says nothing of added, until the write that holds the restored row lands", async () => {
    const { adding, card, endRestore, row } =
      await restoredAfterItsWriteBegan();

    expect({
      disk: card.disk().at(-1),
      offers: offers(card),
      saved: card.saved,
      shown: card.shown(),
    }).toStrictEqual({
      disk: { attached: 0, items: 0 },
      offers: { adds: ["Saving…"], annotate: true },
      saved: [],
      shown: { attached: 0, items: 1 },
    });

    endRestore({ ok: true });

    await expect(adding).resolves.toBe(row);
    expect({ disk: card.disk().at(-1), view: card.view() }).toStrictEqual({
      disk: { attached: 0, items: 1 },
      view: null,
    });
  });

  it("says why, and offers Retry for the row, when the write that holds the restored row is refused", async () => {
    const { adding, card, endRestore } = await restoredAfterItsWriteBegan();

    // The disk still refuses any queued writes and the flush in settled().
    card.failWrites(DISK_REFUSES);
    endRestore(DISK_REFUSES);

    await expect(adding).resolves.toBeNull();
    await settled(card);

    expect({ offers: offers(card), save: card.view()?.save }).toStrictEqual({
      offers: RETRY_ON_ROW,
      save: {
        message: "The disk is full.",
        placed: { to: "shelf" },
        state: "failed",
      },
    });
  });

  it("says where the screenshot landed when Undo restores an older place during a save", async () => {
    const card = await refused("shelf");
    const row = rowOf(card);

    card.controller.apply({ id: row, type: "remove" });
    card.failWrites({ ok: true });
    await settled(card);

    const end = card.holdWrite();
    const adding = card.saves.addToItem(1, card.note);

    await placedOnShelf(card);
    TAKE_OFF["removing its tile"](card);
    card.controller.apply({ id: row, type: "undoRemove" });
    end({ ok: true });

    await expect(adding).resolves.toBeNull();
    expect({
      disk: card.disk().at(-1),
      saved: card.saved,
      view: card.view(),
    }).toStrictEqual({
      disk: { attached: 0, items: 1 },
      saved: ["shelf"],
      view: null,
    });
  });

  it("names the row the shelf shows, not the row this press made, when Undo brings an earlier row back in its place during the save", async () => {
    const card = await refused("shelf");
    const first = rowOf(card);

    card.controller.apply({ id: first, type: "remove" });
    card.failWrites({ ok: true });
    await settled(card);

    const end = card.holdWrite();
    const adding = card.saves.addToShelf(1);

    await placedOnShelf(card);
    card.controller.apply({ id: rowOf(card), type: "remove" });
    card.controller.apply({ id: first, type: "undoRemove" });
    end({ ok: true });

    await expect(adding).resolves.toBe(first);
    expect({ disk: card.disk().at(-1), view: card.view() }).toStrictEqual({
      disk: { attached: 0, items: 1 },
      view: null,
    });
  });
});

/** The scale of every picture of the screenshot the shelf shows, as a row or on the note. */
const scales = (card: ReturnType<typeof setup>) =>
  [
    ...card.images(),
    ...(card.controller.item(card.note)?.attachments ?? []),
  ].flatMap((each) =>
    each.kind === "image" && each.image !== null
      ? [each.image.pixelsPerDip]
      : []
  );

/** A card whose Add to “…” gave up waiting, with the tile then removed in details: the write that holds the tile is still on its way, until `end`. */
const tileOffWhileItsWriteIsHeld = async () => {
  const card = setup();

  await card.controller.flush();
  card.select(card.note, true);
  card.saves.show(shot(1));

  const end = card.holdWrite();
  const adding = card.saves.addToItem(1, card.note);

  await card.giveUpWaiting();
  await adding;
  card.controller.apply({
    attachmentId: tileOf(card),
    id: card.note,
    type: "removeAttachment",
  });

  return { card, end };
};

describe("a screenshot taken off the shelf whose removal the disk doesn't hold yet", () => {
  it("adds nothing anew while a write on its way still holds the screenshot on the note, so Discard changes brings back the only copy", async () => {
    const { card, end } = await tileOffWhileItsWriteIsHeld();

    await expect(card.saves.addToShelf(1)).resolves.toBeNull();

    expect({ notices: card.notices, shown: card.shown() }).toStrictEqual({
      notices: [SHOT_REMOVAL_UNSAVED],
      shown: { attached: 0, items: 0 },
    });

    // The first write lands with the tile; the removal is refused, so the note offers Discard changes.
    card.failWrites(DISK_REFUSES);
    end({ ok: true });
    await settled(card);
    card.controller.discard(card.note);
    card.failWrites({ ok: true });
    await settled(card);

    expect({
      disk: card.disk().at(-1),
      doubled: written(card).doubled,
      shown: card.shown(),
    }).toStrictEqual({
      disk: { attached: 1, items: 0 },
      doubled: [],
      shown: { attached: 1, items: 0 },
    });
  });

  it("adds nothing anew while the disk holds the screenshot on the note and refuses the removal", async () => {
    const { card, end } = await tileOffWhileItsWriteIsHeld();

    card.failWrites(DISK_REFUSES);
    end({ ok: true });
    await settled(card);

    await expect(card.saves.addToShelf(1)).resolves.toBeNull();

    expect({ notices: card.notices, shown: card.shown() }).toStrictEqual({
      notices: [SHOT_REMOVAL_UNSAVED],
      shown: { attached: 0, items: 0 },
    });
  });

  it("makes no row when the tile comes back, starts a write, and is removed again, all while Add to Shelf writes its picture file", async () => {
    const card = await refused("item");
    const tile = { attachmentId: tileOf(card), id: card.note };

    card.controller.apply({ ...tile, type: "removeAttachment" });
    await settled(card);
    card.failWrites({ ok: true });

    const end = card.holdWrite();
    const adding = card.saves.addToShelf(1);

    // The user's Undo starts a write that holds the tile; they remove it again before the picture file is written.
    const write = new EventTarget();

    const off = card.controller.onWrite(() => {
      off();
      write.dispatchEvent(new Event("start"));
    });

    const started = once(write, "start");

    card.controller.apply({ ...tile, type: "restoreAttachment" });
    await started;
    card.controller.apply({ ...tile, type: "removeAttachment" });

    await expect(adding).resolves.toBeNull();

    expect({
      dropped: card.dropped.length,
      // No save runs and nothing is on the shelf: the card has its time again.
      held: card.held(),
      notices: card.notices,
      shown: card.shown(),
    }).toStrictEqual({
      dropped: 1,
      held: false,
      notices: [SHOT_REMOVAL_UNSAVED],
      shown: { attached: 0, items: 0 },
    });

    end({ ok: true });
    await settled(card);
  });

  it("adds nothing anew while Discard changes can still bring the screenshot back to its note, though neither the disk nor a write on its way holds it there", async () => {
    const card = await refused("item");
    const tile = { attachmentId: tileOf(card), id: card.note };

    card.controller.apply({ ...tile, type: "removeAttachment" });
    card.failWrites({ ok: true });
    await settled(card);

    const writePicture = card.holdPicture();
    const adding = card.saves.addToShelf(1);

    // The user's Undo, saved, while the picture file is written; then the tile is off again, and the disk refuses that.
    card.controller.apply({ ...tile, type: "restoreAttachment" });
    await settled(card);
    card.failWrites(DISK_REFUSES);
    card.controller.apply({ ...tile, type: "removeAttachment" });
    await settled(card);

    // The note's deletion is on the disk's way when Undo brings the note back and Discard changes its tile, which is then removed once more.
    const endDeletion = card.holdWrite();

    card.controller.apply({ id: card.note, type: "remove" });
    await turn();
    card.controller.apply({ id: card.note, type: "undoRemove" });

    const offeredDiscard = card.controller.view().notSaved;

    card.controller.discard(card.note);
    card.controller.apply({ ...tile, type: "removeAttachment" });
    endDeletion({ ok: true });
    await settled(card);

    // The disk holds no note now, and no write is on its way: only Discard changes still holds the tile.
    const before = {
      notSaved: card.controller.view().notSaved,
      shown: card.shown(),
      stored: card.controller.stored(card.note),
    };

    writePicture();
    await expect(adding).resolves.toBeNull();
    await settled(card);
    card.controller.discard(card.note);
    card.failWrites({ ok: true });
    // The shelf's own Retry.
    await settled(card);

    expect({
      before,
      dropped: card.dropped.length,
      notices: card.notices,
      offeredDiscard,
      shown: card.shown(),
      written: written(card),
    }).toStrictEqual({
      before: {
        notSaved: [{ id: card.note, undo: "discard" }],
        shown: { attached: 0, items: 0 },
        stored: undefined,
      },
      dropped: 1,
      notices: [SHOT_REMOVAL_UNSAVED],
      offeredDiscard: [{ id: card.note, undo: "discard" }],
      shown: { attached: 1, items: 0 },
      written: { doubled: [], last: { attached: 1, items: 0 } },
    });
  });

  it("adds it to the shelf, once, as soon as the disk holds the removal", async () => {
    const { card, end } = await tileOffWhileItsWriteIsHeld();

    end({ ok: true });
    await settled(card);

    const row = await card.saves.addToShelf(1);

    expect({
      disk: card.disk().at(-1),
      notices: card.notices,
      row: row !== null,
    }).toStrictEqual({
      disk: { attached: 0, items: 1 },
      notices: [],
      row: true,
    });
  });
});

describe("the scale a screenshot is kept at", () => {
  it.each(["shelf", "item"] as const)(
    "is that of the display the pointer was on when the add to the %s was pressed, though the pointer is on another by the time the picture file is written",
    async (to) => {
      const card = setup();

      await card.controller.flush();
      card.select(card.note, true);
      card.saves.show(shot(1));

      const adding =
        to === "shelf"
          ? card.saves.addToShelf(1)
          : card.saves.addToItem(1, card.note);

      card.pointerOn(1);
      await adding;

      expect(scales(card)).toStrictEqual([2]);
    }
  );
});

describe("the reason a failed card gives", () => {
  it("keeps the reason the shelf's own Retry was refused for once the tile is removed, not the first one", async () => {
    const card = await refused("item");

    card.failWrites(NO_ACCESS);
    await card.controller.flush();
    card.controller.apply({
      attachmentId: tileOf(card),
      id: card.note,
      type: "removeAttachment",
    });
    await settled(card);

    expect(card.view()?.save).toMatchObject({
      message: "Inset can’t write to its data folder.",
      placed: null,
      state: "failed",
    });
  });
});

describe("a card whose save landed after the user deleted its screenshot's row", () => {
  it("has its time again, as a card no one pressed, with both adds and no message", async () => {
    const card = setup();

    await card.controller.flush();
    card.select(card.note, true);
    card.saves.show(shot(1));

    const end = card.holdWrite();
    const adding = card.saves.addToShelf(1);

    await placedOnShelf(card);
    card.controller.apply({ id: rowOf(card), type: "remove" });
    end({ ok: true });
    await adding;

    expect({ held: card.held(), save: card.view()?.save }).toStrictEqual({
      held: false,
      save: { state: "idle" },
    });
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

  it("releases a save's hold without overriding hover or Keep on Screen", () => {
    const card = timed();

    card.clock.shown();
    card.clock.holdForSave();
    card.clock.hover(true);
    card.clock.hover(false);
    expect(card.running()).toBeFalsy();

    card.clock.hover(true);
    card.clock.releaseSave();
    expect(card.running()).toBeFalsy();
    card.clock.hover(false);
    expect(card.running()).toBeTruthy();

    card.clock.hold();
    card.clock.holdForSave();
    card.clock.releaseSave();
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

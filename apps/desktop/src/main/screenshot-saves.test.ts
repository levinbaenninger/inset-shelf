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

import { createCardClock } from "./card-clock";
import {
  CARD_CLEARED,
  CARD_RETARGETED,
  CARD_TARGET_GONE,
  cardLabel,
  createShotSaves,
  ITEM_GONE,
  RECENT_ITEM_MS,
  SHOT_CHANGED,
  SHOT_LANDING,
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
  const notices: string[] = [];
  const saved: string[] = [];
  // The card's waits for the disk that are still running, each by what ends it.
  const waits = new Set<() => void>();
  // Filled by holdWrite(): the next writes, in order, each stay on the disk's way until the test ends it.
  const heldWrites: Promise<WriteResult>[] = [];
  const attached: ItemId[] = [];
  const events: string[] = [];
  const disk: ShelfDoc[] = [];
  const deleted: string[] = [];
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
    attachmentToRow: (id, attachmentId) =>
      controller.apply({
        attachmentId,
        id,
        type: "attachmentToItem",
        via: "screenshot",
      }),
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
    onItsWay: (id) => controller.onItsWay(id),
    onWrite: (listener) => controller.onWrite(listener),
    persisted: async () =>
      await controller.persisted(controller.snapshot().rev),
    rowToAttachment: (from, id) => {
      const attachmentId = AttachmentIdSchema.parse(uuid((next += 1)));

      controller.apply({
        attachmentId,
        from,
        id,
        name: "Screenshot",
        type: "itemToAttachment",
      });

      return { attached: [attachmentId], message: null };
    },
    saved: (to) => {
      saved.push(to);
    },
    selection: () => selection,
    setTimer: (run) => {
      waits.add(run);

      return () => {
        waits.delete(run);
      };
    },
    shelfVisible: () => shelfVisible,
    stored: (id) => controller.stored(id),
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
      only: false,
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

  it("says the item is gone when it was deleted before Retry, and never reports it added", async () => {
    const card = setup();

    card.select(card.note, true);
    card.saves.show(shot(1));
    card.failWrites({ message: "The disk is full.", ok: false });
    await card.saves.addToItem(1, card.note);
    card.controller.apply({ id: card.note, type: "remove" });
    card.failWrites({ ok: true });

    await expect(card.saves.addToItem(1, card.note)).resolves.toBeNull();
    expect(card.view()?.save).toStrictEqual({
      message: ITEM_GONE,
      only: false,
      state: "failed",
      to: null,
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

/** Each first destination, with where the shelf holds the screenshot once the other one took it. */
const SWITCHES = [
  { first: "item", moved: { attached: 0, items: 1 } },
  { first: "shelf", moved: { attached: 1, items: 0 } },
] as const;

/** A press of the destination the first save didn't go to. */
const pressOther = async (
  card: Awaited<ReturnType<typeof refused>>,
  first: "item" | "shelf"
) =>
  await (first === "item"
    ? card.saves.addToShelf(1)
    : card.saves.addToItem(1, card.note));

describe("another destination after a failed save", () => {
  it("shows the screenshot where the refused save put it, not saved, until the next choice", async () => {
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

  it("holds the screenshot only as a new item when Add to Shelf follows a refused Add to “…”", async () => {
    const card = await refused("item");

    card.failWrites({ ok: true });

    await expect(card.saves.addToShelf(1)).resolves.not.toBeNull();
    expect(card.shown()).toStrictEqual({ attached: 0, items: 1 });
    expect(card.disk().at(-1)).toStrictEqual({ attached: 0, items: 1 });
    expect(card.disk().filter((each) => each.attached > 0)).toStrictEqual([]);
    expect(card.controller.view()).toMatchObject({ notSaved: [] });
  });

  it("holds the screenshot only on the item when Add to “…” follows a refused Add to Shelf", async () => {
    const card = await refused("shelf");

    card.failWrites({ ok: true });

    await expect(card.saves.addToItem(1, card.note)).resolves.toBe(card.note);
    expect(card.shown()).toStrictEqual({ attached: 1, items: 0 });
    expect(card.disk().at(-1)).toStrictEqual({ attached: 1, items: 0 });
    expect(card.disk().filter((each) => each.items > 0)).toStrictEqual([]);
    // The row left with the choice, not by a delete: Undo has nothing to bring back.
    expect(card.controller.view()).toMatchObject({
      canUndo: false,
      notSaved: [],
    });
  });

  it("takes its picture file along from its row: the item's tile names that file, and none is deleted", async () => {
    const card = await refused("shelf");

    card.failWrites({ ok: true });
    await card.saves.addToItem(1, card.note);

    expect(card.controller.item(card.note)?.attachments).toMatchObject([
      { image: { file: `${uuid(91)}.png` } },
    ]);
    expect(card.deleted).toStrictEqual([]);
  });

  it("takes its picture file along from the item: the new row names that file, and none is deleted", async () => {
    const card = await refused("item");
    const [left] = card.controller.item(card.note)?.attachments ?? [];

    card.failWrites({ ok: true });
    await card.saves.addToShelf(1);

    expect(card.images()).toMatchObject([
      { image: { file: `${left?.id}.png` } },
    ]);
    expect(card.deleted).toStrictEqual([]);
  });

  it.each(SWITCHES)(
    "keeps the screenshot on the shelf, not saved, when the other destination follows a refused add to the $first and the disk takes no new picture file",
    async ({ first, moved }) => {
      const card = await refused(first);

      // The disk takes nothing: no new picture file, and no shelf.
      card.failAttachments(DISK_FULL);

      await expect(pressOther(card, first)).resolves.toBeNull();
      // It is in the place the press chose, and both the card and the shelf offer Retry there.
      expect(card.shown()).toStrictEqual(moved);
      expect(card.view()?.save).toMatchObject({
        message: "The disk is full.",
        state: "failed",
        to: first === "item" ? "shelf" : "item",
      });
      expect(card.controller.view().notSaved).not.toStrictEqual([]);
    }
  );

  it.each(SWITCHES)(
    "holds the screenshot once, with the one picture file, when Retry saves it after such a switch from the $first",
    async ({ first, moved }) => {
      const card = await refused(first);

      card.failAttachments(DISK_FULL);
      await pressOther(card, first);
      card.failWrites({ ok: true });

      await expect(pressOther(card, first)).resolves.not.toBeNull();
      expect(card.shown()).toStrictEqual(moved);
      expect(card.disk().at(-1)).toStrictEqual(moved);
      expect(
        card.disk().filter((each) => each.attached + each.items > 1)
      ).toStrictEqual([]);
      expect(card.deleted).toStrictEqual([]);
    }
  );

  it("leaves the row exactly as it was when the item it would go to has filled up, and Retry saves it", async () => {
    const card = await refused("shelf");
    const [row] = card.images();

    card.fill(card.note);

    // A press of Add to “…” that left the card before it stopped naming the item.
    await card.saves.addToItem(1, card.note);

    expect(card.notices).toStrictEqual([CARD_CLEARED]);
    expect(card.images().at(0)).toBe(row);
    expect(card.view()).toMatchObject({
      save: { state: "failed", to: "shelf" },
      target: null,
    });

    card.failWrites({ ok: true });

    await expect(card.saves.addToShelf(1)).resolves.toBe(row?.id);
    expect(card.disk().at(-1)).toStrictEqual({
      attached: ATTACHMENTS_MAX,
      items: 1,
    });
  });

  it("keeps the picture of a tile the user took off after the move and put back with Undo", async () => {
    const card = await refused("shelf");

    await card.saves.addToItem(1, card.note);

    const [tile] = card.controller.item(card.note)?.attachments ?? [];

    card.controller.apply({
      attachmentId: AttachmentIdSchema.parse(tile?.id),
      id: card.note,
      type: "removeAttachment",
    });
    card.failWrites({ ok: true });
    await card.controller.flush();
    card.controller.apply({
      attachmentId: AttachmentIdSchema.parse(tile?.id),
      id: card.note,
      type: "restoreAttachment",
    });

    expect(card.controller.item(card.note)?.attachments).toStrictEqual([tile]);
    expect(card.deleted).not.toContain(
      tile?.kind === "image" ? tile.image.file : ""
    );
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

  it("offers the other destination while its row is as the card made it, and only Retry once the user wrote on it", async () => {
    const card = await refused("shelf");

    expect(card.view()).toMatchObject({
      save: { to: "shelf" },
      target: { id: card.note },
    });
    expect(card.view()?.save).not.toMatchObject({ only: true });

    await writeOnRow(card);

    expect(card.view()).toMatchObject({
      save: { only: true, state: "failed", to: "shelf" },
      target: null,
    });
  });

  it("never drops a row the user wrote on, and Retry saves it with their words", async () => {
    const card = await refused("shelf");
    const row = await writeOnRow(card);

    // A press of Add to “…” that left the card while it still named the note.
    await card.saves.addToItem(1, card.note);

    expect(card.images()).toMatchObject([{ id: row, note: "the red banner" }]);
    expect(card.notices).toStrictEqual([SHOT_CHANGED]);

    card.failWrites({ ok: true });

    await expect(card.saves.addToShelf(1)).resolves.toBe(row);
    expect(card.disk().at(-1)).toStrictEqual({ attached: 0, items: 1 });
    expect(card.images()).toMatchObject([{ id: row, note: "the red banner" }]);
  });

  it("offers Add to Shelf while its attachment is as the card made it, and only Retry once the user drew on it", async () => {
    const card = await refused("item");

    expect(card.view()?.save).not.toMatchObject({ only: true });

    await drawOnTile(card);

    expect(card.view()).toMatchObject({
      save: { only: true, state: "failed", to: "item" },
      target: { id: card.note },
    });
  });

  it("never takes off an attachment the user drew on, and Retry saves it with their marks", async () => {
    const card = await refused("item");
    const tile = await drawOnTile(card);

    // A press of Add to Shelf that left the card before the button went.
    await card.saves.addToShelf(1);

    expect(card.controller.item(card.note)?.attachments).toMatchObject([
      { id: tile, pins: [PIN] },
    ]);
    expect(card.notices).toStrictEqual([SHOT_CHANGED]);

    card.failWrites({ ok: true });

    await expect(card.saves.addToItem(1, card.note)).resolves.toBe(card.note);
    expect(card.disk().at(-1)).toStrictEqual({ attached: 1, items: 0 });
    expect(card.controller.item(card.note)?.attachments).toMatchObject([
      { id: tile, pins: [PIN] },
    ]);
  });

  it("leaves a changed attachment alone when the user's change was to the item's own words", async () => {
    const card = await refused("item");

    card.controller.apply({
      id: card.note,
      text: "Quote from the movers, by Friday",
      type: "editText",
    });
    await card.controller.flush();

    // The screenshot itself is as the card attached it, so it may still go to the shelf; the item keeps its words.
    expect(card.view()?.save).toMatchObject({ state: "failed", to: "item" });
    expect(card.view()?.save).not.toMatchObject({ only: true });

    card.failWrites({ ok: true });

    await expect(card.saves.addToShelf(1)).resolves.not.toBeNull();
    expect(card.controller.item(card.note)).toMatchObject({
      attachments: [],
      text: "Quote from the movers, by Friday",
    });
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
  it("says it isn't saved yet, and offers only Retry while that write can still land", async () => {
    const onItem = await waitedOut("item");
    const onShelf = await waitedOut("shelf");

    expect(onItem.card.view()).toMatchObject({
      save: { message: SAVE_TOO_SLOW, only: true, state: "failed", to: "item" },
      target: { id: onItem.card.note },
    });
    expect(onShelf.card.view()).toMatchObject({
      save: {
        message: SAVE_TOO_SLOW,
        only: true,
        state: "failed",
        to: "shelf",
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
    expect(card.notices).toStrictEqual([SHOT_LANDING]);
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
    expect(card.notices).toStrictEqual([SHOT_LANDING]);
  });

  it("says why once that write is refused, and Retry then saves the screenshot once", async () => {
    const { card, end } = await waitedOut("item");

    end(DISK_REFUSES);
    await settled(card);

    expect(card.view()?.save).toStrictEqual({
      message: "The disk is full.",
      only: false,
      state: "failed",
      to: "item",
    });

    await expect(card.saves.addToItem(1, card.note)).resolves.toBe(card.note);
    expect(card.attachmentsOn(card.note)).toBe(1);
    expect(card.disk().at(-1)).toStrictEqual({ attached: 1, items: 0 });
    expect(card.view()).toBeNull();
  });

  it("offers the other destination again once that write is refused", async () => {
    const { card, end } = await waitedOut("item");

    end(DISK_REFUSES);
    await settled(card);

    await expect(card.saves.addToShelf(1)).resolves.not.toBeNull();
    expect(card.shown()).toStrictEqual({ attached: 0, items: 1 });
    expect(card.disk().filter((each) => each.attached > 0)).toStrictEqual([]);
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
    expect(card.notices).toStrictEqual([SHOT_LANDING]);
  });

  it("still moves a screenshot whose write hasn't started: the write ahead of it doesn't hold it", async () => {
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

    expect(card.view()).toMatchObject({
      save: { only: false, state: "failed", to: "shelf" },
      target: { id: card.note },
    });

    const moving = card.saves.addToItem(1, card.note);

    end({ ok: true });
    await ahead;

    await expect(moving).resolves.toBe(card.note);
    await settled(card);

    expect(card.shown()).toStrictEqual({ attached: 1, items: 0 });
    expect(card.disk().filter((each) => each.items > 0)).toStrictEqual([]);
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
      only: false,
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
      only: true,
      state: "failed",
      to: "shelf",
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
    expect(card.view()?.save).toStrictEqual({ state: "saving", to: "shelf" });

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

  it("offers only Retry from the moment a write that waited starts and holds its screenshot, and goes once it lands", async () => {
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

    // Its write waits behind the edit's: the screenshot may still go to the note.
    expect(card.view()).toMatchObject({
      save: { only: false, state: "failed", to: "shelf" },
      target: { id: card.note },
    });

    endAhead({ ok: true });
    await ahead;
    await turn();

    // Nothing on the shelf changed: the write that waited started, and it holds the row.
    expect(card.disk().at(-1)).toStrictEqual({ attached: 0, items: 0 });
    expect(card.view()).toMatchObject({
      save: { only: true, state: "failed", to: "shelf" },
      target: null,
    });

    end({ ok: true });
    await settled(card);

    expect(card.view()).toBeNull();
    expect(card.saved).toStrictEqual(["shelf"]);
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

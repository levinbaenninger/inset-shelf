import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setImmediate } from "node:timers/promises";

import type {
  AttachResult,
  ScreenshotView,
  ShotSaveTo,
} from "@shared/contracts";
import {
  AttachmentIdSchema,
  ATTACHMENTS_MAX,
  emptyShelf,
  ItemIdSchema,
  SectionIdSchema,
} from "@shared/shelf";
import type { AttachmentId, ItemId, ShelfDoc } from "@shared/shelf";
import { describe, expect, it, vi } from "vite-plus/test";

import { cardAdds } from "../renderer/screenshot/card-adds";
import { createCardClock } from "./card-clock";
import { createDragStaging } from "./exports";
import {
  CARD_CLEARED,
  CARD_RETARGETED,
  CARD_TARGET_GONE,
  cardLabel,
  createShotSaves,
  SHOT_ON_SHELF,
  SHOT_REMOVAL_UNSAVED,
  SHOT_STAYS,
} from "./screenshot-saves";
import type { Shot } from "./screenshot-saves";
import { createShelfController } from "./shelf-controller";
import type { WriteResult } from "./shelf-store";
import { createShotDrop } from "./shot-drop";
import type { ShotDropDeps } from "./shot-drop";

// Staging never draws a picture.
vi.mock(import("electron"), () => ({}));

const SAVE_TOO_SLOW = "Saving didn’t finish in time.";

const uuid = (n: number) =>
  `5b2d8f4e-1c3a-4e6b-9d0f-2a3b4c5d6e${String(n).padStart(2, "0")}`;

const NOW = Date.parse("2026-11-25T10:00:00.000Z");

/** A screenshot on the card, as main holds it: named as the system saved it, or Screenshot.png. */
type CardShot = Shot & { readonly name: string };

const shot = (seq: number): CardShot => ({
  heightPx: 600,
  name: "Screenshot.png",
  png: new Uint8Array([137, 80, 78, 71, seq]),
  seq,
  widthPx: 800,
});

const ITEM_FULL = `Nothing was attached. An item holds up to ${ATTACHMENTS_MAX}.`;

const ITEM_GONE = "This item no longer exists.";

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
 * view it was given, and the notices said.
 */
const setup = () => {
  let next = 10;
  let writes: WriteResult = { ok: true };
  let attachmentWrites: Error | null = null;
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
  // Filled by breakCardOnce(): the next change to the card's view throws it, as a window gone at quit does.
  let cardBreaks: Error | null = null;
  // The card's 12 seconds while they run: the test lets them pass by hand.
  let time: (() => void) | null = null;

  // The card's own clock, wired as screenshot-window.ts wires it.
  const cardClock = createCardClock({
    expire: () => {
      view = null;
    },
    setTimer: (run) => {
      time = run;

      return () => {
        time = null;
      };
    },
  });

  const controller = createShelfController({
    deleteAttachment: async (file) => {
      await Promise.resolve();
      deleted.push(file);
    },
    env: {
      newItemId: () => ItemIdSchema.parse(uuid((next += 1))),
      newSectionId: () => SectionIdSchema.parse(uuid((next += 1))),
      now: () => new Date(NOW),
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

  const saves = createShotSaves<CardShot>({
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
      // A deleted item or a full one takes nothing, as attachResult in attachments.ts says it.
      if (controller.item(id) === undefined) {
        return { attached: [], message: ITEM_GONE };
      }

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
        cardClock.hidden();
        events.push("hide");
      },
      holdForSave: cardClock.holdForSave,
      isVisible: () => view !== null,
      show: (shown) => {
        view = shown;
        cardClock.shown();
      },
      update: (change) => {
        const broken = cardBreaks;

        cardBreaks = null;

        if (broken !== null) {
          throw broken;
        }

        if (view !== null) {
          view = { ...view, ...change };
        }
      },
      view: () => view,
    },
    imageUrl: (each) => `inset://shot/${each.seq}`,
    item: controller.item,
    notify: (message) => {
      notices.push(message);
    },
    comesBack: (id) => controller.comesBack(id),
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
    setTimer: (run) => {
      waits.add(run);

      return () => {
        waits.delete(run);
      };
    },
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
    /** The next change to the card's view throws `error`. */
    breakCardOnce: (error: Error) => {
      cardBreaks = error;
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
    /** The card shows, and its time is stopped. */
    held: () => view !== null && time === null,
    /** The card's 12 seconds end now, if they are running. */
    runOut: () => {
      time?.();
    },
    /** The card's 12 seconds pass, unless its time is stopped. */
    elapse: () => {
      const run = time;

      time = null;
      run?.();
    },
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
    view: () => view,
  };
};

/** The card's picture dropped on an item, its drag started just before, as main hands the drop to the card. */
const dropOn = async (card: ReturnType<typeof setup>, id: ItemId) =>
  (await card.saves.drag(1)?.drop.onItem(id, shot(1).png)) ?? null;

describe("the screenshot card's save path", () => {
  it("adds the screenshot, then the card goes once the disk holds it", async () => {
    const card = setup();

    card.saves.show(shot(1));

    const saving = card.saves.addToShelf(1);

    expect(card.view()?.save).toStrictEqual({
      placed: null,
      state: "saving",
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

  it("offers its add again, not Saving… for good, when the card can't show that the save started", async () => {
    const card = setup();

    card.saves.show(shot(1));
    card.breakCardOnce(new Error("Object has been destroyed"));

    const first = await card.saves.addToShelf(1).catch(() => "threw");

    const second = await card.saves.addToShelf(1);

    expect({
      first,
      rows: card.images().map((each) => each.id),
    }).toStrictEqual({ first: null, rows: [second] });
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

describe("a drop on an item, and the only Retry for it", () => {
  it("attaches once, and Retry after a failed write never attaches twice", async () => {
    const card = setup();

    card.saves.show(shot(1));
    card.failWrites({ message: "The disk is full.", ok: false });

    await expect(dropOn(card, card.note)).resolves.toBeNull();
    expect(card.view()?.save).toMatchObject({
      placed: { id: card.note, to: "item" },
      state: "failed",
    });

    card.failWrites({ ok: true });

    await expect(card.saves.addToItem(1, card.note)).resolves.toBe(card.note);
    expect(card.attached).toStrictEqual([card.note]);
  });

  it("still attaches when the card's time ran out between the drop and its arrival", async () => {
    const card = setup();

    card.saves.show(shot(1));
    // The drop left the shelf while the card showed; its 12 seconds ended before it reached main.
    card.runOut();

    expect(card.view()).toBeNull();
    await expect(dropOn(card, card.note)).resolves.toBe(card.note);
    expect(card.attached).toStrictEqual([card.note]);
    expect(card.notices).toStrictEqual([]);
  });

  it("says why, and attaches nothing, when the item was deleted before the drop reached main", async () => {
    const card = setup();

    card.saves.show(shot(1));
    card.controller.apply({ id: card.note, type: "remove" });

    await expect(dropOn(card, card.note)).resolves.toBeNull();
    expect({ attached: card.attached, save: card.view()?.save }).toStrictEqual({
      attached: [],
      save: { message: ITEM_GONE, placed: null, state: "failed", to: null },
    });
  });

  it("attaches again on another drop when Discard changes took the unsaved screenshot off the item", async () => {
    const card = setup();

    await card.controller.flush();
    card.saves.show(shot(1));
    card.failWrites({ message: "The disk is full.", ok: false });
    await dropOn(card, card.note);

    expect(card.controller.discard(card.note)).toBeTruthy();
    expect(card.attachmentsOn(card.note)).toBe(0);

    card.failWrites({ ok: true });

    await expect(dropOn(card, card.note)).resolves.toBe(card.note);
    expect(card.attachmentsOn(card.note)).toBe(1);
    expect(card.view()).toBeNull();
  });

  it("refuses a Retry that names the item once it was deleted, with one notice, and attaches nothing", async () => {
    const card = setup();

    card.saves.show(shot(1));
    card.failWrites({ message: "The disk is full.", ok: false });
    await dropOn(card, card.note);
    card.controller.apply({ id: card.note, type: "remove" });
    card.failWrites({ ok: true });

    await expect(card.saves.addToItem(1, card.note)).resolves.toBeNull();
    expect(card.notices).toStrictEqual([CARD_TARGET_GONE]);
    expect(card.view()?.save).toMatchObject({
      placed: null,
      state: "failed",
      to: null,
    });
    // Once, by the refused save; the Retry attached nothing.
    expect(card.attached).toStrictEqual([card.note]);
  });

  it("offers no Retry when the item filled up while the screenshot's file was written", async () => {
    const card = setup();

    card.saves.show(shot(1));

    const adding = dropOn(card, card.note);

    card.fill(card.note);

    await expect(adding).resolves.toBeNull();
    expect(card.view()?.save).toMatchObject({
      message: ITEM_FULL,
      state: "failed",
      to: null,
    });
    expect(card.attachmentsOn(card.note)).toBe(ATTACHMENTS_MAX);
  });

  it("offers no Retry when Discard changes took the screenshot off and the item filled up meanwhile", async () => {
    const card = setup();

    await card.controller.flush();
    card.saves.show(shot(1));
    card.failWrites({ message: "The disk is full.", ok: false });
    await dropOn(card, card.note);
    card.controller.discard(card.note);
    card.failWrites({ ok: true });
    card.fill(card.note);

    expect(card.view()?.save).toMatchObject({
      placed: null,
      state: "failed",
      to: null,
    });

    // A press of the only Retry that left the card before Discard changes.
    await expect(card.saves.addToItem(1, card.note)).resolves.toBeNull();
    expect(card.notices).toStrictEqual([CARD_CLEARED]);
    expect(card.attachmentsOn(card.note)).toBe(ATTACHMENTS_MAX);
  });
});

/** A card whose first save the disk refused: the shelf holds the screenshot where that save put it, unsaved. */
const refused = async (first: "item" | "shelf") => {
  const card = setup();

  await card.controller.flush();
  card.saves.show(shot(1));
  card.failWrites({ message: "The disk is full.", ok: false });
  await (first === "item" ? dropOn(card, card.note) : card.saves.addToShelf(1));

  return card;
};

/** A press of Add to Shelf, or a drop on the note: the destination the first save didn't go to. */
const pressOther = async (
  card: Awaited<ReturnType<typeof refused>>,
  first: "item" | "shelf"
) =>
  await (first === "item" ? card.saves.addToShelf(1) : dropOn(card, card.note));

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

  it("offers Add to Shelf again once the user deletes its row, and a drop on the note then holds it once, on the item", async () => {
    const card = await refused("shelf");

    card.controller.apply({ id: rowOf(card), type: "remove" });

    expect(card.view()?.save).toMatchObject({
      placed: null,
      state: "failed",
      to: "shelf",
    });

    card.failWrites({ ok: true });

    await expect(dropOn(card, card.note)).resolves.toBe(card.note);
    expect(card.shown()).toStrictEqual({ attached: 1, items: 0 });
    expect(written(card)).toStrictEqual({
      doubled: [],
      last: { attached: 1, items: 0 },
    });
    expect(card.view()).toBeNull();
  });

  it("offers Add to Shelf again once Discard changes takes its attachment off the item, and Add to Shelf then holds it once, as an item", async () => {
    const card = await refused("item");

    card.controller.discard(card.note);

    expect(card.view()?.save).toMatchObject({
      placed: null,
      state: "failed",
      to: null,
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

/** The attachment a drop on the note made of the card's screenshot. */
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

    // A drop on the note that reached main after the card went.
    await dropOn(card, card.note);

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

    // A drop on the note while the card still offered Retry for the row.
    await dropOn(card, card.note);

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

    // A drop that was already on its way moves nothing.
    await dropOn(card, card.note);

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
    await dropOn(card, card.note);
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
  card.saves.show(shot(1));

  const end = card.holdWrite();

  const adding =
    first === "item" ? dropOn(card, card.note) : card.saves.addToShelf(1);

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
    });
    expect(onShelf.card.view()).toMatchObject({
      save: {
        message: SAVE_TOO_SLOW,
        placed: { to: "shelf" },
        state: "failed",
      },
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

  it("holds the screenshot once when Add to Shelf is pressed before a waited-out drop on the note lands", async () => {
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

  it("holds the screenshot once when it is dropped on the note before a waited-out Add to Shelf lands", async () => {
    const { card, end } = await waitedOut("shelf");

    // A drop on the note while the first write is still on its way.
    const moving = dropOn(card, card.note);

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
    });
    expect(onShelf.card.view()).toMatchObject({
      save: {
        message: "The disk is full.",
        placed: { to: "shelf" },
        state: "failed",
      },
    });
  });

  it("offers only Retry while its write waits behind another, and goes once it lands", async () => {
    const card = setup();

    await card.controller.flush();
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

  it("offers Add to Shelf again, and says nothing of saved, when a write that holds its row lands after the user deleted the row", async () => {
    const { card, end } = await waitedOut("shelf");

    card.controller.apply({ id: rowOf(card), type: "remove" });
    end({ ok: true });
    await settled(card);

    expect(card.view()?.save).toMatchObject({
      placed: null,
      state: "failed",
      to: "shelf",
    });
    expect(card.saved).toStrictEqual([]);
  });

  it("keeps what a newer save of the screenshot said when the write an older save waited for is refused", async () => {
    const card = setup();

    await card.controller.flush();
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
    // The newer save: a drop on the note, and the screenshot's file can't be written.
    card.failAttachments(DISK_FULL);
    await dropOn(card, card.note);
    card.failWrites(NO_ACCESS);
    end(NO_ACCESS);
    await ahead;
    await settled(card);

    expect(card.view()?.save).toStrictEqual({
      message: "The disk is full.",
      placed: null,
      state: "failed",
      to: null,
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
 * user can press, and whether Annotate can be pressed.
 */
const offers = (card: ReturnType<typeof setup>) => {
  const view = card.view();

  if (view === null) {
    return null;
  }

  const { pill, sole } = cardAdds(view);

  return { adds: [pill.name], annotate: !sole };
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
    "offers Add to Shelf after a refused drop and %s, refuses the only Retry's late press, and attaches a drop on another item there",
    async (_, takeOff) => {
      const card = await refused("item");

      const other = ItemIdSchema.parse(
        card.controller.apply({ text: "Book the lift", type: "compose" })
      );

      takeOff(card);

      expect(offers(card)).toStrictEqual({
        adds: ["Add to Shelf"],
        annotate: true,
      });

      card.failWrites({ ok: true });

      // A press of the only Retry that left the card before the screenshot came off the note.
      await expect(card.saves.addToItem(1, card.note)).resolves.toBeNull();
      expect({
        notices: card.notices.length,
        onOther: card.attachmentsOn(other),
      }).toStrictEqual({ notices: 1, onOther: 0 });

      await expect(dropOn(card, other)).resolves.toBe(other);
      expect({
        onOther: card.attachmentsOn(other),
        view: card.view(),
      }).toStrictEqual({ onOther: 1, view: null });
    }
  );

  it("doesn't say added, stays, and offers Add to Shelf again when its row is deleted before the write of it lands", async () => {
    const card = setup();

    await card.controller.flush();
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
      adds: ["Add to Shelf"],
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

  it("doesn't say added, stays, and offers Add to Shelf again when its tile is removed before the write of it lands", async () => {
    const card = setup();

    await card.controller.flush();
    card.saves.show(shot(1));

    const end = card.holdWrite();
    const adding = dropOn(card, card.note);

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
      adds: ["Add to Shelf"],
      annotate: true,
    });
  });

  it("holds the screenshot once when Undo brings its deleted row back while a new add's picture file is refused", async () => {
    const card = await refused("shelf");
    const row = rowOf(card);

    card.controller.apply({ id: row, type: "remove" });
    card.failAttachments(DISK_FULL);

    const adding = dropOn(card, card.note);

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

  it("attaches once when the screenshot is dropped twice while the first save runs", async () => {
    const card = setup();

    card.saves.show(shot(1));

    const [first, second] = await Promise.all([
      dropOn(card, card.note),
      dropOn(card, card.note),
    ]);

    expect(first).toBe(card.note);
    expect(second).toBeNull();
    expect(card.attachmentsOn(card.note)).toBe(1);
    expect(written(card).doubled).toStrictEqual([]);
  });
});

describe("a screenshot dropped on an item", () => {
  it("attaches once to an item off the shelf, reading Saving… while it writes, and the disk holds one copy", async () => {
    const card = setup();

    card.saves.show(shot(1));

    const dropping = dropOn(card, card.note);
    const saving = card.view()?.save;

    await expect(dropping).resolves.toBe(card.note);
    expect({
      attached: card.attachmentsOn(card.note),
      saving,
      view: card.view(),
      written: written(card),
    }).toStrictEqual({
      attached: 1,
      saving: { placed: null, state: "saving" },
      view: null,
      written: { doubled: [], last: { attached: 1, items: 0 } },
    });
  });

  it("is Retry, and attaches no second, when dropped on the item the shelf shows it on", async () => {
    const card = await refused("item");

    card.failWrites({ ok: true });

    await expect(dropOn(card, card.note)).resolves.toBe(card.note);
    expect({
      attached: card.attachmentsOn(card.note),
      written: written(card),
    }).toStrictEqual({
      attached: 1,
      written: { doubled: [], last: { attached: 1, items: 0 } },
    });
  });

  it("refuses a drop on another item, and Add to Shelf, while the shelf shows it on the note, and places nothing", async () => {
    const card = await refused("item");

    const other = ItemIdSchema.parse(
      card.controller.apply({ text: "Book the lift", type: "compose" })
    );

    card.failWrites({ ok: true });

    await expect(dropOn(card, other)).resolves.toBeNull();
    await expect(card.saves.addToShelf(1)).resolves.toBeNull();
    expect({
      notices: card.notices,
      onOther: card.attachmentsOn(other),
      shown: card.shown(),
    }).toStrictEqual({
      notices: [SHOT_STAYS, SHOT_STAYS],
      onOther: 0,
      shown: { attached: 1, items: 0 },
    });

    await expect(card.saves.addToItem(1, card.note)).resolves.toBe(card.note);
    expect(written(card).doubled).toStrictEqual([]);
  });

  it("refuses a drop on its own row, or on any item, while the shelf shows it as a row", async () => {
    const card = await refused("shelf");

    card.failWrites({ ok: true });

    await expect(dropOn(card, rowOf(card))).resolves.toBeNull();
    await expect(dropOn(card, card.note)).resolves.toBeNull();
    expect({
      notices: card.notices,
      shown: card.shown(),
    }).toStrictEqual({
      notices: [SHOT_STAYS, SHOT_STAYS],
      shown: { attached: 0, items: 1 },
    });
  });

  it("says in a notice why a drop that came after the card's time ran out failed", async () => {
    const late = setup();

    late.saves.show(shot(1));
    late.runOut();
    late.failAttachments(DISK_FULL);

    await expect(dropOn(late, late.note)).resolves.toBeNull();
    expect({
      attached: late.attachmentsOn(late.note),
      notices: late.notices,
      view: late.view(),
    }).toStrictEqual({
      attached: 0,
      notices: ["The disk is full."],
      view: null,
    });
  });

  it("says why a drop whose picture file was refused failed, and offers Add to Shelf, not Retry: another drag is the retry", async () => {
    const card = setup();

    card.saves.show(shot(1));
    card.failAttachments(DISK_FULL);

    await expect(dropOn(card, card.note)).resolves.toBeNull();
    expect(card.view()?.save).toStrictEqual({
      message: "The disk is full.",
      placed: null,
      state: "failed",
      to: null,
    });
    expect(offers(card)).toStrictEqual({
      adds: ["Add to Shelf"],
      annotate: true,
    });
  });

  it("refuses the only Retry's late press for the note once the shelf shows the screenshot on another item, and attaches nothing there", async () => {
    const card = await refused("item");

    const other = ItemIdSchema.parse(
      card.controller.apply({ text: "Book the lift", type: "compose" })
    );

    TAKE_OFF["removing its tile"](card);
    // Writes still fail: the drop on the other item places the screenshot there, not saved.
    await dropOn(card, other);

    // A press of the note's only Retry that left the card before the tile came off.
    await expect(card.saves.addToItem(1, card.note)).resolves.toBeNull();
    expect({
      notices: card.notices,
      onNote: card.attachmentsOn(card.note),
      onOther: card.attachmentsOn(other),
    }).toStrictEqual({
      notices: [CARD_RETARGETED],
      onNote: 0,
      onOther: 1,
    });

    card.failWrites({ ok: true });

    await expect(card.saves.addToItem(1, other)).resolves.toBe(other);
    expect(written(card).doubled).toStrictEqual([]);
  });

  it("refuses the only Retry's late press once the tile came off and its removal is saved, and attaches nothing", async () => {
    const card = await refused("item");

    TAKE_OFF["removing its tile"](card);
    card.failWrites({ ok: true });
    await settled(card);

    // A press of the only Retry that left the card before the tile came off.
    await expect(card.saves.addToItem(1, card.note)).resolves.toBeNull();
    expect({
      attached: card.attachmentsOn(card.note),
      notices: card.notices,
    }).toStrictEqual({ attached: 0, notices: [CARD_CLEARED] });
  });
});

const OTHER_FILE = "/Users/anna/Desktop/offer.pdf";

/** Where macOS saved the card's screenshot: the user's own file, which they can edit and drag in from Finder. */
const USER_FILE = "/Users/anna/Desktop/Screenshot 2026-11-25 at 10.00.00.png";

/** What the shelf's plain attach answered for a file from outside. */
const PLAIN: AttachResult = {
  attached: [AttachmentIdSchema.parse(uuid(90))],
  message: null,
};

/** The shelf's drop handlers in main over the card's real save path: what the plain routes were handed, what the card said it added, and what failed on the way. The card's drags stage their copies on disk as main stages them, unless `deps` says otherwise, and `quit` sweeps them as main does at quit. */
const dropping = (
  card: ReturnType<typeof setup>,
  deps: Partial<ShotDropDeps<CardShot>> = {}
) => {
  const staging = createDragStaging(
    mkdtempSync(path.join(tmpdir(), "inset-temp-"))
  );

  const plain: unknown[] = [];
  const added: (readonly [ShotSaveTo, ItemId])[] = [];
  const dropped: ShotSaveTo[] = [];
  const failed: (readonly ["drag" | "drop", string])[] = [];

  const drop = createShotDrop({
    addFiles: async (paths) => {
      await turn();
      plain.push({ call: "addFiles", paths });
    },
    added: (to, id) => {
      added.push([to, id]);
    },
    attachFiles: async (id, paths) => {
      await turn();
      plain.push({ call: "attachFiles", id, paths });

      return PLAIN;
    },
    dragFailed: (why) => {
      failed.push(["drag", why]);
    },
    dropFailed: (why) => {
      failed.push(["drop", why]);
    },
    dropped: (to) => {
      dropped.push(to);
    },
    saves: card.saves,
    stage: (each, folder, name) => staging.write(folder, name, each.png),
    unstage: (folder) => {
      staging.clear(folder);
    },
    ...deps,
  });

  return {
    added,
    drop,
    dropped,
    failed,
    plain,
    quit: () => {
      staging.clear();
    },
  };
};

describe("the card's file dropped on the shelf", () => {
  it("adds exactly one tile through the card's own add, and the card goes saying Added, when it is dropped on an item", async () => {
    const card = setup();

    card.saves.show(shot(1));

    const { added, drop, dropped, plain } = dropping(card);

    const file = drop.drag(1)?.file ?? "";

    // The shelf's drop says nothing: the card says how it went.
    await expect(drop.onItem(card.note, [file])).resolves.toStrictEqual({
      attached: [],
      message: null,
    });
    await vi.waitFor(() => {
      expect(added).toHaveLength(1);
    });
    expect({
      added,
      attached: card.attachmentsOn(card.note),
      dropped,
      plain,
      view: card.view(),
      written: written(card),
    }).toStrictEqual({
      added: [["item", card.note]],
      attached: 1,
      dropped: ["item"],
      plain: [],
      view: null,
      written: { doubled: [], last: { attached: 1, items: 0 } },
    });
  });

  it("attaches any other file as before, and a drop of several files with the card's among them too", async () => {
    const card = setup();

    card.saves.show(shot(1));

    const { added, drop, dropped, plain } = dropping(card);

    const file = drop.drag(1)?.file ?? "";

    await expect(drop.onItem(card.note, [OTHER_FILE])).resolves.toBe(PLAIN);
    await expect(drop.onItem(card.note, [file, OTHER_FILE])).resolves.toBe(
      PLAIN
    );
    drop.onShelf([OTHER_FILE]);
    await vi.waitFor(() => {
      expect(plain).toHaveLength(3);
    });
    expect({
      added,
      attached: card.attachmentsOn(card.note),
      dropped,
      plain,
      save: card.view()?.save,
    }).toStrictEqual({
      added: [],
      attached: 0,
      dropped: [],
      plain: [
        { call: "attachFiles", id: card.note, paths: [OTHER_FILE] },
        { call: "attachFiles", id: card.note, paths: [file, OTHER_FILE] },
        { call: "addFiles", paths: [OTHER_FILE] },
      ],
      save: { state: "idle" },
    });
  });

  it.each(["item", "shelf"] as const)(
    "gives an older card's screenshot its one place when its drop on the %s reaches main after a newer screenshot shows, and leaves the newer card on screen",
    async (to) => {
      const card = setup();

      await card.controller.flush();
      card.saves.show(shot(1));

      const { added, drop, plain } = dropping(card);
      const file = drop.drag(1)?.file ?? "";

      // A newer screenshot shows while the shelf hands main the drop.
      card.saves.show(shot(2));

      if (to === "item") {
        await drop.onItem(card.note, [file]);
      } else {
        drop.onShelf([file]);
      }

      await vi.waitFor(() => {
        expect(added).toHaveLength(1);
      });
      await settled(card);
      expect({
        added,
        card: { save: card.view()?.save, seq: card.view()?.seq },
        notices: card.notices,
        plain,
        written: written(card),
      }).toStrictEqual({
        added: [[to, to === "item" ? card.note : rowOf(card)]],
        card: { save: { state: "idle" }, seq: 2 },
        notices: [],
        plain: [],
        written: {
          doubled: [],
          last:
            to === "item"
              ? { attached: 1, items: 0 }
              : { attached: 0, items: 1 },
        },
      });
    }
  );

  it("imports no second copy when the card's file is dropped on an item after its Add to Shelf saved it", async () => {
    const card = setup();

    await card.controller.flush();
    card.saves.show(shot(1));

    const { added, drop, dropped, plain } = dropping(card);
    const end = card.holdWrite();
    const adding = card.saves.addToShelf(1);
    // The pill reads Saving…, and the picture can still be dragged.
    const file = drop.drag(1)?.file;

    end({ ok: true });

    const row = await adding;

    expect({ row, view: card.view() }).toStrictEqual({
      row: rowOf(card),
      view: null,
    });

    // The note's drop reaches main only now.
    await expect(drop.onItem(card.note, [file ?? ""])).resolves.toStrictEqual({
      attached: [],
      message: null,
    });
    await settled(card);
    expect({
      added,
      dropped,
      notices: card.notices,
      plain,
      shown: card.shown(),
      written: written(card),
    }).toStrictEqual({
      added: [],
      dropped: ["item"],
      notices: [SHOT_ON_SHELF],
      plain: [],
      shown: { attached: 0, items: 1 },
      written: { doubled: [], last: { attached: 0, items: 1 } },
    });
  });

  it("imports no second copy when an older card's second drop on the item reaches main after a newer screenshot shows", async () => {
    const card = setup();

    await card.controller.flush();
    card.saves.show(shot(1));

    const { added, drop, plain } = dropping(card);
    const end = card.holdWrite();

    // The first drag's drop attaches the tile; a second drag, made while the pill read Saving…, has its drop still on its way.
    await drop.onItem(card.note, [drop.drag(1)?.file ?? ""]);
    await vi.waitFor(() => {
      expect(card.attachmentsOn(card.note)).toBe(1);
    });

    const second = drop.drag(1)?.file ?? "";

    card.saves.show(shot(2));
    await expect(drop.onItem(card.note, [second])).resolves.toStrictEqual({
      attached: [],
      message: null,
    });
    end({ ok: true });
    await settled(card);
    expect({
      added,
      attached: card.attachmentsOn(card.note),
      notices: card.notices,
      plain,
      written: written(card),
    }).toStrictEqual({
      // The first drop's own add, once its write landed.
      added: [["item", card.note]],
      attached: 1,
      notices: [SHOT_ON_SHELF],
      plain: [],
      written: { doubled: [], last: { attached: 1, items: 0 } },
    });
  });

  it("attaches a file from Finder at the screenshot's own path as a plain file, with the shelf's Undo, after a canceled drag of the card", async () => {
    const card = setup();

    // macOS saved this screenshot as USER_FILE.
    card.saves.show(shot(1));

    const { added, drop, dropped, plain } = dropping(card);
    const file = drop.drag(1)?.file;

    // The drag was canceled. The user edits the screenshot in Preview, saves it in place, and drags it in from Finder.
    await expect(drop.onItem(card.note, [USER_FILE])).resolves.toBe(PLAIN);
    expect({
      added,
      dropped,
      handedOut: file !== USER_FILE,
      plain,
      save: card.view()?.save,
    }).toStrictEqual({
      added: [],
      dropped: [],
      handedOut: true,
      plain: [{ call: "attachFiles", id: card.note, paths: [USER_FILE] }],
      save: { state: "idle" },
    });
  });

  it("adds the screenshot as an item of its own through the card's Add to Shelf when it is dropped on the shelf off any item", async () => {
    const card = setup();

    card.saves.show(shot(1));

    const { added, drop, dropped, plain } = dropping(card);

    drop.onShelf([drop.drag(1)?.file ?? ""]);
    await vi.waitFor(() => {
      expect(added).toHaveLength(1);
    });
    expect({
      added,
      dropped,
      plain,
      view: card.view(),
      written: written(card),
    }).toStrictEqual({
      added: [["shelf", rowOf(card)]],
      dropped: ["shelf"],
      plain: [],
      view: null,
      written: { doubled: [], last: { attached: 0, items: 1 } },
    });
  });

  it("resolves the shelf's drop with nothing, and says once what went wrong, when a step after the card's add throws", async () => {
    const card = setup();
    const noticeFailed = new Error("The toast window is gone.");

    card.saves.show(shot(1));

    const { drop, failed } = dropping(card, {
      added: () => {
        throw noticeFailed;
      },
    });

    const file = drop.drag(1)?.file ?? "";

    await expect(drop.onItem(card.note, [file])).resolves.toStrictEqual({
      attached: [],
      message: null,
    });
    await vi.waitFor(() => {
      expect(failed).toHaveLength(1);
    });
    await settled(card);
    expect({
      attached: card.attachmentsOn(card.note),
      failed,
      written: written(card),
    }).toStrictEqual({
      attached: 1,
      failed: [["drop", noticeFailed.message]],
      written: { doubled: [], last: { attached: 1, items: 0 } },
    });
  });

  it("says once what went wrong, and throws nothing into main's handler, when files dropped off any item can't be added", async () => {
    const card = setup();
    const unreadable = new Error("The folder can’t be read.");

    card.saves.show(shot(1));

    const { drop, failed } = dropping(card, {
      addFiles: async () => {
        await turn();

        throw unreadable;
      },
    });

    expect(() => {
      drop.onShelf([OTHER_FILE]);
    }).not.toThrow();
    await vi.waitFor(() => {
      expect(failed).toStrictEqual([["drop", unreadable.message]]);
    });
  });

  it("starts no drag, and says why once, when the card's picture can't be staged for it", () => {
    const card = setup();

    card.saves.show(shot(1));

    const { drop, failed } = dropping(card, {
      stage: () => {
        throw DISK_FULL;
      },
    });

    expect({
      drag: drop.drag(1),
      failed,
      save: card.view()?.save,
    }).toStrictEqual({
      drag: null,
      failed: [["drag", "The disk is full."]],
      save: { state: "idle" },
    });
  });

  it("hands out a file of its own for each drag, so a second drag of one card never reuses the first one's", () => {
    const card = setup();

    card.saves.show(shot(1));

    const { drop } = dropping(card);
    const files = [drop.drag(1)?.file ?? "", drop.drag(1)?.file ?? ""];

    expect({
      apart: new Set(files.map((each) => path.dirname(each))).size,
      names: files.map((each) => path.basename(each)),
    }).toStrictEqual({ apart: 2, names: ["Screenshot.png", "Screenshot.png"] });
  });

  it("imports no second copy when an earlier drag's drop on an item reaches main after a newer screenshot's drag started, its path spelled another way", async () => {
    const card = setup();
    const folder = mkdtempSync(path.join(tmpdir(), "inset-shot-"));

    await card.controller.flush();
    card.saves.show(shot(1));

    const { added, drop, plain } = dropping(card, {
      // Real files, under /var on macOS: a drop can name them under /private/var.
      stage: (_, each) => {
        const file = path.join(folder, `${each}.png`);

        writeFileSync(file, new Uint8Array([137, 80, 78, 71]));

        return file;
      },
    });

    const end = card.holdWrite();
    const adding = card.saves.addToShelf(1);
    // The pill reads Saving…, and the picture is dragged onto the note.
    const first = drop.drag(1)?.file ?? "";

    end({ ok: true });
    await adding;
    // A newer screenshot shows, and its drag reaches main before the shelf hands main the note's drop.
    card.saves.show(shot(2));
    drop.drag(2);
    await drop.onItem(card.note, [realpathSync.native(first)]);
    await settled(card);
    expect({
      added,
      notices: card.notices,
      plain,
      save: card.view()?.save,
      shown: card.shown(),
      written: written(card),
    }).toStrictEqual({
      added: [],
      notices: [SHOT_ON_SHELF],
      plain: [],
      save: { state: "idle" },
      shown: { attached: 0, items: 1 },
      written: { doubled: [], last: { attached: 0, items: 1 } },
    });
  });

  it("removes a drag's file once its drop came back to the shelf, and keeps the file of a drag that went elsewhere, which another app may still read", async () => {
    const card = setup();
    const folder = mkdtempSync(path.join(tmpdir(), "inset-shot-"));

    card.saves.show(shot(1));

    const { drop } = dropping(card, {
      stage: (_, each) => {
        const file = path.join(folder, each, "Screenshot.png");

        mkdirSync(path.dirname(file));
        writeFileSync(file, new Uint8Array([137, 80, 78, 71]));

        return file;
      },
      unstage: (each) => {
        rmSync(path.join(folder, each), { force: true, recursive: true });
      },
    });

    const elsewhere = drop.drag(1)?.file ?? "";
    const back = drop.drag(1)?.file ?? "";

    await drop.onItem(card.note, [back]);
    expect({
      back: existsSync(back),
      elsewhere: existsSync(elsewhere),
    }).toStrictEqual({ back: false, elsewhere: true });
  });

  it("hands out a PNG named as the screenshot is, when the system saved it in another format", () => {
    const card = setup();

    // macOS saved this screenshot as a JPEG; the card holds its picture as a PNG.
    card.saves.show({ ...shot(1), name: "Capture 2026-11-25 at 10.00.00.jpg" });

    const { drop } = dropping(card);

    expect(path.basename(drop.drag(1)?.file ?? "")).toBe(
      "Capture 2026-11-25 at 10.00.00.png"
    );
  });

  it("keeps a drag's file when another app saved an edit into it before it came back to the shelf", async () => {
    const card = setup();
    const folder = mkdtempSync(path.join(tmpdir(), "inset-shot-"));

    card.saves.show(shot(1));

    const { drop } = dropping(card, {
      stage: (_, each) => {
        const file = path.join(folder, each, "Screenshot.png");

        mkdirSync(path.dirname(file));
        writeFileSync(file, new Uint8Array([137, 80, 78, 71]));

        return file;
      },
      unstage: (each) => {
        rmSync(path.join(folder, each), { force: true, recursive: true });
      },
    });

    const file = drop.drag(1)?.file ?? "";

    // The drag went to Preview, which saved the user's marks into the copy; its proxy icon then brings it back.
    writeFileSync(file, new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
    await drop.onItem(card.note, [file]);
    expect({ kept: existsSync(file) }).toStrictEqual({ kept: true });
  });

  it("knows the card's file by where it is on disk, whichever way the drop spells the path", async () => {
    const card = setup();
    const folder = mkdtempSync(path.join(tmpdir(), "inset-shot-"));
    const file = path.join(folder, "Screenshot.png");

    writeFileSync(file, new Uint8Array([137, 80, 78, 71]));
    card.saves.show(shot(1));

    const { added, drop } = dropping(card, { stage: () => file });

    // macOS keeps temporary files under /var, a link to /private/var: the drop can name either.
    drop.drag(1);
    await drop.onItem(card.note, [realpathSync.native(file)]);
    await vi.waitFor(() => {
      expect(added).toStrictEqual([["item", card.note]]);
    });
  });
});

describe("a drag's copy of the card's screenshot on disk", () => {
  it.each(["item", "shelf"] as const)(
    "gives a replaced, unplaced screenshot its one place when its drop on the %s reaches main after two drags of the newer one",
    async (to) => {
      const card = setup();

      await card.controller.flush();
      card.saves.show(shot(1));

      const { added, drop, plain } = dropping(card);
      const file = drop.drag(1)?.file ?? "";

      // Clipboard screenshot B replaces A on the card, and two drags of B start and are canceled before the shelf hands main A's drop.
      card.saves.show(shot(2));
      drop.drag(2);
      drop.drag(2);

      if (to === "item") {
        await drop.onItem(card.note, [file]);
      } else {
        drop.onShelf([file]);
      }

      await vi.waitFor(() => {
        expect(added).toHaveLength(1);
      });
      await settled(card);
      expect({
        added,
        notices: card.notices,
        plain,
        written: written(card),
      }).toStrictEqual({
        added: [[to, to === "item" ? card.note : rowOf(card)]],
        notices: [],
        plain: [],
        written: {
          doubled: [],
          last:
            to === "item"
              ? { attached: 1, items: 0 }
              : { attached: 0, items: 1 },
        },
      });
    }
  );

  it("says the screenshot is already on the shelf, and imports no second copy, when its copy comes back after two drags of a newer one", async () => {
    const card = setup();

    await card.controller.flush();
    card.saves.show(shot(1));

    const { added, drop, plain } = dropping(card);
    const end = card.holdWrite();
    const adding = card.saves.addToShelf(1);
    // The pill reads Saving…, and the picture is dragged onto the note.
    const file = drop.drag(1)?.file ?? "";

    end({ ok: true });
    await adding;
    card.saves.show(shot(2));
    drop.drag(2);
    drop.drag(2);
    await drop.onItem(card.note, [file]);
    await settled(card);
    expect({
      added,
      notices: card.notices,
      plain,
      shown: card.shown(),
      written: written(card),
    }).toStrictEqual({
      added: [],
      notices: [SHOT_ON_SHELF],
      plain: [],
      shown: { attached: 0, items: 1 },
      written: { doubled: [], last: { attached: 0, items: 1 } },
    });
  });

  it("imports no second copy when a saved screenshot's copy comes back through a link to its folder from elsewhere, after two drags of a newer one", async () => {
    const card = setup();

    await card.controller.flush();
    card.saves.show(shot(1));

    const { added, drop, plain } = dropping(card);
    const end = card.holdWrite();
    const adding = card.saves.addToShelf(1);
    const file = drop.drag(1)?.file ?? "";

    end({ ok: true });
    await adding;
    card.saves.show(shot(2));
    drop.drag(2);
    drop.drag(2);

    // A link on the Desktop to the folder the drags stage their copies in.
    const root = path.dirname(path.dirname(file));

    const link = path.join(
      mkdtempSync(path.join(tmpdir(), "inset-desktop-")),
      "stage-link"
    );

    symlinkSync(root, link, "junction");
    await drop.onItem(card.note, [path.join(link, path.relative(root, file))]);
    await settled(card);
    expect({
      added,
      notices: card.notices,
      plain,
      shown: card.shown(),
      written: written(card),
    }).toStrictEqual({
      added: [],
      notices: [SHOT_ON_SHELF],
      plain: [],
      shown: { attached: 0, items: 1 },
      written: { doubled: [], last: { attached: 0, items: 1 } },
    });
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
  it("offers Retry for the restored row, never a fresh Add to Shelf, and holds the screenshot once, after a refused drop on the note, Undo of the row's delete and the new tile's removal", async () => {
    const card = await refused("shelf");
    const row = rowOf(card);

    card.controller.apply({ id: row, type: "remove" });
    // Refused at the shelf's write: the screenshot is on the note, not saved.
    await dropOn(card, card.note);
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
    await dropOn(card, card.note);
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

  it("attaches nothing, and holds the screenshot once, when Undo brings its deleted row back while a drop on the note writes its picture file and the shelf's write is then refused", async () => {
    const card = await refused("shelf");
    const row = rowOf(card);

    card.controller.apply({ id: row, type: "remove" });

    const adding = dropOn(card, card.note);

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
    const adding = dropOn(card, card.note);

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

/** A card whose drop on the note gave up waiting, with the tile then removed in details: the write that holds the tile is still on its way, until `end`. */
const tileOffWhileItsWriteIsHeld = async () => {
  const card = setup();

  await card.controller.flush();
  card.saves.show(shot(1));

  const end = card.holdWrite();
  const adding = dropOn(card, card.note);

  await card.giveUpWaiting();
  await adding;
  card.controller.apply({
    attachmentId: tileOf(card),
    id: card.note,
    type: "removeAttachment",
  });

  return { card, end };
};

/**
 * Add to Shelf still writes its picture file, and the shelf shows the
 * screenshot nowhere. The disk holds no note, no write is on its way, and
 * the disk refuses the next: only Discard changes still holds the tile on
 * the note, which offers it.
 */
const tileOnlyDiscardHolds = async () => {
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

  return { adding, card, offeredDiscard, writePicture };
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
    const { adding, card, offeredDiscard, writePicture } =
      await tileOnlyDiscardHolds();

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

  it("adds it to the shelf, once, when the note Discard changes could bring it back to is deleted: only the user's Undo brings that back", async () => {
    const { adding, card, writePicture } = await tileOnlyDiscardHolds();

    card.failWrites({ ok: true });
    card.controller.apply({ id: card.note, type: "remove" });
    await settled(card);
    writePicture();

    const row = await adding;

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
    "is that of the display the pointer was on when the add to the %s reached main, though the pointer is on another by the time the picture file is written",
    async (to) => {
      const card = setup();

      await card.controller.flush();
      card.saves.show(shot(1));

      const adding =
        to === "shelf" ? card.saves.addToShelf(1) : dropOn(card, card.note);

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
  it("has its time again, as a card no one pressed, with Add to Shelf and no message", async () => {
    const card = setup();

    await card.controller.flush();
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

describe("the screenshot card's time after the shelf changed under an add", () => {
  it("stays stopped while the card reads Saving… for a tile the user's Undo brought back after its add was turned away", async () => {
    const card = await refused("item");
    const tile = { attachmentId: tileOf(card), id: card.note };

    card.controller.apply({ ...tile, type: "removeAttachment" });
    card.failWrites({ ok: true });
    await settled(card);

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
    await adding;

    const turnedAway = { held: card.held(), save: card.view()?.save };

    // Their Undo again, with the first write still on its way.
    card.controller.apply({ ...tile, type: "restoreAttachment" });

    const reads = card.view()?.save.state;

    card.elapse();

    expect({ reads, shows: card.view() !== null, turnedAway }).toStrictEqual({
      reads: "saving",
      shows: true,
      turnedAway: { held: false, save: { state: "idle" } },
    });

    end({ ok: true });
    await settled(card);
  });

  it("runs again, and runs out, once a row the user's Undo brought back during a drop is deleted again and the card offers Add to Shelf", async () => {
    const card = await refused("shelf");
    const row = rowOf(card);

    card.controller.apply({ id: row, type: "remove" });
    card.failWrites({ ok: true });
    await settled(card);

    const end = card.holdWrite();
    const adding = dropOn(card, card.note);

    // The user's Undo while the picture file is written: the add is turned away, and the card reads Saving… for the row.
    card.controller.apply({ id: row, type: "undoRemove" });
    await adding;

    const restored = { held: card.held(), save: card.view()?.save };

    card.controller.apply({ id: row, type: "remove" });
    end({ ok: true });
    await settled(card);

    const offered = { held: card.held(), save: card.view()?.save };

    card.elapse();

    expect({ offered, restored, shows: card.view() !== null }).toStrictEqual({
      offered: { held: false, save: { state: "idle" } },
      restored: {
        held: true,
        save: { placed: { to: "shelf" }, state: "saving" },
      },
      shows: false,
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
  let started = 0;

  const clock = createCardClock({
    expire: () => {
      expired += 1;
    },
    setTimer: (run) => {
      pending = run;
      started += 1;

      return () => {
        pending = null;
      };
    },
  });

  return {
    clock,
    /** How often its 12 seconds began. */
    started: () => started,
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
    card.clock.holdForSave(true);
    card.clock.hover(true);
    card.clock.hover(false);
    expect(card.running()).toBeFalsy();

    card.clock.hover(true);
    card.clock.holdForSave(false);
    expect(card.running()).toBeFalsy();
    card.clock.hover(false);
    expect(card.running()).toBeTruthy();

    card.clock.hold();
    card.clock.holdForSave(true);
    card.clock.holdForSave(false);
    expect(card.running()).toBeFalsy();
  });

  it("runs on with the time it has when it is told again that no save holds it", () => {
    const card = timed();

    card.clock.shown();
    card.clock.holdForSave(false);

    expect(card.started()).toBe(1);
  });

  it("gives a new screenshot its own time, whatever held the last one", () => {
    const card = timed();

    card.clock.shown();
    card.clock.hold();
    card.clock.shown();

    expect(card.running()).toBeTruthy();
  });
});

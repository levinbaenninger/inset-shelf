import { isDeepStrictEqual } from "node:util";

import type {
  AttachResult,
  ScreenshotView,
  ShotPlaced,
  ShotSaveTo,
} from "@shared/contracts";
import { PICTURE_KIND } from "@shared/shelf";
import type {
  Attachment,
  AttachmentId,
  ItemId,
  ShelfImage,
  ShelfItem,
} from "@shared/shelf";

import { withinWait } from "./quit-hold";
import { reportSaveError } from "./save-error";
import type { WriteResult } from "./shelf-store";

/** How much of an item's words the screenshot card names it by, under its only Retry. */
const CARD_LABEL = 40;

/** A press of the card's only Retry adding to “…” that reached main after the shelf came to show the screenshot on another item. */
export const CARD_RETARGETED =
  "The card now names another item, so nothing was added. Look again and choose.";

/** A press of that Retry that reached main after the item it named was deleted. */
export const CARD_TARGET_GONE =
  "The item the card named was deleted, so nothing was added.";

/** A press of that Retry that reached main after the user took the screenshot off the item. */
export const CARD_CLEARED =
  "The card no longer names that item, so nothing was added.";

/** What a press of that Retry that missed its item says: the shelf shows the screenshot on another, on none, or the item is gone. */
const missedNotice = (named: ItemId | null, exists: boolean): string => {
  if (!exists) {
    return CARD_TARGET_GONE;
  }

  return named === null ? CARD_CLEARED : CARD_RETARGETED;
};

/** A press of an add that found the screenshot on the shelf in another place, when it reached main or once its picture file was written: it stays there, and the shelf owns it. */
export const SHOT_STAYS =
  "The screenshot stays where it was added. Retry saves it there.";

/** A press of an add while the shelf shows the screenshot nowhere, but it can still come back where the user took it off without their Undo: a new place now could end beside the old one, which Discard changes brings back. */
export const SHOT_REMOVAL_UNSAVED =
  "The shelf hasn’t saved the screenshot’s removal yet. Add it again once it has.";

/** A screenshot the card shows, held in memory: the file may be moved or deleted meanwhile. */
export interface Shot {
  /** Changes with every screenshot; the card's actions name it, so they never reach a newer one. */
  readonly seq: number;
  readonly png: Uint8Array;
  readonly widthPx: number;
  readonly heightPx: number;
}

/** The card window, as the save path drives it. */
export interface ShotCard {
  readonly show: (view: ScreenshotView) => void;
  readonly hide: () => void;
  /** Stops its time while it shows a save, running or failed with its Retry (`on`), and gives it its time again once it shows none. */
  readonly holdForSave: (on: boolean) => void;
  readonly isVisible: () => boolean;
  readonly view: () => ScreenshotView | null;
  readonly update: (change: Pick<ScreenshotView, "save">) => void;
}

export interface ShotSavesDeps<S extends Shot> {
  readonly card: ShotCard;
  readonly item: (id: ItemId) => ShelfItem | undefined;
  /** Writes the screenshot's picture file into the data folder, for a place still to be made, and returns its name there. Throws when it can't be written. */
  readonly writePicture: (shot: S) => Promise<string>;
  /** A picture file written for a place that was then not made: it goes. */
  readonly dropPicture: (file: string) => void;
  /** The scale of the display the pointer is on now. A picture keeps the one read when its add was pressed, before its file is written. */
  readonly scale: () => number;
  /** Makes the screenshot, with its picture file written, an item in the section new items go to; null when the shelf refuses it. Awaits nothing, so what the card read of the shelf just before still holds. */
  readonly addItem: (image: ShelfImage) => ItemId | null;
  /** Attaches the screenshot, with its picture file written, to an item, and deletes the file when the item doesn't take it. Awaits nothing, as `addItem`. */
  readonly attach: (image: ShelfImage, id: ItemId) => AttachResult;
  /** The write of every change so far, however long the disk takes: how it ended. The card's wait for it has a limit, the write has none. */
  readonly persisted: () => Promise<WriteResult>;
  /** Runs `run` after `ms`, unless the function it returns is called first. */
  readonly setTimer: (run: () => void, ms: number) => () => void;
  /** The item as the disk holds it; undefined while no write of it has landed. */
  readonly stored: (id: ItemId) => ShelfItem | undefined;
  /** Every version of the item that can be on the disk, or back on the shelf, without the user's Undo. */
  readonly comesBack: (id: ItemId) => readonly ShelfItem[];
  /** Tells the card each time a write starts and each time one ends, whoever started it: `stored` can read differently once one ends. */
  readonly onWrite: (listener: () => void) => () => void;
  /** Why the shelf's last write of this item was refused; null when none was, or one has landed since. */
  readonly refusal: (id: ItemId) => string | null;
  /** A write the card's own save didn't wait out landed its screenshot where it was: the card went, and the user hears where it is. */
  readonly saved: (to: ShotSaveTo, id: ItemId) => void;
  readonly notify: (message: string, tone: "failed") => void;
  readonly imageUrl: (shot: S) => string;
}

/**
 * Where an add put the card's screenshot on the shelf: the item Add to Shelf
 * made of it, or the item a drop attached it to. From then on the shelf
 * owns it, with its own Retry, Delete, Discard changes and Undo. Whether it
 * is still there, and saved, the card reads from the shelf each time.
 */
type Placement =
  | { readonly to: "shelf"; readonly item: ItemId }
  | {
      readonly to: "item";
      readonly item: ItemId;
      readonly attachment: AttachmentId;
    };

/** The card's screenshot in an item: the row itself, or its attachment there. */
const within = (
  item: ShelfItem | undefined,
  placed: Placement
): ShelfItem | Attachment | undefined =>
  placed.to === "shelf"
    ? item
    : item?.attachments.find((each) => each.id === placed.attachment);

/** A place the shelf shows the screenshot in now, and the item that holds it there. */
interface Shown {
  readonly at: Placement;
  readonly holder: ShelfItem;
}

interface Held<S extends Shot> {
  readonly shot: S;
  /** Every place an add put it, newest first. None is forgotten: the user's Undo can bring any of them back. */
  places: readonly Placement[];
  /** The add a save of it runs for: a second click waits for it. */
  saving: ShotSaveTo | null;
  /** How its last save failed, and whether Add to Shelf reads Retry for it; null before one failed, and while one runs. A failed drop's retry is another drag. */
  failed: { readonly message: string; readonly to: "shelf" | null } | null;
  /** The write the last save waited for, until it ends: so long that save's own words stand, then the shelf's. */
  write: Promise<WriteResult> | null;
}

interface Unplaced {
  readonly ok: false;
  readonly message: string;
  readonly stays: true;
}

type Placed =
  | { readonly ok: true }
  /** Nothing was placed: by the time the picture file was written, the user's Undo had the screenshot back on the shelf, or it could come back without one. */
  | Unplaced
  | { readonly ok: false; readonly message: string };

const twoDigits = (value: number): string => String(value).padStart(2, "0");

/**
 * What the card calls the item the shelf shows its screenshot on, under its
 * only Retry: a text item's words; a picture's or file's title or note; else a
 * file's name, or a picture's kind and the time it came ("Screenshot 14:02").
 */
export const cardLabel = (item: ShelfItem): string => {
  if (item.kind === "text") {
    return item.text;
  }

  const own = [item.title ?? "", item.note].find((each) => each.trim() !== "");

  if (own !== undefined) {
    return own;
  }

  if (item.kind === "file") {
    return item.file.name;
  }

  const at = new Date(item.createdAt);

  return `${PICTURE_KIND[item.via]} ${twoDigits(at.getHours())}:${twoDigits(at.getMinutes())}`;
};

const excerpt = (text: string): string => {
  const line = text.replaceAll(/\s+/gu, " ").trim();

  return line.length > CARD_LABEL
    ? `${line.slice(0, CARD_LABEL - 1).trimEnd()}…`
    : line;
};

/**
 * The screenshot card's save path: Add to Shelf, a drop on an item, and their Retry.
 * From the moment a save starts the card's time stops and its button reads
 * Saving…; the card goes once the disk holds the screenshot. When the save
 * fails the card stays, says why, and offers Retry. Everything is tied to
 * the card's screenshot: an older save never marks a newer card.
 */
export const createShotSaves = <S extends Shot>(deps: ShotSavesDeps<S>) => {
  const { card } = deps;
  let held: Held<S> | null = null;

  /**
   * Where the shelf shows the screenshot now: the newest place an add made
   * that is still there, or that the user's Undo brought back. Null before
   * an add placed it, and while the user has it off every one of them.
   */
  const shown = (now: Held<S>): Shown | null => {
    for (const at of now.places) {
      const holder = deps.item(at.item);

      if (holder !== undefined && within(holder, at) !== undefined) {
        return { at, holder };
      }
    }

    return null;
  };

  /** A write landed the screenshot where it is. */
  const landed = (at: Placement): boolean =>
    within(deps.stored(at.item), at) !== undefined;

  /**
   * A place an add made can still hold the screenshot without the user's
   * Undo. Asked while the shelf shows it nowhere: the user took it off, and
   * the shelf doesn't hold that for good yet.
   */
  const kept = (now: Held<S>): boolean =>
    now.places.some((at) =>
      deps.comesBack(at.item).some((item) => within(item, at) !== undefined)
    );

  /**
   * Why no new place may be made for the screenshot now: the shelf shows it,
   * or it can still come back where the user took it off. Null when one may.
   */
  const elsewhere = (now: Held<S>): string | null => {
    if (shown(now) !== null) {
      return SHOT_STAYS;
    }

    return kept(now) ? SHOT_REMOVAL_UNSAVED : null;
  };

  /**
   * The screenshot as the shelf keeps a picture, its file written for a
   * place still to be made. While the file is written the user's Undo can
   * bring the screenshot back, and a write can start that holds it there:
   * then nothing is placed, the file is gone again, and the user hears why.
   * The caller awaits nothing between this and placing.
   */
  const pictureFor = async (now: Held<S>): Promise<ShelfImage | Unplaced> => {
    // Read at the press: the pointer can be on a display with another scale by the time the file is written.
    const pixelsPerDip = deps.scale();
    const file = await deps.writePicture(now.shot);
    const message = elsewhere(now);

    if (message === null) {
      return {
        file,
        heightPx: now.shot.heightPx,
        pixelsPerDip,
        widthPx: now.shot.widthPx,
      };
    }

    deps.dropPicture(file);

    return { message, ok: false, stays: true };
  };

  /**
   * The write that holds the screenshot where the shelf shows it, or the
   * first one refused on the way. A write that read the shelf while the user
   * had the screenshot off it lands without it; their Undo since is a later
   * change, and the write of that is the one that counts.
   */
  const holding = async (now: Held<S>): Promise<WriteResult> => {
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- each write follows the user's last change.
      const ended = await deps.persisted();
      const on = shown(now);

      if (!ended.ok || on === null || landed(on.at)) {
        return ended;
      }
    }
  };

  /**
   * What the card says and offers, from where the shelf shows the screenshot
   * now. On the shelf, the screenshot is the shelf's: Retry for that place is
   * the only add, and the reason is the shelf's own once the write the card
   * waited for has ended. Off the shelf, Add to Shelf stands, and reads
   * Retry when it was Add to Shelf that failed.
   */
  const look = (
    now: Held<S>,
    on: Shown | null
  ): Pick<ScreenshotView, "save"> => {
    if (on !== null) {
      const { at, holder } = on;

      const placed: ShotPlaced =
        at.to === "shelf"
          ? { to: "shelf" }
          : { id: at.item, label: excerpt(cardLabel(holder)), to: "item" };

      const refusal =
        now.saving === null && now.write === null
          ? deps.refusal(at.item)
          : null;

      // Keep the shelf's newer Retry reason even if the user takes the screenshot off its place.
      if (refusal !== null && now.failed !== null) {
        now.failed = { ...now.failed, message: refusal };
      }

      const message =
        now.saving === null ? (refusal ?? now.failed?.message ?? null) : null;

      return {
        // No one said why it isn't saved: a write of it is still on its way.
        save:
          message === null
            ? { placed, state: "saving" }
            : { message, placed, state: "failed" },
      };
    }

    if (now.saving !== null) {
      return { save: { placed: null, state: "saving" } };
    }

    if (now.failed === null) {
      return { save: { state: "idle" } };
    }

    const { message, to } = now.failed;

    return { save: { message, placed: null, state: "failed", to } };
  };

  /**
   * The card as the shelf and the disk stand now: it goes once a write landed
   * its screenshot, and else shows what `look` reads, with its time stopped
   * while that is a save.
   */
  const retarget = (): void => {
    const view = card.view();
    const now = held;

    if (view === null || now === null) {
      return;
    }

    const on = shown(now);

    // Another write did the card's save: the card goes as after its own. While the card's own save runs, that save says how it went.
    if (now.saving === null && on !== null && landed(on.at)) {
      held = null;
      card.hide();
      deps.saved(on.at.to, on.at.item);

      return;
    }

    const next = look(now, on);

    // The card stays while it shows a save, however slow the disk, and has its time whenever it shows none.
    card.holdForSave(next.save.state !== "idle");

    if (!isDeepStrictEqual(next.save, view.save)) {
      card.update(next);
    }
  };

  // Whichever write lands the screenshot, the card goes at once.
  deps.onWrite(retarget);

  /** The card's screenshot, when it is still the newest; null for an older card's request. */
  const current = (seq: number): Held<S> | null =>
    held !== null && held.shot.seq === seq ? held : null;

  /**
   * The card's screenshot when a press may save it to `to`, with its place
   * on the shelf if it has one: it is still the newest, no save of it runs (a
   * second click waits for the first), and the shelf shows it nowhere else.
   * Where it is, it stays, and the user hears why. Off the shelf, it is added
   * anew only once nothing but the user's Undo brings it back.
   */
  const ready = (
    seq: number,
    to: ShotSaveTo
  ): { readonly now: Held<S>; readonly at: Placement | null } | null => {
    const now = current(seq);

    if (now === null || now.saving !== null) {
      return null;
    }

    const at = shown(now)?.at ?? null;

    if (at !== null && at.to !== to) {
      deps.notify(SHOT_STAYS, "failed");

      return null;
    }

    if (at === null && kept(now)) {
      deps.notify(SHOT_REMOVAL_UNSAVED, "failed");

      return null;
    }

    return { at, now };
  };

  /**
   * The write a failed save waited for ends, at once or after the save gave
   * up waiting: from then on the shelf says how the screenshot stands, saved
   * or refused, and why.
   */
  const follow = async (now: Held<S>): Promise<void> => {
    const { write } = now;

    if (write === null) {
      return;
    }

    const ended = await reportSaveError(async () => await write);

    if (now.write === write) {
      now.write = null;

      // The save gave up waiting and said so; the write has now said why. That reason stands wherever the screenshot is, on the shelf or off it.
      if (!ended.ok && now.failed !== null) {
        now.failed = { ...now.failed, message: ended.message };
      }

      if (held === now) {
        retarget();
      }
    }
  };

  const save = async (
    now: Held<S>,
    to: ShotSaveTo,
    place: () => Promise<Placed>
  ): Promise<ItemId | null> => {
    now.saving = to;
    now.failed = null;
    now.write = null;
    retarget();

    const written = await reportSaveError(async () => {
      const result = await place();

      if (!result.ok) {
        return result;
      }

      // The shelf holds it now: the card shows no other add while it is written.
      retarget();
      now.write = holding(now);

      return await withinWait(now.write, deps.setTimer);
    });

    now.saving = null;

    // Only the card that started this save says how it went; a newer card, or none, leaves it to a notice.
    const mine = held === now && card.isVisible();

    if (written.ok) {
      now.write = null;

      const on = shown(now);

      // The write landed, and the user had taken the screenshot off the shelf by then: nothing was added, and the card offers its adds again.
      if (on === null) {
        if (mine) {
          retarget();
        }

        return null;
      }

      if (held === now) {
        held = null;
        card.hide();
      }

      // Their Undo brought back a place the other add made, and the write landed it there: the notice names that place, not this press's.
      if (on.at.to !== to) {
        deps.saved(on.at.to, on.at.item);

        return null;
      }

      return on.at.item;
    }

    // Nothing failed and nothing was placed: the screenshot is where the user's Undo put it back, and the card says how it stands there; or it is off the shelf with its removal not saved yet, and the card has its time again.
    if ("stays" in written) {
      deps.notify(written.message, "failed");
      retarget();

      return null;
    }

    if (!mine) {
      deps.notify(written.message, "failed");

      return null;
    }

    now.failed = { message: written.message, to: to === "shelf" ? to : null };
    retarget();
    void follow(now);

    return null;
  };

  /**
   * The screenshot attached to `id`, or Retry for its attachment there. A drop
   * names its item itself; the only Retry names the item the shelf showed it
   * on, and is refused once the shelf shows it on none or another, so a late
   * press never puts it somewhere the user didn't see.
   */
  const toItem = async (
    seq: number,
    id: ItemId,
    dropped: boolean
  ): Promise<ItemId | null> => {
    // Null for an older card's request too: its screenshot is gone.
    const start = ready(seq, "item");

    if (start === null) {
      return null;
    }

    const { at, now } = start;
    const named = at?.item ?? (dropped ? id : null);

    if (named !== id) {
      deps.notify(
        dropped ? SHOT_STAYS : missedNotice(named, deps.item(id) !== undefined),
        "failed"
      );

      return null;
    }

    return await save(now, "item", async () => {
      // Its attachment is on the item: Retry saves it there, and never attaches a second.
      if (at !== null) {
        return { ok: true };
      }

      const image = await pictureFor(now);

      if ("stays" in image) {
        return image;
      }

      const result = deps.attach(image, id);

      const tile = deps
        .item(id)
        ?.attachments.find((each) => each.id === result.attached.at(0));

      if (tile === undefined) {
        return {
          message: result.message ?? "The screenshot couldn’t be attached.",
          ok: false,
        };
      }

      now.places = [
        { attachment: tile.id, item: id, to: "item" },
        ...now.places,
      ];

      return { ok: true };
    });
  };

  return {
    /** Add to Shelf: the screenshot as a new item, or Retry for the row it already is. */
    addToShelf: async (seq: number): Promise<ItemId | null> => {
      const start = ready(seq, "shelf");

      if (start === null) {
        return null;
      }

      const { at, now } = start;

      return await save(now, "shelf", async () => {
        // Its row is on the shelf: Retry saves that row, and never makes a second.
        if (at !== null) {
          return { ok: true };
        }

        const image = await pictureFor(now);

        if ("stays" in image) {
          return image;
        }

        const id = deps.addItem(image);

        if (id === null) {
          deps.dropPicture(image.file);

          return {
            message: "The shelf couldn’t take the screenshot.",
            ok: false,
          };
        }

        now.places = [{ item: id, to: "shelf" }, ...now.places];

        return { ok: true };
      });
    },

    /** The card's only Retry adding to “…”: only while the shelf shows the screenshot on `id`. */
    addToItem: async (seq: number, id: ItemId): Promise<ItemId | null> =>
      await toItem(seq, id, false),

    /** The screenshot dropped on an item: attached to it, or Retry for its attachment there. */
    dropOnItem: async (seq: number, id: ItemId): Promise<ItemId | null> =>
      await toItem(seq, id, true),

    /** The card's screenshot, while it is the newest. */
    current: (seq: number): S | null => current(seq)?.shot ?? null,

    /** The card is done with its screenshot (copied, saved elsewhere, dismissed): it goes. */
    done: (shot: S): void => {
      if (held?.shot === shot) {
        held = null;
        card.hide();
      }
    },

    retarget,

    /** A new screenshot: the card shows it, and the last one is forgotten. */
    show: (shot: S): void => {
      const now: Held<S> = {
        failed: null,
        places: [],
        saving: null,
        shot,
        write: null,
      };

      held = now;
      card.show({
        heightPx: shot.heightPx,
        imageUrl: deps.imageUrl(shot),
        seq: shot.seq,
        widthPx: shot.widthPx,
        ...look(now, null),
      });
    },

    /** The newest screenshot, for the token its card's picture names. */
    shot: (): S | null => held?.shot ?? null,
  };
};

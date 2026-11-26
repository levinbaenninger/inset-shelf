import type {
  AttachResult,
  ScreenshotView,
  ShotSaveTo,
} from "@shared/contracts";
import { ATTACHMENTS_MAX, PICTURE_KIND } from "@shared/shelf";
import type {
  Attachment,
  AttachmentId,
  ItemId,
  ShelfItem,
} from "@shared/shelf";

import { withinWait } from "./quit-hold";
import { reportSaveError } from "./save-error";
import type { WriteResult } from "./shelf-store";

/** How much of an item's words the screenshot card's Add to “…” names. */
const CARD_LABEL = 40;

/** With the shelf hidden, Add to “…” names the newest item while it is this new: the user just made it. */
export const RECENT_ITEM_MS = 2 * 60_000;

export const ITEM_GONE = "This item no longer exists.";

/** A press of Add to “…” that reached main after the card had changed to name another item. */
export const CARD_RETARGETED =
  "The card now names another item, so nothing was added. Look again and choose.";

/** A press of Add to “…” that reached main after the item the card named was deleted. */
export const CARD_TARGET_GONE =
  "The item the card named was deleted, so nothing was added.";

/** A press of Add to “…” that reached main after the card stopped naming any item (it filled up, or the shelf went). */
export const CARD_CLEARED =
  "The card no longer names that item, so nothing was added.";

/** What a press of Add to “…” that missed its item says: the card named another, none, or the item is gone. */
const missedNotice = (named: ItemId | null, exists: boolean): string => {
  if (!exists) {
    return CARD_TARGET_GONE;
  }

  return named === null ? CARD_CLEARED : CARD_RETARGETED;
};

/** A press of the other add that reached main after the user changed the screenshot where the first add put it. */
export const SHOT_CHANGED =
  "The screenshot was changed where it is, so it stays there. Retry saves it.";

/** A press of the other add that reached main while a write holding the screenshot where the first add put it was still on its way. */
export const SHOT_LANDING =
  "The screenshot is still being saved where it is, so it stays there for now.";

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
  /** Stops its time until it hides. */
  readonly hold: () => void;
  readonly isVisible: () => boolean;
  readonly view: () => ScreenshotView | null;
  readonly update: (
    change: Partial<Pick<ScreenshotView, "target" | "save">>
  ) => void;
}

export interface ShotSavesDeps<S extends Shot> {
  readonly card: ShotCard;
  readonly item: (id: ItemId) => ShelfItem | undefined;
  readonly items: () => readonly ShelfItem[];
  /** The item selected or open in details in the shelf, or null. */
  readonly selection: () => ItemId | null;
  readonly shelfVisible: () => boolean;
  readonly now: () => number;
  /** Makes the screenshot an item in the section new items go to; null when the shelf refuses it. Throws when its file can't be written. */
  readonly addItem: (shot: S) => Promise<ItemId | null>;
  /** Attaches the screenshot to an item. Throws when its file can't be written. */
  readonly attach: (shot: S, id: ItemId) => Promise<AttachResult>;
  /** Takes the screenshot's own item off the shelf for good: Undo brings nothing back. */
  readonly dropItem: (id: ItemId) => void;
  /** Takes the screenshot off an item for good, the same way. */
  readonly detach: (id: ItemId, attachment: AttachmentId) => void;
  /** The write of every change so far, however long the disk takes: how it ended. The card's wait for it has a limit, the write has none. */
  readonly persisted: () => Promise<WriteResult>;
  /** Runs `run` after `ms`, unless the function it returns is called first. */
  readonly setTimer: (run: () => void, ms: number) => () => void;
  /** The item as the disk holds it; undefined while no write of it has landed. */
  readonly stored: (id: ItemId) => ShelfItem | undefined;
  /** The item as the write now on the disk's way holds it; undefined while none holds it. */
  readonly onItsWay: (id: ItemId) => ShelfItem | undefined;
  /** A write other than the card's own save landed its screenshot where it was: the card went, and the user hears where it is. */
  readonly saved: (to: ShotSaveTo, id: ItemId) => void;
  readonly notify: (message: string, tone: "failed") => void;
  readonly imageUrl: (shot: S) => string;
}

/**
 * Where the shelf holds the card's screenshot, saved or not: the item Add to
 * Shelf made of it, or the item Add to “…” attached it to. `as` is the row
 * or the attachment as the card made it: the shelf never changes one in
 * place, so anything else found there holds a change made since.
 */
type Placement =
  | { readonly to: "shelf"; readonly item: ItemId; readonly as: ShelfItem }
  | {
      readonly to: "item";
      readonly item: ItemId;
      readonly attachment: AttachmentId;
      readonly as: Attachment;
    };

/**
 * How the screenshot stands in its place. The card may move it only while it
 * is `placed`: as the card made it, in no write that landed and in none that
 * still can. `saved` ends the card's part, since the disk holds the
 * screenshot there. `landing` and `changed` leave Retry for that place
 * alone: a write on its way holds the screenshot there and would land it
 * beside the new place, or moving it would lose the change.
 */
interface Standing {
  readonly placed: Placement;
  readonly state: "placed" | "landing" | "changed" | "saved";
}

/** The screenshot stays where it is: Retry there is the only add. */
const stays = (at: Standing | null): boolean =>
  at?.state === "landing" || at?.state === "changed";

/** The card's screenshot in an item: the row itself, or its attachment there. */
const within = (
  item: ShelfItem | undefined,
  placed: Placement
): ShelfItem | Attachment | undefined =>
  placed.to === "shelf"
    ? item
    : item?.attachments.find((each) => each.id === placed.attachment);

interface Held<S extends Shot> {
  readonly shot: S;
  /**
   * The one place a save put it. Retry after a failed save finds it there
   * and doesn't place it twice; the other destination takes it from there
   * first, so the shelf never holds it twice, and only while it stands
   * there as the card placed it (`Standing`).
   */
  placed: Placement | null;
  /** A save is under way: a second click waits for it. */
  saving: boolean;
  /** The item Add to “…” last tried: its Retry stands only while the card still names it. */
  tried: ItemId | null;
  /** The write the last save waited for and didn't see land: the card follows it to its end, until a newer save starts. */
  write: Promise<WriteResult> | null;
}

type Placed =
  | { readonly ok: true; readonly id: ItemId }
  | {
      readonly ok: false;
      readonly message: string;
      /** False when trying again can't help: the item is gone, or holds all it can. */
      readonly retry?: false;
    };

const isFull = (item: ShelfItem | undefined): boolean =>
  item !== undefined && item.attachments.length >= ATTACHMENTS_MAX;

const twoDigits = (value: number): string => String(value).padStart(2, "0");

/**
 * What Add to “…” calls an item, so the user knows which one before the
 * click: a text item's words; a picture's or file's title or note; else a
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
 * The screenshot card's save path: Add to Shelf, Add to “…” and their Retry.
 * From the moment a save starts the card's time stops and its button reads
 * Saving…; the card goes once the disk holds the screenshot. When the save
 * fails the card stays, says why, and offers Retry. Everything is tied to
 * the card's screenshot: an older save never marks a newer card.
 */
export const createShotSaves = <S extends Shot>(deps: ShotSavesDeps<S>) => {
  const { card } = deps;
  let held: Held<S> | null = null;
  // The item the card last named: Add to “…” attaches to it, whatever is selected by the time it is pressed.
  let cardItem: ItemId | null = null;

  /** The item Add to Shelf made of the card's screenshot: Add to “…” never names it, a screenshot isn't attached to itself. */
  const ownItem = (): ItemId | null =>
    held?.placed?.to === "shelf" ? held.placed.item : null;

  /** The newest item, while the user can still know it is the one just made. */
  const recentItem = (): ItemId | null => {
    let newest: ShelfItem | null = null;

    for (const each of deps.items()) {
      if (
        each.id !== ownItem() &&
        (newest === null || each.createdAt > newest.createdAt)
      ) {
        newest = each;
      }
    }

    return newest !== null &&
      deps.now() - Date.parse(newest.createdAt) <= RECENT_ITEM_MS
      ? newest.id
      : null;
  };

  /**
   * What Add to “…” names: an item the user can know. That is the item open
   * on the visible shelf, else the item made in the last two minutes; never a
   * selection on a hidden shelf, which may be hours old.
   */
  const candidate = (): ItemId | null => {
    const selected = deps.shelfVisible() ? deps.selection() : null;

    return selected === null || selected === ownItem()
      ? recentItem()
      : selected;
  };

  /** How the screenshot stands where a save put it; null when it is nowhere: never placed, or taken off by Delete or Discard changes since. */
  const standing = (now: Held<S>): Standing | null => {
    const { placed } = now;

    if (placed === null) {
      return null;
    }

    const shown = within(deps.item(placed.item), placed);

    if (shown === undefined) {
      return null;
    }

    if (within(deps.stored(placed.item), placed) !== undefined) {
      return { placed, state: "saved" };
    }

    if (within(deps.onItsWay(placed.item), placed) !== undefined) {
      return { placed, state: "landing" };
    }

    return { placed, state: shown === placed.as ? "placed" : "changed" };
  };

  /** The screenshot's own row stays: Add to “…” would drop the row, so it names nothing. */
  const rowStays = (): boolean => {
    const at = held === null ? null : standing(held);

    return at?.placed.to === "shelf" && stays(at);
  };

  const target = (): ScreenshotView["target"] => {
    // Once attached, the card keeps naming that item, so Retry after a failed save saves it there and never attaches twice.
    const attached = held?.placed?.to === "item" ? held.placed.item : null;
    const id = attached ?? (rowStays() ? null : candidate());
    const item = id === null ? undefined : deps.item(id);

    cardItem =
      item === undefined || (attached === null && isFull(item))
        ? null
        : item.id;

    return item === undefined || cardItem === null
      ? null
      : { id: item.id, label: excerpt(cardLabel(item)) };
  };

  /** The disk holds the card's screenshot where it was: another write did the card's save, so the card goes as after its own. */
  const finish = (placed: Placement): void => {
    held = null;
    card.hide();
    deps.saved(placed.to, placed.item);
  };

  /**
   * The card as the shelf and the disk stand now, without moving the
   * screenshot or keeping the card longer: it goes once a write landed its
   * screenshot, names the item that counts, and offers only what a press
   * may still do.
   */
  const retarget = (): void => {
    const view = card.view();

    if (view === null) {
      return;
    }

    // While the card's own save runs, that save says how it went.
    const at = held === null || held.saving ? null : standing(held);

    if (at?.state === "saved") {
      finish(at.placed);

      return;
    }

    const next = target();

    if (next?.id !== view.target?.id || next?.label !== view.target?.label) {
      card.update({ target: next });
    }

    const { save: shown } = view;

    if (shown.state !== "failed") {
      return;
    }

    // Add to “…” names another item now: its button reads that name, not Retry, so a press never goes somewhere unseen.
    const to =
      shown.to === "item" && cardItem !== (held?.tried ?? null)
        ? null
        : shown.to;

    const only = stays(at);

    if (to !== shown.to || only !== shown.only) {
      card.update({ save: { ...shown, only, to } });
    }
  };

  /**
   * Whether the card's screenshot may go to `to`: it is nowhere, already
   * there, or in the other place as the card put it. Saved in the other
   * place, the card is done and goes; changed there, or in a write on its
   * way, it stays and the user hears why.
   */
  const free = (now: Held<S>, to: ShotSaveTo): boolean => {
    const at = standing(now);

    if (at === null || at.placed.to === to || at.state === "placed") {
      return true;
    }

    if (at.state === "saved") {
      finish(at.placed);
    } else {
      deps.notify(
        at.state === "landing" ? SHOT_LANDING : SHOT_CHANGED,
        "failed"
      );
    }

    return false;
  };

  /** `standing` at a press, which also forgets a place Delete or Discard changes took the screenshot from. */
  const placement = (now: Held<S>): Standing | null => {
    const at = standing(now);

    if (at === null) {
      now.placed = null;
    }

    return at;
  };

  /**
   * The screenshot leaves its place before it goes to the other destination,
   * so no shelf, shown or written, holds it twice. It removes only what
   * stands as the card made it, never a row or an attachment the disk
   * holds, a write on its way holds or the user changed; `free` turned those
   * presses away in this same turn.
   */
  const takeBack = (now: Held<S>, at: Standing | null): void => {
    if (at?.state !== "placed") {
      return;
    }

    now.placed = null;

    if (at.placed.to === "shelf") {
      deps.dropItem(at.placed.item);
    } else {
      deps.detach(at.placed.item, at.placed.attachment);
    }
  };

  /** The card's screenshot, when it is still the newest; null for an older card's request. */
  const current = (seq: number): Held<S> | null =>
    held !== null && held.shot.seq === seq ? held : null;

  /**
   * The card's screenshot when a press may save it to `to`: it is still the
   * newest, no save of it runs (a second click waits for the first), and it
   * is free to go there.
   */
  const ready = (seq: number, to: ShotSaveTo): Held<S> | null => {
    const now = current(seq);

    return now === null || now.saving || !free(now, to) ? null : now;
  };

  /**
   * A save that gave up waiting left its write on the disk's way. The card
   * follows that write to its end, with nothing else to tell it: landed, the
   * card goes as after any write that saved its screenshot; refused, the
   * card says why instead of that it took too long.
   */
  const follow = async (now: Held<S>): Promise<void> => {
    const { write } = now;

    if (write === null) {
      return;
    }

    const ended = await reportSaveError(async () => await write);

    // A newer screenshot, or a newer save of this one, says how it went.
    if (held !== now || now.write !== write) {
      return;
    }

    const shown = card.view()?.save;

    if (
      !ended.ok &&
      shown?.state === "failed" &&
      shown.message !== ended.message
    ) {
      card.update({ save: { ...shown, message: ended.message } });
    }

    retarget();
  };

  const save = async (
    now: Held<S>,
    to: ShotSaveTo,
    place: () => Promise<Placed>
  ): Promise<ItemId | null> => {
    now.saving = true;
    now.write = null;
    // The card stays while its screenshot is written, however slow the disk.
    card.hold();
    card.update({ save: { state: "saving", to } });

    let placed: ItemId | null = null;

    const written = await reportSaveError(async () => {
      const result = await place();

      if (!result.ok) {
        return result;
      }

      placed = result.id;
      now.write = deps.persisted();

      return await withinWait(now.write, deps.setTimer);
    });

    now.saving = false;

    // Only the card that started this save says how it went; a newer card, or none, leaves it to a notice.
    const mine = held === now && card.isVisible();

    if (!written.ok) {
      if (mine) {
        const retry = !("retry" in written) || written.retry !== false;

        card.update({
          save: {
            message: written.message,
            only: false,
            state: "failed",
            to: retry ? to : null,
          },
        });
        retarget();
        void follow(now);
      } else {
        deps.notify(written.message, "failed");
      }

      return null;
    }

    if (held === now) {
      held = null;
      card.hide();
    }

    return placed;
  };

  return {
    /** Add to Shelf: the screenshot as a new item; Retry makes it again if its row was deleted meanwhile. */
    addToShelf: async (seq: number): Promise<ItemId | null> => {
      const now = ready(seq, "shelf");

      if (now === null) {
        return null;
      }

      return await save(now, "shelf", async () => {
        const at = placement(now);

        if (at?.placed.to === "shelf") {
          return { id: at.placed.item, ok: true };
        }

        takeBack(now, at);

        const id = await deps.addItem(now.shot);
        const row = id === null ? undefined : deps.item(id);

        if (row === undefined) {
          return {
            message: "The shelf couldn’t take the screenshot.",
            ok: false,
          };
        }

        now.placed = { as: row, item: row.id, to: "shelf" };

        return { id: row.id, ok: true };
      });
    },

    /**
     * Add to “…”: the screenshot attached to `id`, the item the card named
     * when it was pressed, while the card still names it and it exists.
     */
    addToItem: async (seq: number, id: ItemId): Promise<ItemId | null> => {
      // Null for an older card's click too: its screenshot is gone, and the card names nothing now.
      const now = ready(seq, "item");

      if (now === null) {
        return null;
      }

      const named = now.placed?.to === "item" ? now.placed.item : cardItem;

      // The card changed under the press: the screenshot never goes somewhere the user didn't see, and the user hears why.
      if (named !== id) {
        deps.notify(missedNotice(named, deps.item(id) !== undefined), "failed");

        return null;
      }

      now.tried = id;

      return await save(now, "item", async () => {
        // A Retry checks the attachment itself: Discard changes may have taken it off since.
        const at = placement(now);

        if (deps.item(id) === undefined) {
          return { message: ITEM_GONE, ok: false, retry: false };
        }

        if (at?.placed.to === "item" && at.placed.item === id) {
          return { id, ok: true };
        }

        // No item holds it now, so the card names this one only while it could take it.
        takeBack(now, at);

        const result = await deps.attach(now.shot, id);

        const tile = deps
          .item(id)
          ?.attachments.find((each) => each.id === result.attached.at(0));

        if (tile === undefined) {
          const message =
            result.message ?? "The screenshot couldn’t be attached.";

          // A full item takes nothing however often it is tried: no Retry stands, and Add to Shelf is the way left.
          return isFull(deps.item(id))
            ? { message, ok: false, retry: false }
            : { message, ok: false };
        }

        now.placed = {
          as: tile,
          attachment: tile.id,
          item: id,
          to: "item",
        };
        retarget();

        return { id, ok: true };
      });
    },

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
      held = { placed: null, saving: false, shot, tried: null, write: null };
      card.show({
        heightPx: shot.heightPx,
        imageUrl: deps.imageUrl(shot),
        save: { state: "idle" },
        seq: shot.seq,
        target: target(),
        widthPx: shot.widthPx,
      });
    },

    /** The newest screenshot, for the token its card's picture names. */
    shot: (): S | null => held?.shot ?? null,
  };
};

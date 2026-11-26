import type {
  AttachResult,
  ScreenshotView,
  ShotSaveTo,
} from "@shared/contracts";
import { ATTACHMENTS_MAX, PICTURE_KIND } from "@shared/shelf";
import type { AttachmentId, ItemId, ShelfItem } from "@shared/shelf";

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
  /** Waits until the disk holds every change so far. */
  readonly persisted: () => Promise<WriteResult>;
  readonly notify: (message: string, tone: "failed") => void;
  readonly imageUrl: (shot: S) => string;
}

interface Held<S extends Shot> {
  readonly shot: S;
  /** The shelf item Add to Shelf made of it, so Retry after a failed save doesn't add it twice. */
  item: ItemId | null;
  /** Where Add to “…” attached it, so Retry after a failed save doesn't attach it twice, and attaches again once it is gone. */
  attachedTo: {
    readonly item: ItemId;
    readonly attachment: AttachmentId;
  } | null;
  /** A save is under way: a second click waits for it. */
  saving: boolean;
  /** The item Add to “…” last tried: its Retry stands only while the card still names it. */
  tried: ItemId | null;
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

  /** The newest item, while the user can still know it is the one just made. */
  const recentItem = (): ItemId | null => {
    let newest: ShelfItem | null = null;

    for (const each of deps.items()) {
      if (newest === null || each.createdAt > newest.createdAt) {
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

    return selected ?? recentItem();
  };

  const target = (): ScreenshotView["target"] => {
    // Once attached, the card keeps naming that item, so Retry after a failed save saves it there and never attaches twice.
    const attached = held?.attachedTo?.item ?? null;
    const id = attached ?? candidate();
    const item = id === null ? undefined : deps.item(id);

    cardItem =
      item === undefined || (attached === null && isFull(item))
        ? null
        : item.id;

    return item === undefined || cardItem === null
      ? null
      : { id: item.id, label: excerpt(cardLabel(item)) };
  };

  /** The card names the item that counts now, without moving it or keeping it longer. */
  const retarget = (): void => {
    const view = card.view();

    if (view === null) {
      return;
    }

    const next = target();

    if (next?.id !== view.target?.id || next?.label !== view.target?.label) {
      card.update({ target: next });
    }

    // Add to “…” names another item now: its button reads that name, not Retry, so a press never goes somewhere unseen.
    const { save: shown } = view;

    if (
      shown.state === "failed" &&
      shown.to === "item" &&
      cardItem !== (held?.tried ?? null)
    ) {
      card.update({ save: { ...shown, to: null } });
    }
  };

  /** The card's screenshot, when it is still the newest; null for an older card's request. */
  const current = (seq: number): Held<S> | null =>
    held !== null && held.shot.seq === seq ? held : null;

  const save = async (
    seq: number,
    to: ShotSaveTo,
    place: (now: Held<S>) => Promise<Placed>
  ): Promise<ItemId | null> => {
    const now = current(seq);

    if (now === null || now.saving) {
      return null;
    }

    now.saving = true;
    // The card stays while its screenshot is written, however slow the disk.
    card.hold();
    card.update({ save: { state: "saving", to } });

    let placed: ItemId | null = null;

    const written = await reportSaveError(async () => {
      const result = await place(now);

      if (!result.ok) {
        return result;
      }

      placed = result.id;

      return await deps.persisted();
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
            state: "failed",
            to: retry ? to : null,
          },
        });
        retarget();
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
    addToShelf: async (seq: number): Promise<ItemId | null> =>
      await save(seq, "shelf", async (now) => {
        if (now.item !== null && deps.item(now.item) === undefined) {
          now.item = null;
        }

        now.item ??= await deps.addItem(now.shot);

        return now.item === null
          ? { message: "The shelf couldn’t take the screenshot.", ok: false }
          : { id: now.item, ok: true };
      }),

    /**
     * Add to “…”: the screenshot attached to `id`, the item the card named
     * when it was pressed, while the card still names it and it exists.
     */
    addToItem: async (seq: number, id: ItemId): Promise<ItemId | null> => {
      // An older card's click: its screenshot is gone, and the card names nothing now.
      if (current(seq) === null) {
        return null;
      }

      const named = current(seq)?.attachedTo?.item ?? cardItem;

      // The card changed under the press: the screenshot never goes somewhere the user didn't see, and the user hears why.
      if (named !== id) {
        deps.notify(
          deps.item(id) === undefined ? CARD_TARGET_GONE : CARD_RETARGETED,
          "failed"
        );

        return null;
      }

      const now = current(seq);

      if (now !== null && !now.saving) {
        now.tried = id;
      }

      return await save(seq, "item", async (holding) => {
        if (deps.item(id) === undefined) {
          holding.attachedTo = null;

          return { message: ITEM_GONE, ok: false, retry: false };
        }

        // A Retry checks the attachment itself: Discard changes may have taken it off since.
        const kept =
          holding.attachedTo !== null &&
          deps
            .item(id)
            ?.attachments.some(
              (attachment) => attachment.id === holding.attachedTo?.attachment
            ) === true;

        if (!kept) {
          // The item no longer holds it, so the card names the item only while it could take it.
          holding.attachedTo = null;

          const result = await deps.attach(holding.shot, id);
          const [attachment] = result.attached;

          if (attachment === undefined) {
            const message =
              result.message ?? "The screenshot couldn’t be attached.";

            // A full item takes nothing however often it is tried: no Retry stands, and Add to Shelf is the way left.
            return isFull(deps.item(id))
              ? { message, ok: false, retry: false }
              : { message, ok: false };
          }

          holding.attachedTo = { attachment, item: id };
          retarget();
        }

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
      held = { attachedTo: null, item: null, saving: false, shot, tried: null };
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

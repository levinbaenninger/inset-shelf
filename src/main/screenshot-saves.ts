import type { ActionResult, ScreenshotView } from "@shared/contracts";
import { ATTACHMENTS_MAX, itemText } from "@shared/shelf";
import type { ItemId, ShelfItem } from "@shared/shelf";

import type { WriteResult } from "./shelf-store";

/** How much of an item's words the screenshot card's Add to “…” names. */
const CARD_LABEL = 40;

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
  readonly hold: () => void;
  readonly isVisible: () => boolean;
  readonly view: () => ScreenshotView | null;
  readonly retarget: (target: ScreenshotView["target"]) => void;
  /** Add to Shelf didn't reach the disk: the card says why and offers Retry. */
  readonly failed: (seq: number, message: string) => void;
}

export interface ShotSavesDeps<S extends Shot> {
  readonly card: ShotCard;
  readonly item: (id: ItemId) => ShelfItem | undefined;
  /** The item selected or open in details in the shelf, or null. */
  readonly selection: () => ItemId | null;
  /** Makes the screenshot an item in the section new items go to; null when the shelf refuses it. Throws when its file can't be written. */
  readonly addItem: (shot: S) => Promise<ItemId | null>;
  /** Attaches the screenshot to an item. Throws when its file can't be written. */
  readonly attach: (shot: S, id: ItemId) => Promise<ActionResult>;
  /** Waits until the disk holds every change so far. */
  readonly persisted: () => Promise<WriteResult>;
  /** Turns a thrown write error into its sentence. */
  readonly reportSaveError: <Result>(
    run: () => Promise<Result>
  ) => Promise<Result | { readonly ok: false; readonly message: string }>;
  readonly notify: (message: string, tone?: "failed") => void;
  readonly imageUrl: (shot: S) => string;
}

interface Held<S extends Shot> {
  readonly shot: S;
  /** The shelf item Add to Shelf made of it, so Retry after a failed save doesn't add it twice. */
  item: ItemId | null;
  /** A save is under way: a second click waits for it. */
  adding: boolean;
  /** The item Add to “…” attached it to, so Retry after a failed save doesn't attach it twice. */
  attachedTo: ItemId | null;
}

const excerpt = (text: string): string => {
  const line = text.replaceAll(/\s+/gu, " ").trim();

  return line.length > CARD_LABEL ? `${line.slice(0, CARD_LABEL - 1)}…` : line;
};

/**
 * The screenshot card's save path: Add to Shelf, Add to “…” and their Retry.
 * The card goes once the disk holds the screenshot; when the save fails it
 * stays, says why, and offers Retry.
 */
export const createShotSaves = <S extends Shot>(deps: ShotSavesDeps<S>) => {
  const { card } = deps;
  let held: Held<S> | null = null;
  // The item the card last named: Add to “…” attaches to it, whatever is selected by the time it is pressed.
  let cardItem: ItemId | null = null;

  /** What the card's Add to “…” names: the selected item while it has room; else nothing, and the card shows no such button. */
  const target = (): ScreenshotView["target"] => {
    // Once attached, the card keeps naming that item, so Retry after a failed save saves it there and never attaches twice.
    const attached = held?.attachedTo ?? null;
    const id = attached ?? deps.selection();
    const item = id === null ? undefined : deps.item(id);

    cardItem =
      item === undefined ||
      (attached === null && item.attachments.length >= ATTACHMENTS_MAX)
        ? null
        : item.id;

    return item === undefined || cardItem === null
      ? null
      : { label: excerpt(itemText(item)) };
  };

  /** The card names the item that counts now, without moving it or keeping it longer. */
  const retarget = (): void => {
    const view = card.view();

    if (view === null) {
      return;
    }

    const next = target();

    if (next?.label !== view.target?.label) {
      card.retarget(next);
    }
  };

  /** The card's screenshot, when it is still the newest; null for an older card's request. */
  const current = (seq: number): Held<S> | null =>
    held !== null && held.shot.seq === seq ? held : null;

  const save = async (
    seq: number,
    place: (
      now: Held<S>
    ) => Promise<
      | { readonly ok: true; readonly id: ItemId }
      | { readonly ok: false; readonly message: string }
    >
  ): Promise<ItemId | null> => {
    const now = current(seq);

    if (now === null || now.adding) {
      return null;
    }

    now.adding = true;

    let placed: ItemId | null = null;

    const written = await deps.reportSaveError(async () => {
      const result = await place(now);

      if (!result.ok) {
        return result;
      }

      placed = result.id;

      return await deps.persisted();
    });

    now.adding = false;

    if (!written.ok) {
      // A card its time put away meanwhile can't say it: the notice does.
      if (card.isVisible()) {
        card.hold();
        card.failed(seq, written.message);
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
    /** Add to Shelf: the screenshot as a new item. */
    addToShelf: async (seq: number): Promise<ItemId | null> =>
      await save(seq, async (now) => {
        now.item ??= await deps.addItem(now.shot);

        return now.item === null
          ? { message: "The shelf couldn’t take the screenshot.", ok: false }
          : { id: now.item, ok: true };
      }),

    /** Add to “…”: the screenshot attached to the item the card named. */
    addToItem: async (seq: number): Promise<ItemId | null> => {
      const id = current(seq)?.attachedTo ?? cardItem;

      if (id === null) {
        return null;
      }

      return await save(seq, async (now) => {
        if (now.attachedTo !== id) {
          const result = await deps.attach(now.shot, id);

          if (!result.ok) {
            return result;
          }

          now.attachedTo = id;
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
      held = { adding: false, attachedTo: null, item: null, shot };
      card.show({
        heightPx: shot.heightPx,
        imageUrl: deps.imageUrl(shot),
        seq: shot.seq,
        target: target(),
        widthPx: shot.widthPx,
      });
    },

    /** The newest screenshot's bytes, for the token its card's picture names. */
    shot: (): S | null => held?.shot ?? null,
  };
};

export type ShotSaves<S extends Shot> = ReturnType<typeof createShotSaves<S>>;

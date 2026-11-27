import { realpathSync } from "node:fs";
import path from "node:path";

import type { AttachResult, ShotSaveTo } from "@shared/contracts";
import type { ItemId } from "@shared/shelf";

import { errorMessage } from "./save-error";

export interface ShotDropDeps<S> {
  /** The card's save path (screenshot-saves.ts). */
  readonly saves: {
    /** The card's screenshot, while it is the newest; null for an older one. */
    readonly current: (seq: number) => S | null;
    readonly dropOnItem: (seq: number, id: ItemId) => Promise<ItemId | null>;
    readonly addToShelf: (seq: number) => Promise<ItemId | null>;
  };
  /** The card's screenshot is on the shelf, saved: the shelf shows it, and a notice says where. */
  readonly added: (to: ShotSaveTo, id: ItemId) => void;
  /** Files from outside dropped on an item. */
  readonly attachFiles: (
    id: ItemId,
    paths: readonly string[]
  ) => Promise<AttachResult>;
  /** Files from outside dropped on the shelf, as new items. */
  readonly addFiles: (paths: readonly string[]) => Promise<void>;
  /** The card's own file came back: it went the card's way. */
  readonly dropped: (to: ShotSaveTo) => void;
  /** The card's picture couldn't be staged, so no drag starts: the user hears why. */
  readonly dragFailed: (why: string) => void;
  /** A drop threw after the shelf had its reply: the user hears why, once. */
  readonly dropFailed: (why: string) => void;
  /** Writes the card's picture into `folder`, the drag's own folder in staging, named as the screenshot is, and returns the file; never a file of the user's. */
  readonly stage: (shot: S, folder: string) => string;
}

/** Where a file is on disk: macOS can name a temporary file under /var or under /private/var. */
const onDisk = (file: string): string => {
  try {
    return realpathSync.native(file);
  } catch {
    return path.resolve(file);
  }
};

/** What a drop on the shelf is to the card. */
type Drop =
  /** Files from outside, or the card's file among others: the shelf's plain route. */
  | { readonly kind: "files" }
  /** The card's file alone, while its card is the newest. */
  | { readonly kind: "card"; readonly seq: number }
  /** The card's file alone, once its card is done with it or shows a newer screenshot. */
  | { readonly kind: "late" };

/** What the shelf's drop says when the card's file went the card's way, or nowhere: nothing, and no Undo. */
const NOTHING: AttachResult = { attached: [], message: null };

/**
 * The screenshot card's drag hands out a copy of its picture, staged for the
 * drag alone, so other apps get a real file and no file of the user's is ever
 * taken for the card's. When the shelf hands that copy back, alone, while its
 * card is still the newest, the drop goes through the card's own add: a
 * screenshot keeps one place on the shelf, and the card says how it went.
 * Once its card is done with it or shows a newer screenshot, the copy adds
 * nothing: the screenshot is where its card put it, or went with its card,
 * and a plain copy would be a second place. Any other drop takes the shelf's
 * plain route.
 */
export const createShotDrop = <S>(deps: ShotDropDeps<S>) => {
  // The file the card's last drag handed out, and the screenshot it is, however long its drop takes.
  let drag: { readonly seq: number; readonly file: string } | null = null;
  // Drags so far: each stages its file in a folder of its own, so no two drags share a file.
  let drags = 0;

  const classify = (paths: readonly string[]): Drop => {
    const [only] = paths;

    if (
      drag === null ||
      only === undefined ||
      paths.length !== 1 ||
      onDisk(only) !== onDisk(drag.file)
    ) {
      return { kind: "files" };
    }

    return deps.saves.current(drag.seq) === null
      ? { kind: "late" }
      : { kind: "card", seq: drag.seq };
  };

  /** Runs what a drop does after the shelf has its reply: whatever throws on the way is said once, and never escapes main's handler. */
  const settle = (run: () => Promise<void>): void => {
    void (async () => {
      try {
        await run();
      } catch (error) {
        deps.dropFailed(errorMessage(error));
      }
    })();
  };

  /** The card's add for its file: the card says how it went, and the user hears where it is. */
  const land = (to: ShotSaveTo, add: () => Promise<ItemId | null>): void => {
    settle(async () => {
      deps.dropped(to);

      const id = await add();

      if (id !== null) {
        deps.added(to, id);
      }
    });
  };

  const staged = (shot: S): string | null => {
    drags += 1;

    try {
      return deps.stage(shot, `screenshot-drag-${drags}`);
    } catch (error) {
      deps.dragFailed(errorMessage(error));

      return null;
    }
  };

  return {
    /** The card's drag for screenshot `seq`: the file it hands out, and the screenshot; null once it is not the newest, or when its file can't be written. */
    drag: (seq: number): { readonly file: string; readonly shot: S } | null => {
      const shot = deps.saves.current(seq);

      if (shot === null) {
        return null;
      }

      const file = staged(shot);

      if (file === null) {
        return null;
      }

      drag = { file, seq };

      return { file, shot };
    },

    /** Files dropped on an item: the card's screenshot attached through its own add, or the files attached as files. */
    onItem: async (
      id: ItemId,
      paths: readonly string[]
    ): Promise<AttachResult> => {
      const drop = classify(paths);

      if (drop.kind === "files") {
        return await deps.attachFiles(id, paths);
      }

      if (drop.kind === "card") {
        land("item", async () => await deps.saves.dropOnItem(drop.seq, id));
      }

      return NOTHING;
    },

    /** Files dropped on the shelf off any item: the card's Add to Shelf, or new items. */
    onShelf: (paths: readonly string[]): void => {
      const drop = classify(paths);

      if (drop.kind === "files") {
        settle(async () => {
          await deps.addFiles(paths);
        });
      } else if (drop.kind === "card") {
        land("shelf", async () => await deps.saves.addToShelf(drop.seq));
      }
    },
  };
};

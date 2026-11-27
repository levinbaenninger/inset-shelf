import { realpathSync } from "node:fs";
import path from "node:path";

import type { AttachResult, ShotSaveTo } from "@shared/contracts";
import type { ItemId } from "@shared/shelf";

export interface ShotDropDeps {
  /** The card's save path (screenshot-saves.ts). */
  readonly saves: {
    /** The card's screenshot, while it is the newest; null for an older one. */
    readonly current: (seq: number) => object | null;
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
  readonly addFiles: (paths: readonly string[]) => void;
  /** The card's own file came back: it went the card's way. */
  readonly dropped: (to: ShotSaveTo) => void;
}

/** Where a file is on disk: macOS can name a temporary file under /var or under /private/var. */
const onDisk = (file: string): string => {
  try {
    return realpathSync.native(file);
  } catch {
    return path.resolve(file);
  }
};

/**
 * The screenshot card's drag hands out a real file, so other apps get one.
 * When the shelf hands that file back, alone, while its card is still the
 * newest, the drop goes through the card's own add: a screenshot keeps one
 * place on the shelf, and the card says how it went. Any other drop takes
 * the shelf's plain route.
 */
export const createShotDrop = (deps: ShotDropDeps) => {
  // The file the card's last drag handed out, and the screenshot it is.
  let drag: { readonly seq: number; readonly file: string } | null = null;

  /** The card's screenshot, when `paths` is its file alone. */
  const cardShot = (paths: readonly string[]): number | null => {
    const [only] = paths;

    if (
      drag === null ||
      only === undefined ||
      paths.length !== 1 ||
      deps.saves.current(drag.seq) === null
    ) {
      return null;
    }

    return onDisk(only) === onDisk(drag.file) ? drag.seq : null;
  };

  const land = (to: ShotSaveTo, adding: Promise<ItemId | null>): void => {
    deps.dropped(to);
    void (async () => {
      const id = await adding;

      if (id !== null) {
        deps.added(to, id);
      }
    })();
  };

  return {
    /** The card's drag hands out `file` for screenshot `seq`. */
    dragged: (seq: number, file: string): void => {
      drag = { file, seq };
    },

    /** Files dropped on an item: the card's screenshot attached through its own add, or the files attached as files. */
    onItem: async (
      id: ItemId,
      paths: readonly string[]
    ): Promise<AttachResult> => {
      const seq = cardShot(paths);

      if (seq === null) {
        return await deps.attachFiles(id, paths);
      }

      land("item", deps.saves.dropOnItem(seq, id));

      // The shelf's drop says nothing and offers no Undo: the card says how it went.
      return { attached: [], message: null };
    },

    /** Files dropped on the shelf off any item: the card's Add to Shelf, or new items. */
    onShelf: (paths: readonly string[]): void => {
      const seq = cardShot(paths);

      if (seq === null) {
        deps.addFiles(paths);

        return;
      }

      land("shelf", deps.saves.addToShelf(seq));
    },
  };
};

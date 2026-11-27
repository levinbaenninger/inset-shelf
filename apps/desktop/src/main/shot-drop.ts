import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { AttachResult, ShotSaveTo } from "@shared/contracts";
import type { ItemId } from "@shared/shelf";

import { onDisk } from "./on-disk";
import { errorMessage } from "./save-error";
import type { Shot, ShotDrag, ShotDrop } from "./screenshot-saves";

/** A screenshot on the card, with the name the system saved it under, or Screenshot.png. */
type NamedShot = Shot & { readonly name: string };

export interface ShotDropDeps<S extends NamedShot> {
  /** The card's save path (screenshot-saves.ts). */
  readonly saves: {
    /** A drag of the card's screenshot, while it is the newest; null for an older one. */
    readonly drag: (seq: number) => ShotDrag<S> | null;
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
  /** A drag's file came back to the shelf: it went the card's way. */
  readonly dropped: (to: ShotSaveTo) => void;
  /** The card's picture couldn't be staged, so no drag starts: the user hears why. */
  readonly dragFailed: (why: string) => void;
  /** A drop threw after the shelf had its reply: the user hears why, once. */
  readonly dropFailed: (why: string) => void;
  /** Writes the card's picture, a PNG, as `name` into `folder`, the drag's own folder in staging, and returns the file; never a file of the user's. */
  readonly stage: (shot: S, folder: string, name: string) => string;
  /** Removes a drag's file from staging, still as it was written, once the disk holds its screenshot in a place on the shelf. Never throws. */
  readonly unstage: (file: string) => void;
}

/** What bytes hold, by their SHA-256: a file's size and modification time can stay the same through an edit. */
const digestOf = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

/** A drag's staged file: the drop it goes to, and the digest of the picture written. */
interface Copy {
  readonly drop: ShotDrop;
  readonly digest: string;
}

/** A drop of a drag's file: where it is on disk, its record, and the picture it holds. */
interface Claimed {
  readonly file: string;
  readonly copy: Copy;
  readonly png: Uint8Array;
}

/** What the shelf's drop says when a drag's file went the card's way: nothing, and no Undo. */
const NOTHING: AttachResult = { attached: [], message: null };

/**
 * Each drag of the screenshot card hands out a copy of its picture, staged
 * for that drag alone, so other apps get a real file and no file of the
 * user's is ever taken for the card's. The router knows each drag by its copy,
 * so a newer drag never takes an older one's place. When the shelf hands a
 * copy back, that file goes through the card's save path for the screenshot
 * that drag handed out, however long the drop took: a screenshot gets one
 * place on the shelf, and keeps the one it has. Every other file takes the
 * shelf's plain route.
 */
export const createShotDrop = <S extends NamedShot>(deps: ShotDropDeps<S>) => {
  // Each drag whose file is still staged, by where the file is on disk. No count of newer drags says a drop has come: the shelf and the card reach main on channels of their own.
  const drags = new Map<string, Copy>();

  /** The picture a drag's file holds, while it is the one written; null once an app saved the user's edit into it, or it can't be read. */
  const asStaged = (file: string, copy: Copy): Uint8Array | null => {
    try {
      const png = readFileSync(file);

      return digestOf(png) === copy.digest ? png : null;
    } catch {
      return null;
    }
  };

  /** The drag a dropped file is the staged file of, with the picture the file holds. Null for any other file, and for a drag's file the user edited in another app: that is a new picture of theirs. */
  const claim = (dropped: string): Claimed | null => {
    const file = onDisk(dropped);
    const copy = drags.get(file);
    const png = copy === undefined ? null : asStaged(file, copy);

    return copy === undefined || png === null ? null : { copy, file, png };
  };

  /**
   * A drag's file goes once the disk holds its screenshot in a place on the
   * shelf, unless an app the drag went to saved the user's edit into it.
   * Until then file and record stay: another drop of the file still gives
   * the screenshot its place.
   */
  const retire = ({ copy, file }: Claimed): void => {
    if (copy.drop.placed() && asStaged(file, copy) !== null) {
      deps.unstage(file);

      // Windows keeps a file another app has open: it stays staged, for a later drop of it and the sweep at quit.
      if (!existsSync(file)) {
        drags.delete(file);
      }
    }
  };

  /** A drop's files: each drag's file, which goes the card's way, and every other file, which takes the shelf's plain route. */
  const sort = (paths: readonly string[]) => {
    const cards: Claimed[] = [];
    const plain: string[] = [];

    for (const each of paths) {
      const claimed = claim(each);

      if (claimed === null) {
        plain.push(each);
      } else {
        cards.push(claimed);
      }
    }

    return { cards, plain };
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
  const land = (
    to: ShotSaveTo,
    claimed: Claimed,
    add: () => Promise<ItemId | null>
  ): void => {
    settle(async () => {
      deps.dropped(to);

      const id = await add();

      retire(claimed);

      if (id !== null) {
        deps.added(to, id);
      }
    });
  };

  const staged = (shot: S, folder: string): string | null => {
    try {
      // The card holds every screenshot as a PNG, whatever format the system saved it in.
      return deps.stage(shot, folder, `${path.parse(shot.name).name}.png`);
    } catch (error) {
      deps.dragFailed(errorMessage(error));

      return null;
    }
  };

  return {
    /** The card's drag for screenshot `seq`: the file it hands out, and the screenshot; null once it is not the newest, or when its file can't be written. */
    drag: (seq: number): { readonly file: string; readonly shot: S } | null => {
      const drag = deps.saves.drag(seq);

      if (drag === null) {
        return null;
      }

      const { drop, shot } = drag;
      // A folder no drag of this launch or an earlier one used: an edited file stays across launches.
      const file = staged(shot, randomUUID());

      if (file === null) {
        return null;
      }

      drags.set(onDisk(file), { digest: digestOf(shot.png), drop });

      return { file, shot };
    },

    /** Files dropped on an item: each drag's file attached through its screenshot's own add, the rest attached as files. */
    onItem: async (
      id: ItemId,
      paths: readonly string[]
    ): Promise<AttachResult> => {
      const { cards, plain } = sort(paths);

      for (const claimed of cards) {
        land(
          "item",
          claimed,
          async () => await claimed.copy.drop.onItem(id, claimed.png)
        );
      }

      return cards.length > 0 && plain.length === 0
        ? NOTHING
        : await deps.attachFiles(id, plain);
    },

    /** Files dropped on the shelf off any item: each drag's file through its screenshot's Add to Shelf, the rest as new items. */
    onShelf: (paths: readonly string[]): void => {
      const { cards, plain } = sort(paths);

      for (const claimed of cards) {
        land(
          "shelf",
          claimed,
          async () => await claimed.copy.drop.onShelf(claimed.png)
        );
      }

      if (cards.length === 0 || plain.length > 0) {
        settle(async () => {
          await deps.addFiles(plain);
        });
      }
    },

    /**
     * At quit: each drag's file still as it was written goes once the disk
     * holds its screenshot in a place on the shelf. One the user edited in
     * another app stays theirs, and one whose screenshot the disk doesn't
     * hold stays in staging, its only copy: the next launch leaves it there,
     * and a drop of it brings it in as a new picture.
     */
    sweep: (): void => {
      for (const [file, copy] of drags) {
        if (copy.drop.placed() && asStaged(file, copy) !== null) {
          deps.unstage(file);
        }
      }

      drags.clear();
    },
  };
};

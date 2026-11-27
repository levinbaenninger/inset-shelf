import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

import type { AttachResult, ShotSaveTo } from "@shared/contracts";
import type { ItemId } from "@shared/shelf";

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
  /** A drag's file came back alone: it went the card's way. */
  readonly dropped: (to: ShotSaveTo) => void;
  /** The card's picture couldn't be staged, so no drag starts: the user hears why. */
  readonly dragFailed: (why: string) => void;
  /** A drop threw after the shelf had its reply: the user hears why, once. */
  readonly dropFailed: (why: string) => void;
  /** Writes the card's picture, a PNG, as `name` into `folder`, the drag's own folder in staging, and returns the file; never a file of the user's. */
  readonly stage: (shot: S, folder: string, name: string) => string;
  /** Removes a drag's folder from staging once its drop came back to the shelf and its screenshot has a place there. Never throws. */
  readonly unstage: (folder: string) => void;
}

/** Where a file is on disk: macOS can name a temporary file under /var or under /private/var. */
const onDisk = (file: string): string => {
  try {
    return realpathSync.native(file);
  } catch {
    return path.resolve(file);
  }
};

/** A file's size and when it was last written; null when it can't be read. */
const stamp = (file: string): string | null => {
  try {
    const { mtimeMs, size } = statSync(file);

    return `${size}:${mtimeMs}`;
  } catch {
    return null;
  }
};

/** A drag's staged file: the drop it goes to, the folder it was staged in, and the file as it was written. */
interface Copy {
  readonly drop: ShotDrop;
  readonly folder: string;
  readonly written: string | null;
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
 * copy back, alone, the drop goes through the card's save path for the
 * screenshot that drag handed out, however long the drop took: a screenshot
 * gets one place on the shelf, and keeps the one it has. Any other drop takes
 * the shelf's plain route.
 */
export const createShotDrop = <S extends NamedShot>(deps: ShotDropDeps<S>) => {
  // Each drag whose file is still staged, by where the file is on disk, with the folder it staged the file in and the file as it was written. No count of newer drags says a drop has come: the shelf and the card reach main on channels of their own.
  const drags = new Map<string, Copy>();

  // Drags so far: each stages its file in a folder of its own, so no two drags share a file, or a record.
  let made = 0;

  /** The drag a drop hands back the file of, alone, with the picture the file holds. Null for any other drop. */
  const claim = (paths: readonly string[]): Claimed | null => {
    const [only] = paths;

    if (only === undefined || paths.length !== 1) {
      return null;
    }

    const file = onDisk(only);
    const copy = drags.get(file);

    if (copy === undefined) {
      return null;
    }

    try {
      return { copy, file, png: readFileSync(file) };
    } catch {
      return null;
    }
  };

  /**
   * A drag's file goes once its screenshot has a place on the shelf, unless
   * an app the drag went to saved the user's edit into it. Until then file
   * and record stay: another drop of the file still gives the screenshot its
   * place.
   */
  const retire = ({ copy, file }: Claimed): void => {
    if (copy.drop.placed() && stamp(file) === copy.written) {
      drags.delete(file);
      deps.unstage(copy.folder);
    }
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

      made += 1;

      const folder = `screenshot-drag-${made}`;
      const file = staged(shot, folder);

      if (file === null) {
        return null;
      }

      drags.set(onDisk(file), { drop, folder, written: stamp(file) });

      return { file, shot };
    },

    /** Files dropped on an item: the card's screenshot attached through its own add, or the files attached as files. */
    onItem: async (
      id: ItemId,
      paths: readonly string[]
    ): Promise<AttachResult> => {
      const claimed = claim(paths);

      if (claimed === null) {
        return await deps.attachFiles(id, paths);
      }

      land(
        "item",
        claimed,
        async () => await claimed.copy.drop.onItem(id, claimed.png)
      );

      return NOTHING;
    },

    /** Files dropped on the shelf off any item: the card's Add to Shelf, or new items. */
    onShelf: (paths: readonly string[]): void => {
      const claimed = claim(paths);

      if (claimed === null) {
        settle(async () => {
          await deps.addFiles(paths);
        });
      } else {
        land(
          "shelf",
          claimed,
          async () => await claimed.copy.drop.onShelf(claimed.png)
        );
      }
    },
  };
};

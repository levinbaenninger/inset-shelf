import { once } from "node:events";

import type { ActionResult, DrawingOnShelf } from "@shared/contracts";
import { parseSceneFile, sceneFileText } from "@shared/drawing-scene";
import type { StrokeMark } from "@shared/drawing-scene";
import type {
  DrawingScene,
  ImageItem,
  ItemId,
  Pin,
  ShelfImage,
  ShelfItem,
} from "@shared/shelf";

import type { CopyCommands } from "./copy-commands";
import { reportSaveError } from "./save-error";
import type { ShelfController } from "./shelf-controller";
import type { ShelfStore, WriteResult } from "./shelf-store";

/** The page's PNG, read: its size and the bytes to keep. */
export interface DrawingPicture {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly png: Uint8Array;
}

/** What the drawing page sends when it saves. */
export interface DrawingSaveInput {
  readonly copy: boolean;
  /** Retry in a held quit asked for it: Cancel or Quit without saving stops it. */
  readonly forQuit: boolean;
  /** Null when only the pins changed, or no mark is left: the picture the window opened on stays. */
  readonly png: Uint8Array | null;
  /** The marks drawn into `png`, in its DIP: kept beside it, so Annotate can open them again to edit. */
  readonly marks: readonly StrokeMark[];
  readonly pins: readonly Pin[];
}

/** What Annotate opens an image item on: the picture under its marks, read, and the marks a save kept. */
export interface DrawingOpening {
  /** Null for a drawing made on a blank page: it opens blank, its marks on it. */
  readonly picture: ShelfImage | null;
  readonly bytes: Uint8Array | null;
  readonly marks: readonly StrokeMark[];
}

export interface DrawingSaveDeps {
  readonly controller: Pick<
    ShelfController,
    "apply" | "item" | "persisted" | "snapshot"
  >;
  readonly store: Pick<
    ShelfStore,
    "attachmentPath" | "deleteAttachment" | "writeAttachment"
  >;
  /** Reads an attachment's bytes; null when it can't. */
  readonly readFile: (file: string) => Promise<Uint8Array | null>;
  /** The page's PNG as a picture; null when it isn't one. */
  readonly decode: (png: Uint8Array) => DrawingPicture | null;
  readonly copies: Pick<CopyCommands, "copy" | "copyDrawing">;
  /** Hides the drawing window: its marks are on the shelf. */
  readonly close: () => void;
  /** A save the page asked for has ended, saved or not. */
  readonly ended: () => void;
  /** The item the marks went to: the e2e log and the shelf's selection. */
  readonly added: (id: ItemId, via: "annotation" | "drawing") => void;
  /** After the user's own Save: the shelf shows the item, and says so when a copy failed or a copied drawing never reached the disk. */
  readonly show: (
    copied: ActionResult | null,
    saving: Promise<WriteResult> | null
  ) => void;
  /** Copies dragged out earlier show the old picture and pins. */
  readonly clearStaging: (id: ItemId) => void;
}

/** Where the drawing window's marks stand, for a held quit. */
export interface DrawingSaveState {
  /** A save during the quit put them on the shelf, which still holds them as it put them, and they haven't changed since. */
  readonly onShelf: boolean;
  /** Why the last save failed, in the shared words; null after one that worked. */
  readonly error: string | null;
}

export interface DrawingSaves {
  /** Reads what Annotate opens `item` on; changes nothing, so the caller can check the window is still free once it has. */
  readonly opening: (item: ImageItem) => Promise<DrawingOpening>;
  /** The window opens on an image item, or on a blank page (null). */
  readonly open: (
    item: { readonly id: ItemId; readonly opening: DrawingOpening } | null
  ) => void;
  /** The picture the window opened on, to draw the marks into; the same bytes however often it saves. */
  readonly image: () => Promise<Uint8Array | null>;
  /** The page's Save, Copy and Save, or Retry in a held quit (`forQuit`). */
  readonly save: (input: DrawingSaveInput) => Promise<ActionResult>;
  /** Retry in a held quit is about to ask the page to save; Cancel or Quit without saving aborts `stop`. */
  readonly forQuit: (stop: AbortSignal) => void;
  /** The page's marks changed. */
  readonly changed: () => void;
  readonly state: () => DrawingSaveState;
  /** What the shelf holds of the marks, for the close confirm. */
  readonly kept: () => DrawingOnShelf;
  /** The image item the marks go to; null for a blank page no save has put on the shelf. */
  readonly target: () => ItemId | null;
}

/** A save's new picture for the item, and the marks drawn into it (none to keep: undefined). */
interface Drawn {
  readonly image: ShelfImage;
  readonly scene: DrawingScene | undefined;
}

/** The item a save put the marks on, and the shelf's revision that holds them. */
interface Put {
  readonly id: ItemId;
  readonly rev: number;
  readonly via: "annotation" | "drawing";
}

/** A drawing exported at twice its size, so it stays sharp on Retina displays. */
export const DRAWING_PIXELS_PER_DIP = 2;

const STOPPED = Symbol("stopped");

/** Resolves once `stop` is aborted; never otherwise. */
const whenStopped = async (stop: AbortSignal): Promise<typeof STOPPED> => {
  if (!stop.aborted) {
    await once(stop, "abort");
  }

  return STOPPED;
};

/**
 * The drawing window's saves. The user's own Save puts the marks on the
 * shelf and closes the window. A save during a held quit keeps the window
 * open, with its marks, until shelf.json holds them, and Cancel stops it
 * at any point (Round 8). Its next save replaces the item it made, so a
 * Retry never adds the drawing twice.
 */
export const createDrawingSaves = (deps: DrawingSaveDeps): DrawingSaves => {
  // The item the marks go to: the image opened, or the item a held quit's save made from a blank page.
  let target: ItemId | null = null;
  // Opened as New Drawing: no item yet, and a copy of it is the user's own picture.
  let blank = true;
  let base: Promise<Uint8Array | null> = Promise.resolve(null);
  // The picture the window opened on, which the page shows under its marks; null for a blank page.
  let opened: ShelfImage | null = null;
  let quitStop: AbortSignal | null = null;
  // The item as a held quit's save left it: the marks count as on the shelf only while the shelf still holds exactly that.
  let applied: ShelfItem | null = null;
  let error: string | null = null;

  /** The new picture and its marks (or, with none, only the pins) on the image the marks go to, or on a new item. */
  const place = (
    item: ImageItem | null,
    drawn: Drawn | null,
    pins: readonly Pin[]
  ): Put | ActionResult => {
    if (item !== null) {
      if (drawn !== null) {
        deps.controller.apply({
          id: item.id,
          image: drawn.image,
          scene: drawn.scene,
          type: "replaceImage",
        });
      }

      deps.controller.apply({ id: item.id, pins: [...pins], type: "setPins" });
      deps.clearStaging(item.id);

      return {
        id: item.id,
        rev: deps.controller.snapshot().rev,
        via: blank ? "drawing" : "annotation",
      };
    }

    if (drawn === null) {
      return { message: "There is nothing to save.", ok: false };
    }

    const id = deps.controller.apply({
      context: null,
      image: drawn.image,
      pins: [...pins],
      scene: drawn.scene,
      source: null,
      type: "addImage",
      via: "drawing",
    });

    return id === null
      ? { message: "The drawing could not be added.", ok: false }
      : { id, rev: deps.controller.snapshot().rev, via: "drawing" };
  };

  /**
   * With only pins sent, the picture they sit on: none to change while the
   * item still has the one the window opened on; that one again, without
   * marks, once a save drew marks into the item that the page no longer has.
   * Its file is still there: the marks kept with the item name it.
   */
  const unmarked = (item: ImageItem): Drawn | null =>
    opened === null || item.image.file === opened.file
      ? null
      : { image: opened, scene: undefined };

  /** An attachment's bytes; null when it can't be read. */
  const read = async (file: string): Promise<Uint8Array | null> => {
    const at = deps.store.attachmentPath(file);

    return at === null ? null : await deps.readFile(at);
  };

  /** Writes the picture and the marks drawn into it: the item's new picture. */
  const write = async (
    item: ShelfItem | undefined,
    picture: DrawingPicture,
    marks: readonly StrokeMark[]
  ): Promise<Drawn> => {
    const file = await deps.store.writeAttachment(picture.png);

    const kept =
      marks.length === 0
        ? null
        : await deps.store.writeAttachment(
            new TextEncoder().encode(sceneFileText(marks)),
            "json"
          );

    return {
      image: {
        file,
        heightPx: picture.heightPx,
        pixelsPerDip:
          item?.kind === "image"
            ? item.image.pixelsPerDip
            : DRAWING_PIXELS_PER_DIP,
        widthPx: picture.widthPx,
      },
      scene: kept === null ? undefined : { base: opened, file: kept },
    };
  };

  /** Puts the marks on the shelf; the item and the revision that holds them, or why not. */
  const apply = async (
    input: DrawingSaveInput,
    stop: AbortSignal | null
  ): Promise<Put | ActionResult> => {
    const item = target === null ? undefined : deps.controller.item(target);
    const picture = input.png === null ? null : deps.decode(input.png);

    if (input.png !== null && picture === null) {
      return { message: "The drawing could not be read.", ok: false };
    }

    if (!blank && item?.kind !== "image") {
      return { message: "This image is no longer on the shelf.", ok: false };
    }

    if (picture === null) {
      return item?.kind === "image"
        ? place(item, unmarked(item), input.pins)
        : { message: "There is nothing to save.", ok: false };
    }

    const drawn = await write(item, picture, input.marks);

    if (stop?.aborted === true) {
      await Promise.all(
        [drawn.image.file, drawn.scene?.file].flatMap((file) =>
          file === undefined ? [] : [deps.store.deleteAttachment(file)]
        )
      );

      return { ok: true };
    }

    return place(item?.kind === "image" ? item : null, drawn, input.pins);
  };

  /** The user's own Save: the window closes at once; a copy waits for its own save. */
  const saveAndClose = async (
    input: DrawingSaveInput,
    put: Put
  ): Promise<ActionResult> => {
    let copied: ActionResult | null = null;
    let saving: Promise<WriteResult> | null = null;

    if (input.copy) {
      const added = deps.controller.item(put.id);

      // A new drawing is the user's own picture: it is copied even when the shelf can't save it (Round 6).
      if (blank && added?.kind === "image") {
        copied = await deps.copies.copyDrawing(added);
        saving = copied.ok ? deps.controller.persisted(put.rev) : null;
      } else {
        copied = await deps.copies.copy(put.id);
      }
    }

    deps.close();
    deps.added(put.id, put.via);
    deps.show(copied, saving);

    return { ok: true };
  };

  /** Retry in a held quit: the window stays open until the disk holds the marks, and Cancel stops the wait. */
  const saveForQuit = async (
    put: Put,
    stop: AbortSignal
  ): Promise<ActionResult> => {
    target = put.id;
    applied = deps.controller.item(put.id) ?? null;

    const written = await Promise.race([
      deps.controller.persisted(put.rev),
      whenStopped(stop),
    ]);

    if (written === STOPPED || stop.aborted) {
      return { ok: true };
    }

    if (!written.ok) {
      return written;
    }

    deps.close();
    deps.added(put.id, put.via);

    return { ok: true };
  };

  // Deleted, discarded or edited since, the shelf no longer holds these marks.
  const onShelf = (): boolean =>
    applied !== null &&
    target !== null &&
    deps.controller.item(target) === applied;

  const run = async (input: DrawingSaveInput): Promise<ActionResult> => {
    // After Cancel the window keeps its marks, so the page shows no problem either.
    const stop = input.forQuit ? quitStop : null;

    if (stop?.aborted === true) {
      return { ok: true };
    }

    const put = await apply(input, stop);

    if ("ok" in put) {
      return put;
    }

    return stop === null
      ? await saveAndClose(input, put)
      : await saveForQuit(put, stop);
  };

  return {
    changed: () => {
      applied = null;
    },
    forQuit: (stop) => {
      quitStop = stop;
    },
    image: async () => await base,
    open: (item) => {
      target = item?.id ?? null;
      blank = item === null;
      applied = null;
      error = null;
      opened = item?.opening.picture ?? null;
      base = Promise.resolve(item?.opening.bytes ?? null);
    },
    opening: async (item) => {
      // Read now: a write that no longer names the picture can delete it while the window is still open.
      const asShown = async (): Promise<DrawingOpening> => ({
        bytes: await read(item.image.file),
        marks: [],
        picture: item.image,
      });

      const { scene } = item;

      if (scene === undefined) {
        return await asShown();
      }

      const [file, bytes] = await Promise.all([
        read(scene.file),
        scene.base === null ? null : read(scene.base.file),
      ]);

      const marks = file === null ? null : parseSceneFile(file);

      // Marks, or the picture under them, that can't be read: the item opens as it shows, marks drawn in, as before they were kept.
      return marks === null || (scene.base !== null && bytes === null)
        ? await asShown()
        : { bytes, marks, picture: scene.base };
    },
    save: async (input) => {
      try {
        // A failed write says why in the shared words (Round 7).
        const result = await reportSaveError(async () => await run(input));

        error = result.ok ? null : result.message;

        return result;
      } finally {
        deps.ended();
      }
    },
    kept: () => {
      if (onShelf()) {
        return "asIs";
      }

      return target !== null && deps.controller.item(target) !== undefined
        ? "earlier"
        : "none";
    },
    state: () => ({ error, onShelf: onShelf() }),
    target: () => target,
  };
};

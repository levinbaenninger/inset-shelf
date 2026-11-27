import { once } from "node:events";

import type { ActionResult, DrawingOnShelf } from "@shared/contracts";
import { parseSceneFile, sceneFileText } from "@shared/drawing-scene";
import type { StrokeMark } from "@shared/drawing-scene";
import { ATTACHMENTS_MAX, clampPins } from "@shared/shelf";
import type {
  AttachedImage,
  AttachmentId,
  DrawingScene,
  ImageItem,
  ItemId,
  Picture,
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

/** What the drawing window's marks go to. */
export type DrawingTarget =
  /** New Drawing: a new item. */
  | { readonly kind: "new" }
  /** Annotate on an image item; `screenshot`: the screenshot card's, made as its Annotate opened. */
  | { readonly kind: "item"; readonly id: ItemId; readonly screenshot?: true }
  /** New Drawing in an item's details: a new attachment of that item. */
  | { readonly kind: "newAttachment"; readonly id: ItemId }
  /** Annotate on a picture attached to an item. */
  | {
      readonly kind: "attachment";
      readonly id: ItemId;
      readonly attachmentId: AttachmentId;
    };

/** Where marks a save already put on the shelf are: an item, or one of its attachments. */
type Placed = Extract<DrawingTarget, { readonly kind: "item" | "attachment" }>;

export const sameTarget = (a: DrawingTarget, b: DrawingTarget): boolean =>
  a.kind === b.kind &&
  (a.kind === "new" || ("id" in b && a.id === b.id)) &&
  (a.kind !== "attachment" ||
    (b.kind === "attachment" && a.attachmentId === b.attachmentId));

/** What Annotate opens a picture on: the picture under its marks, read, and the marks a save kept. */
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
  readonly copies: Pick<
    CopyCommands,
    "copy" | "copyDrawing" | "copyOwnPicture" | "copyPicture"
  >;
  readonly newAttachmentId: () => AttachmentId;
  readonly now: () => Date;
  /** Says something the user didn't ask for happened to the marks. */
  readonly notify: (message: string) => void;
  /** Hides the drawing window: its marks are on the shelf. */
  readonly close: () => void;
  /** A save the page asked for has ended, saved or not. */
  readonly ended: () => void;
  /** The item the marks went to: the e2e log and the shelf's selection. */
  readonly added: (id: ItemId, via: "annotation" | "drawing") => void;
  /** The shelf selects an item and brings it into view, as after a capture, which also leaves details. */
  readonly focus: (id: ItemId) => void;
  /** The screenshot card's item, once its Annotate's Save closes it: the shelf says where the screenshot went, and open details stay. */
  readonly shotSaved: (id: ItemId) => void;
  /** The screenshot card's item, once its Annotate closes without a Save: a notice says where the screenshot went, the shelf shown or not. */
  readonly shotClosed: (id: ItemId) => void;
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
  /** Reads what Annotate opens a picture on; changes nothing, so the caller can check the window is still free once it has. */
  readonly opening: (picture: Picture) => Promise<DrawingOpening>;
  /** The window opens on a picture, with what was read for it, or on a blank page. */
  readonly open: (target: DrawingTarget, opening?: DrawingOpening) => void;
  /** The window has hidden, after Save, Cancel or its close button. */
  readonly hidden: () => void;
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
  /** What the marks go to: where a held quit's save put them, else what the window opened as. */
  readonly target: () => DrawingTarget;
}

/** A save's new picture for the item, and the marks drawn into it (none to keep: undefined). */
interface Drawn {
  readonly image: ShelfImage;
  readonly scene: DrawingScene | undefined;
}

/** Where a save put the marks, and the shelf's revision that holds them. */
interface Put {
  readonly placed: Placed;
  readonly rev: number;
  readonly via: "annotation" | "drawing";
  /** A new drawing: the user's own picture, copied even when the shelf can't save it. */
  readonly own: boolean;
}

/** Where a save's marks go now, read from the shelf. */
type Destination =
  | { readonly kind: "newItem"; readonly full: boolean }
  | { readonly kind: "item"; readonly item: ImageItem }
  | { readonly kind: "attach"; readonly item: ShelfItem }
  | {
      readonly kind: "attachment";
      readonly item: ShelfItem;
      readonly attachment: AttachedImage;
    }
  | { readonly kind: "gone"; readonly message: string };

const DRAWING_NAME = "Drawing";

const FELL_BACK = `The item already holds ${ATTACHMENTS_MAX} attachments, so the drawing was saved as its own item.`;

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

/** The picture attached to an item under this id, if it is a picture. */
const attachedImage = (
  item: ShelfItem | undefined,
  attachmentId: AttachmentId
): AttachedImage | undefined => {
  const attachment = item?.attachments.find(
    (candidate) => candidate.id === attachmentId
  );

  return attachment?.kind === "image" ? attachment : undefined;
};

/** The picture the marks were drawn on, when they go to one that exists. */
const pictureOf = (to: Destination): ShelfImage | null => {
  if (to.kind === "item") {
    return to.item.image;
  }

  return to.kind === "attachment" ? to.attachment.image : null;
};

/**
 * The drawing window's saves. The user's own Save puts the marks on the
 * shelf and closes the window. A save during a held quit keeps the window
 * open, with its marks, until shelf.json holds them, and Cancel stops it
 * at any point (Round 8). Its next save replaces the item it made, so a
 * Retry never adds the drawing twice.
 */
export const createDrawingSaves = (deps: DrawingSaveDeps): DrawingSaves => {
  // What the window opened as.
  let opened: DrawingTarget = { kind: "new" };
  // Where a held quit's save put the marks: the next save replaces them there, so a Retry never adds them twice.
  let made: Placed | null = null;
  let base: Promise<Uint8Array | null> = Promise.resolve(null);
  // The picture the window opened on, which the page shows under its marks; null for a blank page.
  let openedPicture: ShelfImage | null = null;
  let quitStop: AbortSignal | null = null;
  // The screenshot card's item while its Annotate is open: closed without a Save, the window's hide still announces it.
  let unannounced: ItemId | null = null;
  // The item as a held quit's save left it: the marks count as on the shelf only while the shelf still holds exactly that.
  let applied: ShelfItem | null = null;
  let error: string | null = null;

  /** A new drawing, not an annotation: the user's own picture. */
  const own = (): boolean =>
    opened.kind === "new" || opened.kind === "newAttachment";

  /** A picture attached to an item, as the shelf holds it now; gone when either is. */
  const attachmentDestination = (
    id: ItemId,
    attachmentId: AttachmentId
  ): Destination => {
    const item = deps.controller.item(id);
    const attachment = attachedImage(item, attachmentId);

    return item === undefined || attachment === undefined
      ? { kind: "gone", message: "This picture is no longer on the shelf." }
      : { attachment, item, kind: "attachment" };
  };

  /** Where the marks go now: what the window opened as, or where a held quit's save put them. */
  const destination = (): Destination => {
    switch (opened.kind) {
      case "new": {
        const item = made === null ? undefined : deps.controller.item(made.id);

        return item?.kind === "image"
          ? { item, kind: "item" }
          : { full: false, kind: "newItem" };
      }

      case "item": {
        const item = deps.controller.item(opened.id);

        return item?.kind === "image"
          ? { item, kind: "item" }
          : { kind: "gone", message: "This image is no longer on the shelf." };
      }

      case "attachment": {
        return attachmentDestination(opened.id, opened.attachmentId);
      }

      case "newAttachment": {
        const item = deps.controller.item(opened.id);

        if (item === undefined) {
          return {
            kind: "gone",
            message: "This item is no longer on the shelf.",
          };
        }

        if (
          made?.kind === "attachment" &&
          attachedImage(item, made.attachmentId) !== undefined
        ) {
          return attachmentDestination(made.id, made.attachmentId);
        }

        // A held quit's save made it an item of its own, the item being full: the next save replaces that one.
        const fallback =
          made?.kind === "item" ? deps.controller.item(made.id) : undefined;

        if (fallback?.kind === "image") {
          return { item: fallback, kind: "item" };
        }

        return item.attachments.length >= ATTACHMENTS_MAX
          ? { full: true, kind: "newItem" }
          : { item, kind: "attach" };
      }

      default: {
        return {
          kind: "gone",
          message: "This item is no longer on the shelf.",
        };
      }
    }
  };

  /** The new picture and its marks (or, with none, only the pins) where the marks go. */
  const place = (
    to: Destination,
    drawn: Drawn | null,
    pins: readonly Pin[]
  ): Put | ActionResult => {
    const via = own() ? "drawing" : "annotation";

    switch (to.kind) {
      case "gone": {
        return { message: to.message, ok: false };
      }

      case "item": {
        const { id } = to.item;

        if (drawn !== null) {
          deps.controller.apply({
            id,
            image: drawn.image,
            scene: drawn.scene,
            type: "replaceImage",
          });
        }

        deps.controller.apply({ id, pins: [...pins], type: "setPins" });
        deps.clearStaging(id);

        return {
          own: own(),
          placed: { id, kind: "item" },
          rev: deps.controller.snapshot().rev,
          via,
        };
      }

      case "attachment": {
        const { id } = to.item;
        const attachmentId = to.attachment.id;

        if (drawn !== null) {
          deps.controller.apply({
            attachmentId,
            id,
            image: drawn.image,
            scene: drawn.scene,
            type: "replaceAttachmentImage",
          });
        }

        deps.controller.apply({
          attachmentId,
          id,
          pins: [...pins],
          type: "setAttachmentPins",
        });
        deps.clearStaging(id);

        return {
          own: own(),
          placed: { attachmentId, id, kind: "attachment" },
          rev: deps.controller.snapshot().rev,
          via,
        };
      }

      case "attach": {
        if (drawn === null) {
          return { message: "There is nothing to save.", ok: false };
        }

        const attachmentId = deps.newAttachmentId();
        const { id } = to.item;

        const fresh: AttachedImage = {
          addedAt: deps.now().toISOString(),
          id: attachmentId,
          image: drawn.image,
          kind: "image",
          name: DRAWING_NAME,
          pins: clampPins(pins, drawn.image),
        };

        deps.controller.apply({
          attachments: [
            drawn.scene === undefined
              ? fresh
              : { ...fresh, scene: drawn.scene },
          ],
          id,
          type: "attach",
        });

        return {
          own: true,
          placed: { attachmentId, id, kind: "attachment" },
          rev: deps.controller.snapshot().rev,
          via: "drawing",
        };
      }

      case "newItem": {
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

        if (id === null) {
          return { message: "The drawing could not be added.", ok: false };
        }

        if (to.full) {
          deps.notify(FELL_BACK);
        }

        return {
          own: true,
          placed: { id, kind: "item" },
          rev: deps.controller.snapshot().rev,
          via: "drawing",
        };
      }

      default: {
        return { message: "There is nothing to save.", ok: false };
      }
    }
  };

  /**
   * With only pins sent, the picture they sit on: none to change while the
   * destination still has the one the window opened on; that one again,
   * without marks, once a save drew marks into it that the page no longer
   * has. Its file is still there: the marks kept with it name it.
   */
  const unmarked = (picture: ShelfImage): Drawn | null =>
    openedPicture === null || picture.file === openedPicture.file
      ? null
      : { image: openedPicture, scene: undefined };

  /** An attachment's bytes; null when it can't be read. */
  const read = async (file: string): Promise<Uint8Array | null> => {
    const at = deps.store.attachmentPath(file);

    return at === null ? null : await deps.readFile(at);
  };

  /** Writes the picture and the marks drawn into it: the new picture. */
  const write = async (
    pixelsPerDip: number,
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
        pixelsPerDip,
        widthPx: picture.widthPx,
      },
      scene: kept === null ? undefined : { base: openedPicture, file: kept },
    };
  };

  const forget = async (drawn: Drawn): Promise<void> => {
    await Promise.all(
      [drawn.image.file, drawn.scene?.file].flatMap((file) =>
        file === undefined ? [] : [deps.store.deleteAttachment(file)]
      )
    );
  };

  /** Puts the marks on the shelf; where, and the revision that holds them, or why not. */
  const apply = async (
    input: DrawingSaveInput,
    stop: AbortSignal | null
  ): Promise<Put | ActionResult> => {
    const to = destination();
    const picture = input.png === null ? null : deps.decode(input.png);

    if (input.png !== null && picture === null) {
      return { message: "The drawing could not be read.", ok: false };
    }

    if (to.kind === "gone") {
      return { message: to.message, ok: false };
    }

    const onto = pictureOf(to);

    if (picture === null) {
      return onto === null
        ? { message: "There is nothing to save.", ok: false }
        : place(to, unmarked(onto), input.pins);
    }

    const drawn = await write(
      onto?.pixelsPerDip ?? DRAWING_PIXELS_PER_DIP,
      picture,
      input.marks
    );

    if (stop?.aborted === true) {
      await forget(drawn);

      return { ok: true };
    }

    // Read again: the shelf can change while the picture is written.
    const now = destination();

    if (now.kind === "gone") {
      await forget(drawn);
    }

    return place(now, drawn, input.pins);
  };

  /** The marks' own copy: a new drawing is the user's own picture, copied even when the shelf can't save it (Round 6). */
  const copyOwn = async (put: Put): Promise<ActionResult | null> => {
    const item = deps.controller.item(put.placed.id);

    if (put.placed.kind === "item") {
      return item?.kind === "image"
        ? await deps.copies.copyDrawing(item)
        : null;
    }

    const attachment = attachedImage(item, put.placed.attachmentId);

    return attachment === undefined
      ? null
      : await deps.copies.copyOwnPicture(attachment);
  };

  /**
   * Marks that went to an item of their own, new or annotated, bring it into
   * view, except on the screenshot card's item, which main announces. Marks
   * on an attachment leave the shelf where the user was: in the details the
   * picture was opened from, or on the list.
   */
  const landed = (put: Put): void => {
    deps.added(put.placed.id, put.via);

    if (put.placed.kind !== "item") {
      return;
    }

    if (opened.kind === "item" && opened.screenshot === true) {
      deps.shotSaved(put.placed.id);
    } else {
      deps.focus(put.placed.id);
    }
  };

  /** The user's own Save: the window closes at once; a copy waits for its own save. */
  const saveAndClose = async (
    input: DrawingSaveInput,
    put: Put
  ): Promise<ActionResult> => {
    let copied: ActionResult | null = null;
    let saving: Promise<WriteResult> | null = null;

    if (input.copy) {
      const mine = put.own ? await copyOwn(put) : null;

      if (mine === null) {
        copied =
          put.placed.kind === "attachment"
            ? await deps.copies.copyPicture(
                put.placed.id,
                put.placed.attachmentId
              )
            : await deps.copies.copy(put.placed.id);
      } else {
        copied = mine;
        saving = copied.ok ? deps.controller.persisted(put.rev) : null;
      }
    }

    // Save announces the screenshot's item itself, so the window's hide doesn't.
    unannounced = null;
    deps.close();
    landed(put);
    deps.show(copied, saving);

    return { ok: true };
  };

  /** Retry in a held quit: the window stays open until the disk holds the marks, and Cancel stops the wait. */
  const saveForQuit = async (
    put: Put,
    stop: AbortSignal
  ): Promise<ActionResult> => {
    made = put.placed;
    applied = deps.controller.item(put.placed.id) ?? null;

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
    landed(put);

    return { ok: true };
  };

  /** What the marks go to: where a held quit's save put them, else what the window opened as. */
  const target = (): DrawingTarget => made ?? opened;

  // Deleted, discarded or edited since, the shelf no longer holds these marks.
  const onShelf = (): boolean =>
    applied !== null &&
    made !== null &&
    deps.controller.item(made.id) === applied;

  /** Whether the shelf holds an earlier version of the marks: the picture they go to still exists. */
  const onShelfEarlier = (): boolean => {
    const now = target();

    if (now.kind === "new" || now.kind === "newAttachment") {
      return false;
    }

    const item = deps.controller.item(now.id);

    return now.kind === "item"
      ? item !== undefined
      : attachedImage(item, now.attachmentId) !== undefined;
  };

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
    hidden: () => {
      const id = unannounced;

      unannounced = null;

      if (id !== null && deps.controller.item(id) !== undefined) {
        deps.shotClosed(id);
      }
    },
    image: async () => await base,
    open: (to, opening) => {
      opened = to;
      unannounced = to.kind === "item" && to.screenshot === true ? to.id : null;
      made = null;
      applied = null;
      error = null;
      openedPicture = opening?.picture ?? null;
      base = Promise.resolve(opening?.bytes ?? null);
    },
    opening: async (picture) => {
      // Read now: a write that no longer names the picture can delete it while the window is still open.
      const asShown = async (): Promise<DrawingOpening> => ({
        bytes: await read(picture.image.file),
        marks: [],
        picture: picture.image,
      });

      const { scene } = picture;

      if (scene === undefined) {
        return await asShown();
      }

      const [file, bytes] = await Promise.all([
        read(scene.file),
        scene.base === null ? null : read(scene.base.file),
      ]);

      const marks = file === null ? null : parseSceneFile(file);

      // Marks, or the picture under them, that can't be read: the picture opens as it shows, marks drawn in, as before they were kept.
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

      return onShelfEarlier() ? "earlier" : "none";
    },
    state: () => ({ error, onShelf: onShelf() }),
    target,
  };
};

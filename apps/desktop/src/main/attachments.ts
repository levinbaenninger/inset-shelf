import path from "node:path";

import type { AttachResult } from "@shared/contracts";
import { ATTACHMENTS_MAX, fitText } from "@shared/shelf";
import type {
  AttachedImage,
  Attachment,
  AttachmentId,
  ItemId,
  MainOp,
  ShelfImage,
  ShelfItem,
  StoredFile,
} from "@shared/shelf";

import { ADDED_FILE_MAX_BYTES, classifyAddedFile } from "./added-file";

/** A picture read and turned into PNG bytes. */
export interface DecodedImage {
  readonly png: Uint8Array;
  readonly widthPx: number;
  readonly heightPx: number;
}

/** A picture or file now in the data folder, not yet on any item. */
export type StoredUpload =
  | {
      readonly kind: "image";
      readonly image: ShelfImage;
      /** The picture's own name, without its extension. */
      readonly name: string;
      /** A PNG's extension as its file spelled it, where that isn't .png. */
      readonly extension?: string;
    }
  | { readonly kind: "file"; readonly file: StoredFile };

export interface Problem {
  readonly problem: string;
}

export interface AttachmentDeps {
  readonly stat: (
    file: string
  ) => Promise<{ readonly isFile: boolean; readonly size: number }>;
  /** The picture in a file as PNG; null when it is not one the app can read. */
  readonly readImage: (file: string) => DecodedImage | null;
  /** Pasted bytes as PNG; null when they are not a picture the app can read. */
  readonly decodeImage: (bytes: Uint8Array) => DecodedImage | null;
  /** The picture on the clipboard, or else the path of a file copied there; null for neither. */
  readonly clipboard: () => Promise<
    | { readonly kind: "image"; readonly image: DecodedImage }
    | { readonly kind: "file"; readonly path: string }
    | null
  >;
  readonly writeAttachment: (png: Uint8Array) => Promise<string>;
  readonly copyAttachment: (from: string, extension: string) => Promise<string>;
  readonly deleteAttachment: (file: string) => Promise<void>;
  /** A copy the shelf staged for a drag out: dropped back, it is already on the shelf. */
  readonly isStaged: (file: string) => boolean;
  readonly item: (id: ItemId) => ShelfItem | undefined;
  readonly apply: (op: MainOp) => void;
  readonly newAttachmentId: () => AttachmentId;
  readonly now: () => Date;
}

/** What attaching did: the attachments put on the item, how many it had no room for, and what couldn't be read. */
export interface AttachOutcome {
  readonly attached: readonly AttachmentId[];
  readonly refused: number;
  readonly problems: readonly string[];
}

const PASTED_NAME = "Pasted image";

const GONE = "This item no longer exists.";

const toAttachment = (
  upload: StoredUpload,
  id: AttachmentId,
  addedAt: string
): Attachment => {
  if (upload.kind === "file") {
    return { addedAt, file: upload.file, id, kind: "file" };
  }

  const picture: AttachedImage = {
    addedAt,
    id,
    image: upload.image,
    kind: "image",
    name: upload.name,
    pins: [],
  };

  return upload.extension === undefined
    ? picture
    : { ...picture, extension: upload.extension };
};

const storedFiles = (upload: StoredUpload): readonly string[] =>
  upload.kind === "image" ? [upload.image.file] : [upload.file.stored];

const pictureName = (fileName: string): string =>
  path.parse(fileName).name || fileName;

/** The longest a file's name runs in a reason, so a toast's tooltip still holds the reason after it. */
const REASON_NAME_MAX = 60;

/** A file's name as a reason says it: cut at the end of its stem when long, so its extension still shows. */
const reasonName = (name: string): string => {
  if (name.length <= REASON_NAME_MAX) {
    return name;
  }

  const extension = path.extname(name);
  const kept = extension.length < REASON_NAME_MAX / 2 ? extension : "";

  return `${fitText(name.slice(0, name.length - kept.length), REASON_NAME_MAX - kept.length)}${kept}`;
};

export const createAttachments = (deps: AttachmentDeps) => {
  const storePicture = async (
    image: DecodedImage,
    name: string
  ): Promise<Extract<StoredUpload, { kind: "image" }>> => ({
    image: {
      file: await deps.writeAttachment(image.png),
      heightPx: image.heightPx,
      pixelsPerDip: 1,
      widthPx: image.widthPx,
    },
    kind: "image",
    name,
  });

  /** Reads one added file into the data folder: a picture as PNG, anything else as itself; or says why it can't. */
  const prepare = async (filePath: string): Promise<StoredUpload | Problem> => {
    const added = classifyAddedFile(filePath);

    try {
      const info = await deps.stat(filePath);

      if (!info.isFile) {
        return {
          problem: `${reasonName(added.name)} is a folder, not a file.`,
        };
      }

      if (info.size > ADDED_FILE_MAX_BYTES) {
        return { problem: `${reasonName(added.name)} is larger than 200 MB.` };
      }

      const image = added.kind === "image" ? deps.readImage(filePath) : null;

      if (image !== null) {
        const stored = await storePicture(image, pictureName(added.name));

        // From the name on disk: `added.name` is capped, and can lose it.
        const extension = path.extname(path.basename(filePath));

        // A PNG that spells its extension another way (.PNG) drags out with it.
        return added.extension === "png" && extension !== ".png"
          ? { ...stored, extension }
          : stored;
      }

      return {
        file: {
          bytes: info.size,
          name: added.name,
          stored: await deps.copyAttachment(filePath, added.extension),
        },
        kind: "file",
      };
    } catch {
      return { problem: `${reasonName(added.name)} couldn’t be read.` };
    }
  };

  /**
   * Attaches what fits, in order, and deletes the stored files of the rest.
   * The room is read and the attachments applied with nothing awaited in
   * between, so two drops never both take the same room.
   */
  const attachTo = (
    id: ItemId,
    uploads: readonly StoredUpload[]
  ): AttachOutcome => {
    const item = deps.item(id);
    const room = ATTACHMENTS_MAX - (item?.attachments.length ?? 0);
    const fitting = item === undefined ? [] : uploads.slice(0, room);
    const left = uploads.slice(fitting.length);
    const addedAt = deps.now().toISOString();

    const attached = fitting.map((upload) =>
      toAttachment(upload, deps.newAttachmentId(), addedAt)
    );

    if (attached.length > 0) {
      deps.apply({ attachments: attached, id, type: "attach" });
    }

    for (const file of left.flatMap(storedFiles)) {
      void deps.deleteAttachment(file);
    }

    return item === undefined
      ? { attached: [], problems: [GONE], refused: 0 }
      : {
          attached: attached.map((attachment) => attachment.id),
          problems: [],
          refused: left.length,
        };
  };

  /** Files dropped on an item or picked for it, in the order given; the shelf's own dragged-out copies are skipped. */
  const attachFilesTo = async (
    id: ItemId,
    paths: readonly string[]
  ): Promise<AttachOutcome> => {
    const outside = paths.filter((file) => !deps.isStaged(file));
    const prepared = await Promise.all(outside.map(prepare));

    const uploads = prepared.flatMap((entry) =>
      "problem" in entry ? [] : [entry]
    );

    const outcome = attachTo(id, uploads);

    return {
      ...outcome,
      problems: [
        ...outcome.problems,
        ...prepared.flatMap((entry) =>
          "problem" in entry ? [entry.problem] : []
        ),
      ],
    };
  };

  /** A pasted picture, or with no bytes the clipboard's: its picture, else a file copied there. */
  const pasteImageTo = async (
    id: ItemId,
    bytes: Uint8Array | null
  ): Promise<AttachOutcome> => {
    if (bytes !== null) {
      const image = deps.decodeImage(bytes);

      return image === null
        ? {
            attached: [],
            problems: ["The pasted data is not an image Inset can read."],
            refused: 0,
          }
        : attachTo(id, [await storePicture(image, PASTED_NAME)]);
    }

    const copied = await deps.clipboard();

    if (copied === null) {
      return {
        attached: [],
        problems: ["The clipboard holds no image."],
        refused: 0,
      };
    }

    return copied.kind === "file"
      ? await attachFilesTo(id, [copied.path])
      : attachTo(id, [await storePicture(copied.image, PASTED_NAME)]);
  };

  /** One added file as the operation that adds it as a new item, or why it can't be added. */
  const prepareItem = async (filePath: string): Promise<MainOp | Problem> => {
    const upload = await prepare(filePath);

    if ("problem" in upload) {
      return upload;
    }

    if (upload.kind === "file") {
      return { context: null, file: upload.file, type: "addFile" };
    }

    const add: MainOp = {
      context: null,
      fileName: upload.name,
      image: upload.image,
      pins: [],
      source: null,
      title: upload.name,
      type: "addImage",
      via: "paste",
    };

    return upload.extension === undefined
      ? add
      : { ...add, extension: upload.extension };
  };

  return { attachFilesTo, attachTo, pasteImageTo, prepare, prepareItem };
};

/**
 * How attaching ended, for the page: what landed first, as a count of what
 * was tried, then why the rest didn't. With nothing attached and no room
 * asked for, the reasons say it all.
 */
export const attachResult = (outcome: AttachOutcome): AttachResult => {
  const { attached, problems, refused } = outcome;
  const added = attached.length;
  const tried = added + refused + problems.length;
  const room = `An item holds up to ${ATTACHMENTS_MAX}.`;

  const landed =
    added === 0
      ? ["Nothing was attached."]
      : [`Attached ${added} of ${tried}.`];

  const messages = [
    ...(added === tried || (added === 0 && refused === 0) ? [] : landed),
    ...(refused === 0 ? [] : [room]),
    ...problems,
  ];

  return {
    attached,
    message: messages.length === 0 ? null : messages.join(" "),
  };
};

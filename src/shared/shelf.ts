import { z } from "zod";

import {
  isAppLink,
  LINK_TEXT_MAX,
  LINK_URL_MAX,
  LINKS_MAX,
  linksInHtml,
} from "./web-source";

const LOWER_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** Attachments are named after a UUID the app generated, keeping a short lower-case extension. */
const ATTACHMENT_FILE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$/u;

/** Captures and pasted images are always stored as PNG. */
const IMAGE_FILE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/u;

const SECTION_HEADING = /^#\s+(?<name>\S.*)$/u;

export const TEXT_MAX = 20_000;
export const SECTION_NAME_MAX = 60;
export const DEFAULT_SECTION_NAME = "Inbox";

export const ItemIdSchema = z.string().regex(LOWER_UUID).brand<"ItemId">();

export type ItemId = z.output<typeof ItemIdSchema>;

export const SectionIdSchema = z
  .string()
  .regex(LOWER_UUID)
  .brand<"SectionId">();

export type SectionId = z.output<typeof SectionIdSchema>;

export const AttachmentFileSchema = z.string().regex(ATTACHMENT_FILE);

const Pixel = z.number().int().min(0).max(100_000);
const Extent = z.number().int().min(1).max(100_000);

export const PinSchema = z.object({ x: Pixel, y: Pixel });

export type Pin = z.output<typeof PinSchema>;

export const ImageFileSchema = z.string().regex(IMAGE_FILE);

export const ImageSchema = z.object({
  file: ImageFileSchema,
  heightPx: Extent,
  pixelsPerDip: z.number().positive().max(8),
  widthPx: Extent,
});

export type ShelfImage = z.output<typeof ImageSchema>;

const ItemBaseV1 = {
  createdAt: z.iso.datetime(),
  done: z.boolean(),
  id: ItemIdSchema,
  sectionId: SectionIdSchema,
};

/** Where an item came from: the app in front, its window title and, for a browser, the page. */
export const ContextSchema = z.object({
  app: z.string().max(200).nullable(),
  /**
   * Opens the item where it was in its desktop app: a ChatGPT or T3 Code
   * thread, a Claude chat, a Notion page. Only known app schemes.
   */
  appLink: z.string().refine(isAppLink).nullable().default(null),
  title: z.string().max(500).nullable(),
  url: z
    .url({ protocol: /^https?$/u })
    .max(2000)
    .nullable(),
});

export type ItemContext = z.output<typeof ContextSchema>;

export const COLORS = [
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "gray",
] as const;

export const ColorSchema = z.enum(COLORS);

export type ItemColor = z.output<typeof ColorSchema>;

const ItemBase = {
  ...ItemBaseV1,
  color: ColorSchema.nullable(),
  context: ContextSchema.nullable(),
};

/** Copied HTML larger than this is not kept; its links still are. */
export const HTML_MAX = 200_000;

export const LinkSchema = z.object({
  text: z.string().max(LINK_TEXT_MAX),
  url: z.url({ protocol: /^https?$/u }).max(LINK_URL_MAX),
});

const TextFields = {
  /**
   * The selection as the app copied it, put back next to the text when the
   * item is copied so links and formatting paste too. Never shown; dropped
   * once the text is edited.
   */
  html: z.string().max(HTML_MAX).nullable().default(null),
  kind: z.literal("text"),
  /** The web links in a copied selection, which the item lists when it is open. */
  links: z.array(LinkSchema).max(LINKS_MAX).default([]),
  text: z.string().min(1).max(TEXT_MAX),
  via: z.enum(["typed", "selection"]),
};

const ImageFields = {
  image: ImageSchema,
  kind: z.literal("image"),
  note: z.string().max(TEXT_MAX),
  /** Relative to the image; null when the area was dragged without a pin. */
  pin: PinSchema.nullable(),
  /** The display an area or pin was captured on. */
  source: z.string().max(200).nullable(),
  via: z.enum(["area", "pin", "paste", "drawing", "screenshot"]),
};

export const StoredFileSchema = z.object({
  bytes: z.number().int().min(0),
  /** The name the file had, used again when it is dragged or copied out. */
  name: z.string().min(1).max(255),
  stored: AttachmentFileSchema,
});

export type StoredFile = z.output<typeof StoredFileSchema>;

export const TextItemSchema = z.object({ ...ItemBase, ...TextFields });

export const ImageItemSchema = z.object({ ...ItemBase, ...ImageFields });

export const FileItemSchema = z.object({
  ...ItemBase,
  file: StoredFileSchema,
  kind: z.literal("file"),
  note: z.string().max(TEXT_MAX),
});

export const ItemSchema = z.discriminatedUnion("kind", [
  TextItemSchema,
  ImageItemSchema,
  FileItemSchema,
]);

export type ShelfItem = z.output<typeof ItemSchema>;

export type TextItem = z.output<typeof TextItemSchema>;

export type ImageItem = z.output<typeof ImageItemSchema>;

export type FileItem = z.output<typeof FileItemSchema>;

export const SectionSchema = z.object({
  id: SectionIdSchema,
  name: z.string().min(1).max(SECTION_NAME_MAX),
});

export type Section = z.output<typeof SectionSchema>;

interface ShelfReferences {
  readonly activeSectionId: SectionId;
  readonly sections: readonly { readonly id: SectionId }[];
  readonly items: readonly { readonly sectionId: SectionId }[];
}

const activeExists = (doc: ShelfReferences): boolean =>
  doc.sections.some((section) => section.id === doc.activeSectionId);

const itemsBelong = (doc: ShelfReferences): boolean => {
  const ids = new Set(doc.sections.map((section) => section.id));

  return doc.items.every((item) => ids.has(item.sectionId));
};

export const ShelfDocSchema = z
  .object({
    activeSectionId: SectionIdSchema,
    items: z.array(ItemSchema),
    schemaVersion: z.literal(2),
    sections: z.array(SectionSchema).min(1),
  })
  .refine(activeExists, "The active section must exist.")
  .refine(itemsBelong, "Every item must belong to a section.");

export type ShelfDoc = z.output<typeof ShelfDocSchema>;

/** The first shelf format: no source context, colours or files. */
const ShelfDocV1Schema = z
  .object({
    activeSectionId: SectionIdSchema,
    items: z.array(
      z.discriminatedUnion("kind", [
        z.object({ ...ItemBaseV1, ...TextFields }),
        z.object({
          ...ItemBaseV1,
          ...ImageFields,
          via: z.enum(["area", "pin", "paste"]),
        }),
      ])
    ),
    schemaVersion: z.literal(1),
    sections: z.array(SectionSchema).min(1),
  })
  .refine(activeExists)
  .refine(itemsBelong);

/** Text that holds valid JSON, parsed. */
const JsonTextSchema = z
  .string()
  .transform((text, ctx): z.core.util.JSONType => {
    try {
      return z.json().parse(JSON.parse(text));
    } catch {
      ctx.addIssue({ code: "custom", message: "not valid JSON" });

      return z.NEVER;
    }
  });

/** Reads a stored shelf in any known format, upgrading older ones; null when it is neither. */
export const parseShelfDocument = (raw: string): ShelfDoc | null => {
  const json = JsonTextSchema.safeParse(raw);

  if (!json.success) {
    return null;
  }

  const { data } = json;
  const current = ShelfDocSchema.safeParse(data);

  if (current.success) {
    return current.data;
  }

  const first = ShelfDocV1Schema.safeParse(data);

  return first.success
    ? {
        ...first.data,
        items: first.data.items.map((item) => ({
          ...item,
          color: null,
          context: null,
        })),
        schemaVersion: 2,
      }
    : null;
};

/** The stored file an item keeps next to the shelf, if any. */
export const attachmentOf = (item: ShelfItem): string | null => {
  if (item.kind === "image") {
    return item.image.file;
  }

  return item.kind === "file" ? item.file.stored : null;
};

export const emptyShelf = (sectionId: SectionId): ShelfDoc => ({
  activeSectionId: sectionId,
  items: [],
  schemaVersion: 2,
  sections: [{ id: sectionId, name: DEFAULT_SECTION_NAME }],
});

/** A composer line "# Name" makes a section; anything else is a note. */
export type ComposerEntry =
  | { readonly kind: "section"; readonly name: string }
  | { readonly kind: "note"; readonly text: string }
  | { readonly kind: "empty" };

export const parseComposer = (raw: string): ComposerEntry => {
  const text = raw.trim();

  if (text === "") {
    return { kind: "empty" };
  }

  const heading = text.includes("\n") ? null : SECTION_HEADING.exec(text);
  const name = heading?.groups?.name?.trim();

  return name === undefined
    ? { kind: "note", text }
    : { kind: "section", name: name.slice(0, SECTION_NAME_MAX) };
};

/** Operations the shelf window may request. Images are only added by the main process. */
export const ShelfOpSchema = z.discriminatedUnion("type", [
  z.object({ text: z.string().max(TEXT_MAX), type: z.literal("compose") }),
  z.object({
    id: ItemIdSchema,
    text: z.string().min(1).max(TEXT_MAX),
    type: z.literal("editText"),
  }),
  z.object({
    id: ItemIdSchema,
    note: z.string().max(TEXT_MAX),
    type: z.literal("editNote"),
  }),
  z.object({ id: ItemIdSchema, type: z.literal("toggleDone") }),
  z.object({ id: ItemIdSchema, type: z.literal("remove") }),
  /** Puts back a deleted item: the one asked for, else the last one deleted. */
  z.object({ id: ItemIdSchema.optional(), type: z.literal("undoRemove") }),
  z.object({ id: SectionIdSchema, type: z.literal("selectSection") }),
  /** Makes a section, or picks the one with that name, for new items. */
  z.object({
    name: z.string().min(1).max(SECTION_NAME_MAX),
    type: z.literal("addSection"),
  }),
  z.object({
    id: SectionIdSchema,
    name: z.string().min(1).max(SECTION_NAME_MAX),
    type: z.literal("renameSection"),
  }),
  /** Deletes a section with its items; the last section stays. */
  z.object({ id: SectionIdSchema, type: z.literal("removeSection") }),
  z.object({
    id: ItemIdSchema,
    sectionId: SectionIdSchema,
    type: z.literal("moveItem"),
  }),
  z.object({
    color: ColorSchema.nullable(),
    id: ItemIdSchema,
    type: z.literal("setColor"),
  }),
  /** Deletes the checked items of a section, the active one when none is given. */
  z.object({
    sectionId: SectionIdSchema.optional(),
    type: z.literal("clearDone"),
  }),
]);

export type ShelfOp = z.output<typeof ShelfOpSchema>;

export type MainOp =
  | {
      readonly type: "addText";
      readonly text: string;
      /** The HTML copied with a selection, if the app put any on the clipboard. */
      readonly html: string | null;
      readonly via: TextItem["via"];
      readonly context: ItemContext | null;
    }
  | {
      readonly type: "addImage";
      readonly image: ShelfImage;
      readonly pin: Pin | null;
      readonly source: string | null;
      readonly via: ImageItem["via"];
      readonly context: ItemContext | null;
    }
  | {
      readonly type: "addFile";
      readonly file: StoredFile;
      readonly context: ItemContext | null;
    }
  /** An annotated image takes the place of the old one; the old file goes once this is saved. */
  | {
      readonly type: "replaceImage";
      readonly id: ItemId;
      readonly image: ShelfImage;
    };

export interface OpEnv {
  readonly newItemId: () => ItemId;
  readonly newSectionId: () => SectionId;
  readonly now: () => Date;
}

/** How many deleted items can still be put back; the oldest beyond it goes for good. */
export const UNDO_MAX = 10;

/** A removed item and where it stood, so an undo can put it back. */
export interface Removed {
  readonly item: ShelfItem;
  readonly index: number;
}

export interface OpResult {
  readonly doc: ShelfDoc;
  /** The item this operation created, if any. */
  readonly addedId: ItemId | null;
  /** Items gone for good: their attachments can be deleted. */
  readonly discarded: readonly ShelfItem[];
  readonly removed: Removed | null;
}

const unchanged = (doc: ShelfDoc): OpResult => ({
  addedId: null,
  discarded: [],
  doc,
  removed: null,
});

const changed = (doc: ShelfDoc): OpResult => ({ ...unchanged(doc) });

const mapItem = (
  doc: ShelfDoc,
  id: ItemId,
  update: (item: ShelfItem) => ShelfItem | null
): ShelfDoc => ({
  ...doc,
  items: doc.items.map((item) =>
    item.id === id ? (update(item) ?? item) : item
  ),
});

const addItem = (doc: ShelfDoc, item: ShelfItem): OpResult => ({
  addedId: item.id,
  discarded: [],
  doc: { ...doc, items: [...doc.items, item] },
  removed: null,
});

const sectionNamed = (doc: ShelfDoc, name: string): Section | undefined =>
  doc.sections.find(
    (section) => section.name.toLowerCase() === name.toLowerCase()
  );

/** New items go to the section with this name, made at the end if there is none. */
const addSection = (doc: ShelfDoc, raw: string, env: OpEnv): OpResult => {
  const name = raw.trim().slice(0, SECTION_NAME_MAX);

  if (name === "") {
    return unchanged(doc);
  }

  const existing = sectionNamed(doc, name);

  if (existing !== undefined) {
    return changed({ ...doc, activeSectionId: existing.id });
  }

  const section: Section = { id: env.newSectionId(), name };

  return changed({
    ...doc,
    activeSectionId: section.id,
    sections: [...doc.sections, section],
  });
};

/** A section takes a new name, unless another section already has it. */
const renameSection = (doc: ShelfDoc, id: SectionId, raw: string): OpResult => {
  const name = raw.trim().slice(0, SECTION_NAME_MAX);
  const taken = sectionNamed(doc, name);

  if (name === "" || (taken !== undefined && taken.id !== id)) {
    return unchanged(doc);
  }

  return changed({
    ...doc,
    sections: doc.sections.map((section) =>
      section.id === id ? { ...section, name } : section
    ),
  });
};

/** Deletes a section and its items for good; new items then go to the first section left. */
const removeSection = (doc: ShelfDoc, id: SectionId): OpResult => {
  const sections = doc.sections.filter((section) => section.id !== id);
  const [first] = sections;

  if (first === undefined || sections.length === doc.sections.length) {
    return unchanged(doc);
  }

  const discarded = doc.items.filter((item) => item.sectionId === id);

  return {
    addedId: null,
    discarded,
    doc: {
      ...doc,
      activeSectionId:
        doc.activeSectionId === id ? first.id : doc.activeSectionId,
      items: doc.items.filter((item) => item.sectionId !== id),
      sections,
    },
    removed: null,
  };
};

const compose = (doc: ShelfDoc, raw: string, env: OpEnv): OpResult => {
  const entry = parseComposer(raw);

  if (entry.kind === "empty") {
    return unchanged(doc);
  }

  if (entry.kind === "note") {
    return addItem(doc, {
      color: null,
      context: null,
      createdAt: env.now().toISOString(),
      done: false,
      html: null,
      id: env.newItemId(),
      kind: "text",
      links: [],
      sectionId: doc.activeSectionId,
      text: entry.text,
      via: "typed",
    });
  }

  return addSection(doc, entry.name, env);
};

const remove = (doc: ShelfDoc, id: ItemId): OpResult => {
  const index = doc.items.findIndex((item) => item.id === id);
  const item = doc.items[index];

  if (item === undefined) {
    return unchanged(doc);
  }

  return {
    addedId: null,
    discarded: [],
    doc: { ...doc, items: doc.items.filter((other) => other.id !== id) },
    removed: { index, item },
  };
};

const restore = (doc: ShelfDoc, removed: Removed | null): OpResult => {
  if (
    removed === null ||
    !doc.sections.some((section) => section.id === removed.item.sectionId)
  ) {
    return unchanged(doc);
  }

  const items = [...doc.items];

  items.splice(Math.min(removed.index, items.length), 0, removed.item);

  return changed({ ...doc, items });
};

const moveItem = (
  doc: ShelfDoc,
  id: ItemId,
  sectionId: SectionId
): OpResult => {
  if (!doc.sections.some((section) => section.id === sectionId)) {
    return unchanged(doc);
  }

  // Moved to the end of its new section, as if it had just been added there.
  const item = doc.items.find((candidate) => candidate.id === id);

  return item === undefined || item.sectionId === sectionId
    ? unchanged(doc)
    : changed({
        ...doc,
        items: [
          ...doc.items.filter((candidate) => candidate.id !== id),
          { ...item, sectionId },
        ],
      });
};

/** The item keeps its place, note, pin and source; only its picture changes. */
const replaceImage = (
  doc: ShelfDoc,
  id: ItemId,
  image: ShelfImage
): OpResult => {
  const item = doc.items.find((candidate) => candidate.id === id);

  if (item?.kind !== "image" || item.image.file === image.file) {
    return unchanged(doc);
  }

  return {
    ...changed(mapItem(doc, id, () => ({ ...item, image }))),
    discarded: [item],
  };
};

/** A selection or other text from main; blank text adds nothing. */
const addText = (
  doc: ShelfDoc,
  op: Extract<MainOp, { readonly type: "addText" }>,
  env: OpEnv
): OpResult => {
  if (op.text.trim() === "") {
    return unchanged(doc);
  }

  return addItem(doc, {
    color: null,
    context: op.context,
    createdAt: env.now().toISOString(),
    done: false,
    html: op.html !== null && op.html.length <= HTML_MAX ? op.html : null,
    id: env.newItemId(),
    kind: "text",
    // Only links the stored shelf accepts, so one odd link never makes it unreadable.
    links:
      op.html === null
        ? []
        : linksInHtml(op.html).filter(
            (link) => LinkSchema.safeParse(link).success
          ),
    sectionId: doc.activeSectionId,
    text: op.text.slice(0, TEXT_MAX),
    via: op.via,
  });
};

/** Deletes a section's checked items for good. */
const clearDone = (doc: ShelfDoc, sectionId: SectionId): OpResult => {
  const discarded = doc.items.filter(
    (item) => item.done && item.sectionId === sectionId
  );

  return {
    addedId: null,
    discarded,
    doc: {
      ...doc,
      items: doc.items.filter((item) => !discarded.includes(item)),
    },
    removed: null,
  };
};

/** A delete that can be undone; past UNDO_MAX the oldest pending one goes for good. */
const removeUndoably = (
  doc: ShelfDoc,
  id: ItemId,
  pending: readonly Removed[]
): OpResult => {
  const result = remove(doc, id);
  const [oldest] = pending;

  return oldest === undefined ||
    pending.length < UNDO_MAX ||
    result.removed === null
    ? result
    : { ...result, discarded: [oldest.item] };
};

/** The deletion an undo puts back: the one asked for, else the last. */
const pendingFor = (
  pending: readonly Removed[],
  id: ItemId | undefined
): Removed | null =>
  (id === undefined
    ? pending.at(-1)
    : pending.find((removed) => removed.item.id === id)) ?? null;

type SectionOp = Extract<
  ShelfOp,
  {
    readonly type:
      | "selectSection"
      | "addSection"
      | "renameSection"
      | "removeSection";
  }
>;

const SECTION_OPS: ReadonlySet<string> = new Set([
  "selectSection",
  "addSection",
  "renameSection",
  "removeSection",
]);

const isSectionOp = (op: ShelfOp | MainOp): op is SectionOp =>
  SECTION_OPS.has(op.type);

/** The operations on sections themselves: which takes new items, their names, deleting one. */
const applySectionOp = (doc: ShelfDoc, op: SectionOp, env: OpEnv): OpResult => {
  switch (op.type) {
    case "selectSection": {
      return doc.sections.some((section) => section.id === op.id)
        ? changed({ ...doc, activeSectionId: op.id })
        : unchanged(doc);
    }

    case "addSection": {
      return addSection(doc, op.name, env);
    }

    case "renameSection": {
      return renameSection(doc, op.id, op.name);
    }

    case "removeSection": {
      return removeSection(doc, op.id);
    }

    default: {
      return unchanged(doc);
    }
  }
};

/**
 * Applies one operation. `pending` holds the deleted items that can still be
 * put back, oldest first; a delete past UNDO_MAX discards the oldest for good.
 */
export const applyOp = (
  doc: ShelfDoc,
  op: ShelfOp | MainOp,
  env: OpEnv,
  pending: readonly Removed[]
): OpResult => {
  if (isSectionOp(op)) {
    return applySectionOp(doc, op, env);
  }

  switch (op.type) {
    case "compose": {
      return compose(doc, op.text, env);
    }

    case "addText": {
      return addText(doc, op, env);
    }

    case "addImage": {
      return addItem(doc, {
        color: null,
        context: op.context,
        createdAt: env.now().toISOString(),
        done: false,
        id: env.newItemId(),
        image: op.image,
        kind: "image",
        note: "",
        pin: op.pin,
        sectionId: doc.activeSectionId,
        source: op.source,
        via: op.via,
      });
    }

    case "addFile": {
      return addItem(doc, {
        color: null,
        context: op.context,
        createdAt: env.now().toISOString(),
        done: false,
        file: op.file,
        id: env.newItemId(),
        kind: "file",
        note: "",
        sectionId: doc.activeSectionId,
      });
    }

    case "editText": {
      return changed(
        mapItem(doc, op.id, (item) =>
          item.kind === "text" ? { ...item, html: null, text: op.text } : null
        )
      );
    }

    case "editNote": {
      return changed(
        mapItem(doc, op.id, (item) =>
          item.kind === "text" ? null : { ...item, note: op.note }
        )
      );
    }

    case "replaceImage": {
      return replaceImage(doc, op.id, op.image);
    }

    case "toggleDone": {
      return changed(
        mapItem(doc, op.id, (item) => ({ ...item, done: !item.done }))
      );
    }

    case "remove": {
      return removeUndoably(doc, op.id, pending);
    }

    case "undoRemove": {
      return restore(doc, pendingFor(pending, op.id));
    }

    case "setColor": {
      return changed(
        mapItem(doc, op.id, (item) => ({ ...item, color: op.color }))
      );
    }

    case "moveItem": {
      return moveItem(doc, op.id, op.sectionId);
    }

    case "clearDone": {
      return clearDone(doc, op.sectionId ?? doc.activeSectionId);
    }

    default: {
      return unchanged(doc);
    }
  }
};

export const itemsInSection = (
  doc: ShelfDoc,
  sectionId: SectionId
): readonly ShelfItem[] =>
  doc.items.filter((item) => item.sectionId === sectionId);

export interface ItemGroup {
  readonly section: Section;
  readonly active: boolean;
  readonly items: readonly ShelfItem[];
}

const SEARCH_TERM = /\s+/u;

const KIND_TEXT: Record<ShelfItem["kind"], (item: ShelfItem) => string> = {
  file: (item) =>
    item.kind === "file" ? `${item.file.name} ${item.note}` : "",
  image: (item) =>
    item.kind === "image" ? `${item.note} ${item.source ?? ""}` : "",
  text: (item) => (item.kind === "text" ? item.text : ""),
};

/** Everything a search looks at: the item's words and where it came from. */
const searchableText = (item: ShelfItem): string =>
  [
    KIND_TEXT[item.kind](item),
    item.context?.app ?? "",
    item.context?.title ?? "",
    item.context?.url ?? "",
  ].join(" ");

/**
 * The shelf as one list grouped by section, in section order. Without a query
 * every section shows, empty ones too. With a query only matching items show,
 * and sections without a match are left out.
 */
export const groupItems = (
  doc: ShelfDoc,
  query: string
): readonly ItemGroup[] => {
  const terms = query.toLocaleLowerCase().split(SEARCH_TERM).filter(Boolean);

  const matches = (item: ShelfItem): boolean => {
    const text = searchableText(item).toLocaleLowerCase();

    return terms.every((term) => text.includes(term));
  };

  return doc.sections.flatMap((section) => {
    const active = section.id === doc.activeSectionId;

    const items = doc.items.filter(
      (item) => item.sectionId === section.id && matches(item)
    );

    const shown = items.length > 0 || terms.length === 0;

    return shown ? [{ active, items, section }] : [];
  });
};

/** The words an item stands for when it is copied as text. */
export const itemText = (item: ShelfItem): string => {
  if (item.kind === "text") {
    return item.text;
  }

  if (item.kind === "file") {
    return item.note.trim() === "" ? item.file.name : item.note;
  }

  return item.note.trim() === "" ? "Image" : item.note;
};

/** An item's words followed by the page it came from, for pasting where the link matters. */
export const itemTextWithLink = (item: ShelfItem): string =>
  item.context?.url === null || item.context === null
    ? itemText(item)
    : `${itemText(item)}\n${item.context.url}`;

/** The words an item adds to a list: images and files only when they have a note or a name. */
const listText = (item: ShelfItem): string | null => {
  if (item.kind === "image") {
    return item.note.trim() === "" ? null : item.note.trim();
  }

  return itemText(item).trim();
};

const HTML_ESCAPES = {
  '"': "&quot;",
  "&": "&amp;",
  "'": "&#39;",
  "<": "&lt;",
  ">": "&gt;",
} as const;

const isEscaped = (char: string): char is keyof typeof HTML_ESCAPES =>
  Object.hasOwn(HTML_ESCAPES, char);

const escapeHtml = (text: string): string =>
  text.replaceAll(/["&'<>]/gu, (char) =>
    isEscaped(char) ? HTML_ESCAPES[char] : char
  );

export interface ItemList {
  /** "1. First" with following lines indented under the number, and each page link in brackets. */
  readonly text: string;
  /** The same as an ordered list, for apps that paste formatting. */
  readonly html: string;
  /** How many items the list holds. */
  readonly count: number;
}

/**
 * Items as a numbered list, in the order given, each with its page link.
 * Images without a note add no line; they travel as the image itself.
 */
export const itemsAsList = (items: readonly ShelfItem[]): ItemList => {
  const entries = items.flatMap((item) => {
    const text = listText(item);

    return text === null || text === ""
      ? []
      : [{ text, url: item.context?.url ?? null }];
  });

  const lines = entries.map(({ text, url }, index) => {
    const marker = `${index + 1}. `;
    const [first = "", ...rest] = text.split("\n");
    const indent = " ".repeat(marker.length);
    const link = url === null ? "" : ` (${url})`;

    return [
      `${marker}${first}${link}`,
      ...rest.map((line) => `${indent}${line}`),
    ].join("\n");
  });

  const html = entries
    .map(({ text, url }) => {
      const body = escapeHtml(text).replaceAll("\n", "<br>");

      const link =
        url === null
          ? ""
          : ` (<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>)`;

      return `<li>${body}${link}</li>`;
    })
    .join("");

  return {
    count: entries.length,
    html: entries.length === 0 ? "" : `<ol>${html}</ol>`,
    text: lines.join("\n"),
  };
};

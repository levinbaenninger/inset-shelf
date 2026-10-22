import { z } from "zod";

const LOWER_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** An attachment is always a PNG named after a UUID the app generated. */
const ATTACHMENT_FILE =
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

export const ImageSchema = z.object({
  file: AttachmentFileSchema,
  heightPx: Extent,
  pixelsPerDip: z.number().positive().max(8),
  widthPx: Extent,
});

export type ShelfImage = z.output<typeof ImageSchema>;

const ItemBase = {
  createdAt: z.iso.datetime(),
  done: z.boolean(),
  id: ItemIdSchema,
  sectionId: SectionIdSchema,
};

export const TextItemSchema = z.object({
  ...ItemBase,
  kind: z.literal("text"),
  text: z.string().min(1).max(TEXT_MAX),
  via: z.enum(["typed", "selection"]),
});

export const ImageItemSchema = z.object({
  ...ItemBase,
  image: ImageSchema,
  kind: z.literal("image"),
  note: z.string().max(TEXT_MAX),
  /** Relative to the image; null when the area was dragged without a pin. */
  pin: PinSchema.nullable(),
  source: z.string().max(200).nullable(),
  via: z.enum(["area", "pin", "paste"]),
});

export const ItemSchema = z.discriminatedUnion("kind", [
  TextItemSchema,
  ImageItemSchema,
]);

export type ShelfItem = z.output<typeof ItemSchema>;

export type TextItem = z.output<typeof TextItemSchema>;

export type ImageItem = z.output<typeof ImageItemSchema>;

export const SectionSchema = z.object({
  id: SectionIdSchema,
  name: z.string().min(1).max(SECTION_NAME_MAX),
});

export type Section = z.output<typeof SectionSchema>;

export const ShelfDocSchema = z
  .object({
    activeSectionId: SectionIdSchema,
    items: z.array(ItemSchema),
    schemaVersion: z.literal(1),
    sections: z.array(SectionSchema).min(1),
  })
  .refine(
    (doc) => doc.sections.some((section) => section.id === doc.activeSectionId),
    "The active section must exist."
  )
  .refine((doc) => {
    const ids = new Set(doc.sections.map((section) => section.id));

    return doc.items.every((item) => ids.has(item.sectionId));
  }, "Every item must belong to a section.");

export type ShelfDoc = z.output<typeof ShelfDocSchema>;

export const emptyShelf = (sectionId: SectionId): ShelfDoc => ({
  activeSectionId: sectionId,
  items: [],
  schemaVersion: 1,
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
  z.object({ type: z.literal("undoRemove") }),
  z.object({ id: SectionIdSchema, type: z.literal("selectSection") }),
  z.object({ type: z.literal("clearDone") }),
]);

export type ShelfOp = z.output<typeof ShelfOpSchema>;

export type MainOp =
  | {
      readonly type: "addText";
      readonly text: string;
      readonly via: TextItem["via"];
    }
  | {
      readonly type: "addImage";
      readonly image: ShelfImage;
      readonly pin: Pin | null;
      readonly source: string | null;
      readonly via: ImageItem["via"];
    };

export interface OpEnv {
  readonly newItemId: () => ItemId;
  readonly newSectionId: () => SectionId;
  readonly now: () => Date;
}

/** A removed item and where it stood, so one undo can put it back. */
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

const compose = (doc: ShelfDoc, raw: string, env: OpEnv): OpResult => {
  const entry = parseComposer(raw);

  if (entry.kind === "empty") {
    return unchanged(doc);
  }

  if (entry.kind === "note") {
    return addItem(doc, {
      createdAt: env.now().toISOString(),
      done: false,
      id: env.newItemId(),
      kind: "text",
      sectionId: doc.activeSectionId,
      text: entry.text,
      via: "typed",
    });
  }

  const existing = doc.sections.find(
    (section) => section.name.toLowerCase() === entry.name.toLowerCase()
  );

  if (existing !== undefined) {
    return changed({ ...doc, activeSectionId: existing.id });
  }

  const section: Section = { id: env.newSectionId(), name: entry.name };

  return changed({
    ...doc,
    activeSectionId: section.id,
    sections: [...doc.sections, section],
  });
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

/**
 * Applies one operation. `lastRemoved` is the pending undo; it stays undoable
 * until the next remove, which discards it for good.
 */
export const applyOp = (
  doc: ShelfDoc,
  op: ShelfOp | MainOp,
  env: OpEnv,
  lastRemoved: Removed | null
): OpResult => {
  switch (op.type) {
    case "compose": {
      return compose(doc, op.text, env);
    }

    case "addText": {
      return op.text.trim() === ""
        ? unchanged(doc)
        : addItem(doc, {
            createdAt: env.now().toISOString(),
            done: false,
            id: env.newItemId(),
            kind: "text",
            sectionId: doc.activeSectionId,
            text: op.text.slice(0, TEXT_MAX),
            via: op.via,
          });
    }

    case "addImage": {
      return addItem(doc, {
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

    case "editText": {
      return changed(
        mapItem(doc, op.id, (item) =>
          item.kind === "text" ? { ...item, text: op.text } : null
        )
      );
    }

    case "editNote": {
      return changed(
        mapItem(doc, op.id, (item) =>
          item.kind === "image" ? { ...item, note: op.note } : null
        )
      );
    }

    case "toggleDone": {
      return changed(
        mapItem(doc, op.id, (item) => ({ ...item, done: !item.done }))
      );
    }

    case "remove": {
      const result = remove(doc, op.id);

      return lastRemoved === null || result.removed === null
        ? result
        : { ...result, discarded: [lastRemoved.item] };
    }

    case "undoRemove": {
      return restore(doc, lastRemoved);
    }

    case "selectSection": {
      return doc.sections.some((section) => section.id === op.id)
        ? changed({ ...doc, activeSectionId: op.id })
        : unchanged(doc);
    }

    case "clearDone": {
      const discarded = doc.items.filter(
        (item) => item.done && item.sectionId === doc.activeSectionId
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

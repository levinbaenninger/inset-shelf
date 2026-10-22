import { z } from "zod";

import { defineContract, event, invoke, out, send } from "./ipc";
import { SettingsSchema } from "./settings";
import type { SettingsView } from "./settings";
import { ItemIdSchema, ShelfOpSchema } from "./shelf";
import type { ItemId, ShelfDoc } from "./shelf";

export type Permission = "granted" | "missing" | "notNeeded";

export interface ShelfStatus {
  /** Double Shift needs Accessibility on macOS; elsewhere it works without a grant. */
  readonly keys: Permission;
  /** Copying the selection is macOS-only for now; Windows terminals treat Ctrl+C as an interrupt. */
  readonly selectionCapture: boolean;
  /** The last write failed; the shelf keeps working in memory. */
  readonly saveError: string | null;
  /** A capture or paste could not be completed. */
  readonly problem: string | null;
}

export interface ShelfView {
  readonly doc: ShelfDoc;
  readonly status: ShelfStatus;
  /** The item to select and scroll to, set by a capture. Changes with every capture. */
  readonly focus: { readonly id: ItemId; readonly seq: number } | null;
  /** An item can be restored with undoRemove. */
  readonly canUndo: boolean;
}

/** Menu choices the shelf window carries out itself, so its own state (editing, undo) stays in one place. */
export type ShelfCommand =
  | { readonly kind: "edit"; readonly id: ItemId }
  | { readonly kind: "remove"; readonly id: ItemId }
  | { readonly kind: "newSection" }
  | { readonly kind: "newNote" }
  | { readonly kind: "find" }
  /** Edit › Copy and Undo: a text field keeps its own, otherwise they act on items. */
  | { readonly kind: "copy" }
  | { readonly kind: "undo" };

const MenuPoint = z.object({
  x: z.number().min(0).max(10_000),
  y: z.number().min(0).max(10_000),
});

export type ActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

const PASTE_MAX_BYTES = 30 * 1024 * 1024;

export const shelfContract = defineContract({
  events: { command: event<ShelfCommand>(), view: event<ShelfView>() },
  global: "insetShelf",
  methods: {
    /** Files dropped or pasted into the shelf, by path; main reads them. */
    addFiles: invoke(
      z.array(z.string().min(1).max(4096)).min(1).max(50),
      out<ActionResult>()
    ),
    apply: send(ShelfOpSchema),
    captureArea: send(z.void()),
    copy: invoke(ItemIdSchema, out<ActionResult>()),
    dismissProblem: send(z.void()),
    getView: invoke(z.void(), out<ShelfView>()),
    hide: send(z.void()),
    /** Copy and Undo inside a text field, done by the window's own edit commands. */
    nativeEdit: send(z.enum(["copy", "undo"])),
    openKeySettings: send(z.void()),
    /** Opens the page an item was captured from; main checks it is http or https. */
    openLink: send(ItemIdSchema),
    /** The "+" in the note field: ways to add something other than typing. */
    showAddMenu: send(MenuPoint),
    showItemMenu: send(MenuPoint.extend({ id: ItemIdSchema })),
    showSectionMenu: send(MenuPoint),
    pasteImage: invoke(
      z
        .instanceof(Uint8Array)
        .refine((bytes) => bytes.byteLength <= PASTE_MAX_BYTES),
      out<ActionResult>()
    ),
    startDrag: send(ItemIdSchema),
  },
  name: "shelf",
});

export interface OverlayView {
  readonly frameUrl: string;
  readonly display: { readonly width: number; readonly height: number };
}

const Dip = z.number().min(-100_000).max(100_000);

export const OverlayCommitSchema = z.discriminatedUnion("kind", [
  z.object({
    area: z.object({
      height: z.number().min(0).max(100_000),
      width: z.number().min(0).max(100_000),
      x: Dip,
      y: Dip,
    }),
    kind: z.literal("area"),
  }),
  z.object({ kind: z.literal("pin"), point: z.object({ x: Dip, y: Dip }) }),
]);

export type OverlayCommit = z.output<typeof OverlayCommitSchema>;

export const overlayContract = defineContract({
  events: { view: event<OverlayView | null>() },
  global: "insetOverlay",
  methods: {
    cancel: send(z.void()),
    commit: send(OverlayCommitSchema),
    getView: invoke(z.void(), out<OverlayView | null>()),
  },
  name: "overlay",
});

export interface ToastView {
  readonly title: string;
  readonly detail: string;
  readonly seq: number;
}

export const toastContract = defineContract({
  events: { view: event<ToastView>() },
  global: "insetToast",
  methods: {
    getView: invoke(z.void(), out<ToastView | null>()),
  },
  name: "toast",
});

const DRAWING_MAX_BYTES = 30 * 1024 * 1024;

/** The drawing window: a blank canvas that saves one PNG to the shelf. */
export const drawingContract = defineContract({
  events: {
    /** Undo and Redo from the menu bar, which takes ⌘Z before the page sees it. */
    edit: event<"undo" | "redo">(),
    reset: event<null>(),
  },
  global: "insetDrawing",
  methods: {
    cancel: send(z.void()),
    save: invoke(
      z.object({
        /** Also put the drawing on the clipboard, for pasting into a prompt. */
        copy: z.boolean(),
        png: z
          .instanceof(Uint8Array)
          .refine((bytes) => bytes.byteLength <= DRAWING_MAX_BYTES),
      }),
      out<ActionResult>()
    ),
  },
  name: "drawing",
});

export type DrawingContract = typeof drawingContract;

export const settingsContract = defineContract({
  events: { view: event<SettingsView>() },
  global: "insetSettings",
  methods: {
    getView: invoke(z.void(), out<SettingsView>()),
    setOpenAtLogin: send(z.boolean()),
    update: send(SettingsSchema.partial()),
  },
  name: "settings",
});

export type SettingsContract = typeof settingsContract;

export type ShelfContract = typeof shelfContract;

export type OverlayContract = typeof overlayContract;

export type ToastContract = typeof toastContract;

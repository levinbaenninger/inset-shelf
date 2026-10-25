import { z } from "zod";

import { defineContract, event, invoke, out, send } from "./ipc";
import { SettingsSchema } from "./settings";
import type { SettingsView } from "./settings";
import { ItemIdSchema, ShelfOpSchema } from "./shelf";
import type { ItemId, Pin, ShelfDoc } from "./shelf";

export type Permission = "granted" | "missing" | "notNeeded";

export interface ShelfStatus {
  /** Double Shift needs Accessibility on macOS; elsewhere it works without a grant. */
  readonly keys: Permission;
  /** Copying the selection works on macOS and Windows; elsewhere double Shift only toggles the shelf. */
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

/** App-menu choices the shelf window carries out itself, so its own state (editing, undo) stays in one place. */
/** What the menu bar's Item menu asks of the selected item. */
export type ItemAction =
  | "copyList"
  | "copyWithLink"
  | "open"
  | "edit"
  | "toggleDone"
  | "previousSection"
  | "nextSection"
  | "remove";

export type ShelfCommand =
  | { readonly kind: "newSection" }
  | { readonly kind: "item"; readonly action: ItemAction }
  /** Edit › Redo, which a note field takes from its own history. */
  | { readonly kind: "redo" }
  /** Edit › Select All: a text field selects its text, the list all its items. */
  | { readonly kind: "selectAll" }
  /** Edit › Clear Checked Items: the shelf asks first. */
  | { readonly kind: "clearDone" }
  | { readonly kind: "newNote" }
  | { readonly kind: "find" }
  /** Edit › Copy and Undo: a text field keeps its own, otherwise they act on items. */
  | { readonly kind: "copy" }
  | { readonly kind: "undo" };

export type ActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

const PASTE_MAX_BYTES = 30 * 1024 * 1024;

export const shelfContract = defineContract({
  events: {
    command: event<ShelfCommand>(),
    /** A short confirmation of something main did, shown as a toast. */
    notice: event<{ readonly message: string }>(),
    view: event<ShelfView>(),
  },
  global: "insetShelf",
  methods: {
    /** Files dropped or pasted into the shelf, by path; main reads them. */
    addFiles: invoke(
      z.array(z.string().min(1).max(4096)).min(1).max(50),
      out<ActionResult>()
    ),
    apply: send(ShelfOpSchema),
    /** The file dialog, from the "+" in the note field. */
    attachFiles: send(z.void()),
    copy: invoke(ItemIdSchema, out<ActionResult>()),
    /** Items as one numbered list, in the order given, with the first image beside it. */
    copyList: invoke(
      z.array(ItemIdSchema).min(1).max(1000),
      out<ActionResult>()
    ),
    /** The item's words and the page it came from, as text. */
    copyWithLink: send(ItemIdSchema),
    dismissProblem: send(z.void()),
    getView: invoke(z.void(), out<ShelfView>()),
    hide: send(z.void()),
    /** Copy and Undo inside a text field, done by the window's own edit commands. */
    nativeEdit: send(z.enum(["copy", "undo", "redo", "selectAll"])),
    newDrawing: send(z.void()),
    /** Shows an image large in the drawing window, to look at or draw on. */
    openImage: send(ItemIdSchema),
    openKeySettings: send(z.void()),
    /**
     * Opens the page an item was captured from, or one of the links in it;
     * main opens only an address the item holds, over http or https.
     */
    openLink: send(
      z.object({ id: ItemIdSchema, url: z.string().max(2000).optional() })
    ),
    openSettings: send(z.void()),
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

/** A new screenshot on its card beside the shelf. */
export interface ScreenshotView {
  /** Changes with every screenshot; actions name it, so they never reach a newer one. */
  readonly seq: number;
  readonly imageUrl: string;
  readonly widthPx: number;
  readonly heightPx: number;
}

const Seq = z.number().int().min(0);

export const screenshotContract = defineContract({
  events: { view: event<ScreenshotView | null>() },
  global: "insetScreenshot",
  methods: {
    addToShelf: send(Seq),
    /** Adds it to the shelf and opens it to draw on. */
    annotate: send(Seq),
    copy: send(Seq),
    dismiss: send(Seq),
    getView: invoke(z.void(), out<ScreenshotView | null>()),
    /** Keeps the card on screen until it is used or dismissed. */
    hold: send(Seq),
    /** The pointer is on the card, which then stays. */
    hover: send(z.boolean()),
    /** Saves it as a PNG in the Downloads folder. */
    saveToDownloads: send(Seq),
    /** Drags the screenshot out as a file. */
    startDrag: send(Seq),
  },
  name: "screenshot",
});

const DRAWING_MAX_BYTES = 30 * 1024 * 1024;

/** An image item opened in the drawing window, to look at large or draw on. */
export interface DrawingImage {
  /** For showing it; the pixels for the saved copy come from getImage. */
  readonly url: string;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly pixelsPerDip: number;
  /** Shown over the image as in the shelf; it is drawn into copies, not into the saved image. */
  readonly pin: Pin | null;
}

export interface DrawingView {
  /** Changes with every opening, so the page starts over. */
  readonly seq: number;
  /** Null for a new drawing on a blank page. */
  readonly image: DrawingImage | null;
}

/** The drawing window: a blank canvas that saves one PNG to the shelf, or an image item drawn on. */
export const drawingContract = defineContract({
  events: {
    /** The window is closing with marks on the page: the page asks before throwing them away. */
    confirmClose: event<null>(),
    /** Undo and Redo from the menu bar, which takes ⌘Z before the page sees it. */
    edit: event<"undo" | "redo">(),
    view: event<DrawingView>(),
  },
  global: "insetDrawing",
  methods: {
    cancel: send(z.void()),
    /** The open image's PNG, so the page can draw the marks into it without a cross-origin canvas. */
    getImage: invoke(z.void(), out<Uint8Array | null>()),
    getView: invoke(z.void(), out<DrawingView>()),
    /** Whether the page has marks, so closing it asks before throwing them away. */
    setDirty: send(z.boolean()),
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
    /** The page's height, so the window fits it without empty space. */
    fitHeight: send(z.number().int().min(120).max(1200)),
    setOpenAtLogin: send(z.boolean()),
    update: send(SettingsSchema.partial()),
  },
  name: "settings",
});

export type SettingsContract = typeof settingsContract;

export type ShelfContract = typeof shelfContract;

export type ToastContract = typeof toastContract;

export type ScreenshotContract = typeof screenshotContract;

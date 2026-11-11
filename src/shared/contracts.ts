import { z } from "zod";

import { StrokeMarksSchema } from "./drawing-scene";
import type { DrawingMark } from "./drawing-scene";
import { defineContract, event, invoke, out, send } from "./ipc";
import { HandOffChoiceSchema, PermissionIdSchema } from "./onboarding";
import type { OnboardingView } from "./onboarding";
import { SettingsSchema } from "./settings";
import type { SettingsView } from "./settings";
import {
  ItemIdSchema,
  PinsSchema,
  ShelfOpSchema,
  WindowIdSchema,
} from "./shelf";
import type { ItemId, ShelfDoc } from "./shelf";
import { TutorialActionSchema } from "./tutorial";
import type { TutorialView } from "./tutorial";

export type Permission = "granted" | "missing" | "notNeeded";

export interface ShelfStatus {
  /** Double Shift needs Accessibility on macOS; elsewhere it works without a grant. */
  readonly keys: Permission;
  /** Copying the selection works on macOS and Windows; elsewhere double Shift only toggles the shelf. */
  readonly selectionCapture: boolean;
  /** The last write failed; the shelf keeps every change in memory and saves it on the next change, copy or Retry. */
  readonly saveError: string | null;
  /** The shelf file could not be read or set aside at launch, so this session saves nothing and there is nothing to retry. */
  readonly readOnly: boolean;
  /** A capture or paste could not be completed. */
  readonly problem: string | null;
  /** The shelf floats above other windows; Window › Float on Top, or the shelf's ⋯ on Windows. */
  readonly floatOnTop: boolean;
  /** A quit is held because changes couldn't reach the disk; the shelf asks what to do. */
  readonly quitPrompt: QuitPrompt | null;
}

/** "retrying" while Retry saves; "stillFailing" once a Retry has failed. */
export type QuitPromptState = "asking" | "retrying" | "stillFailing";

export interface QuitPrompt {
  /** Items that differ from what the disk holds, at least 1. */
  readonly count: number;
  readonly message: string;
  readonly state: QuitPromptState;
}

/** The prompt's title, in the shelf and in main's own dialog. */
export const quitTitle = (count: number): string =>
  count === 1
    ? "1 change couldn’t be saved"
    : `${count} changes couldn’t be saved`;

export const QuitAnswerSchema = z.enum(["retry", "discard", "cancel"]);

export type QuitAnswer = z.output<typeof QuitAnswerSchema>;

/** An item a failed save left unwritten: it shows "Not saved", with Retry and Discard changes. */
export interface NotSavedItem {
  readonly id: ItemId;
  /**
   * What sits next to Retry. `delete` for an item the disk has never held,
   * which has no saved version; null when the item already shows its saved
   * version and only the disk is behind.
   */
  readonly undo: "discard" | "delete" | null;
}

export interface ShelfView {
  readonly doc: ShelfDoc;
  readonly status: ShelfStatus;
  /** Items whose changes a failed save left unwritten, in shelf order. */
  readonly notSaved: readonly NotSavedItem[];
  /** The last Discard changes; open details put their own fields back when it changes. */
  readonly discarded: { readonly id: ItemId; readonly seq: number } | null;
  /**
   * The item to select and scroll to, set by a capture. Changes with every
   * capture. `edit` opens its text for typing, as after a new window link.
   */
  readonly focus: {
    readonly id: ItemId;
    readonly seq: number;
    readonly edit?: boolean;
  } | null;
  /** An item can be restored with undoRemove. */
  readonly canUndo: boolean;
}

/** The fields the field shortcuts (⌘D, ⌘⇧D, ⌘⇧S) open in details. */
export type DetailField = "description" | "due" | "steps";

/** App-menu choices the shelf window carries out itself, so its own state (editing, undo) stays in one place. */
/** What the menu bar's Item menu asks of the selected item. */
export type ItemAction =
  | "copyList"
  | "copyWithLink"
  | "copyDetails"
  | "open"
  | "edit"
  | "details"
  | "linkWindow"
  | "toggleDone"
  | "previousSection"
  | "nextSection"
  | "remove";

export type ShelfCommand =
  | { readonly kind: "newSection" }
  /** ⌘D, ⌘⇧D, ⌘⇧S: details open with that field focused or added. */
  | { readonly kind: "field"; readonly field: DetailField }
  /** ⌘/ and Help › Keyboard Shortcuts. */
  | { readonly kind: "shortcuts" }
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
  | {
      readonly ok: false;
      readonly message: string;
      /** A copy refused because its items aren't saved: Retry saves them, then it can be copied. */
      readonly retrySave?: true;
    };

const PASTE_MAX_BYTES = 30 * 1024 * 1024;

/**
 * The in-app tutorial (src/main/tutorial/, src/renderer/tutorial/), in
 * every window that shows a hint: its view, and what the page asks or reports.
 */
const tutorialEvents = { tutorial: event<TutorialView>() } as const;

const tutorialMethods = {
  getTutorial: invoke(z.void(), out<TutorialView>()),
  tutorial: send(TutorialActionSchema),
} as const;

export const shelfContract = defineContract({
  events: {
    command: event<ShelfCommand>(),
    /** Quitting: the page sends every edit it still holds, then answers with `settled` and this number. */
    settle: event<number>(),
    /** A short note on something main did, shown as a toast: a confirmation, or why it failed. */
    notice: event<{ readonly message: string; readonly tone: NoticeTone }>(),
    view: event<ShelfView>(),
    ...tutorialEvents,
  },
  global: "insetShelf",
  methods: {
    ...tutorialMethods,
    /** Getting Started in the ⋯ menu (Windows): the checklist comes back. */
    gettingStarted: send(z.void()),
    /** Show Me Around in the ⋯ menu (Windows): the walkthrough. */
    showMeAround: send(z.void()),
    /**
     * A menu in the shelf opened (true) or the last one closed: meanwhile
     * the menu takes every key, so main holds back the menu bar's keys.
     */
    menuOpen: send(z.boolean()),
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
    /** The item's words and the page it came from, as text, with its metadata when it has any. */
    copyWithLink: invoke(ItemIdSchema, out<ActionResult>()),
    /** The item's title, words, page and every piece of metadata, as text. */
    copyDetails: invoke(ItemIdSchema, out<ActionResult>()),
    /** File › New Window Link…: the picker, in its own window; picking makes a note. */
    newWindowLink: send(z.void()),
    /** Link Window… in details: the picker, adding to this item. */
    linkWindows: send(ItemIdSchema),
    /** Opens a linked window's page or file, else brings its app forward. */
    reopenWindow: send(
      z.object({ id: ItemIdSchema, windowId: WindowIdSchema.optional() })
    ),
    dismissProblem: send(z.void()),
    /** Retry in the "Not saved to disk" banner: writes every change the disk doesn't hold yet. */
    retrySave: invoke(z.void(), out<ActionResult>()),
    /** The held quit's prompt: Retry, Quit without saving, or Cancel. */
    answerQuit: send(QuitAnswerSchema),
    /** Discard changes on an item a failed save left unwritten: it goes back to what the disk holds. */
    discardChanges: send(ItemIdSchema),
    /** The page has sent every edit it held when `settle` asked, up to this number. */
    settled: send(z.number().int().min(0)),
    /** How many edits the page holds that it hasn't sent yet; it says so whenever the number changes. */
    drafts: send(z.number().int().min(0).max(1000)),
    getView: invoke(z.void(), out<ShelfView>()),
    hide: send(z.void()),
    /** Copy and Undo inside a text field, done by the window's own edit commands. */
    nativeEdit: send(z.enum(["copy", "undo", "redo", "selectAll"])),
    newDrawing: send(z.void()),
    /** The README, in the browser; Help › Inset Shelf Help. */
    openHelp: send(z.void()),
    /** Shows an image large in the drawing window, to look at or draw on. */
    openImage: send(ItemIdSchema),
    /** Add Pins… and Move pins in details: the image opens with the Pin tool. */
    openPins: send(ItemIdSchema),
    /** Double Shift is off: the onboarding opens at Accessibility. */
    setUpDoubleShift: send(z.void()),
    /**
     * Opens the page an item was captured from, or one of the links in it;
     * main opens only an address the item holds, over http or https.
     */
    openLink: send(
      z.object({ id: ItemIdSchema, url: z.string().max(2000).optional() })
    ),
    openSettings: send(z.void()),
    /** Window › Float on Top. */
    setFloatOnTop: send(z.boolean()),
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

/** A done thing gets a tick; a failed one says so. */
export type NoticeTone = "done" | "failed";

export interface ToastView {
  readonly title: string;
  readonly detail: string;
  readonly seq: number;
  readonly tone: NoticeTone;
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
  events: { view: event<ScreenshotView | null>(), ...tutorialEvents },
  global: "insetScreenshot",
  methods: {
    ...tutorialMethods,
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

/** The picture under the marks in the drawing window: an image item's, without the marks a save kept beside it. */
export interface DrawingImage {
  /** For showing it; the pixels for the saved copy come from getImage. */
  readonly url: string;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly pixelsPerDip: number;
}

/** What the drawing window opens: the picture, the marks to edit on it, and the tool to start with. */
export interface DrawingOpened {
  /** Null for a blank page: a new drawing, or one saved before, opened again. */
  readonly image: DrawingImage | null;
  /**
   * The marks a save kept and the item's numbered pins, in the picture's
   * DIP, all editable again; pins are drawn into copies, never into the
   * saved picture.
   */
  readonly marks: readonly DrawingMark[];
  /** Opened from details to place or move pins: the Pin tool is picked at once. */
  readonly pinMode: boolean;
}

export interface DrawingView extends DrawingOpened {
  /** Changes with every opening, so the page starts over. */
  readonly seq: number;
  /** A quit is under way: the marks can't change until it is answered (Round 8). Keeps `seq`, so the page keeps its marks. */
  readonly quitting: boolean;
}

/**
 * What the shelf holds of the drawing being closed, so its confirm says
 * what closing loses: nothing of it, the drawing as it is (a held quit's
 * save put it there), or an earlier version of it.
 */
export type DrawingOnShelf = "none" | "asIs" | "earlier";

/** The drawing window: a blank canvas that saves one PNG to the shelf, or an image item drawn on. */
export const drawingContract = defineContract({
  events: {
    /** The window is closing with marks on the page: the page asks before throwing them away. */
    confirmClose: event<DrawingOnShelf>(),
    /** Undo, Redo and Duplicate from the menu bar, which takes ⌘Z, and ⌘D for Add Description, before the page sees them. */
    edit: event<"undo" | "redo" | "duplicate">(),
    /** New Drawing or Annotate asked for another drawing: this one, with its unsaved marks, came forward instead. */
    openRefused: event<null>(),
    /** Retry in a held quit: the page saves its marks to the shelf, as Save does. */
    saveForQuit: event<null>(),
    view: event<DrawingView>(),
    ...tutorialEvents,
  },
  global: "insetDrawing",
  methods: {
    ...tutorialMethods,
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
        /** Retry in a held quit asked for it: Cancel or Quit without saving stops it. */
        forQuit: z.boolean(),
        /** The marks drawn into `png`, kept beside it to edit again. */
        marks: StrokeMarksSchema,
        /** Null when only the pins changed, or no mark is left: the picture the window opened on stays. */
        png: z
          .instanceof(Uint8Array)
          .refine((bytes) => bytes.byteLength <= DRAWING_MAX_BYTES)
          .nullable(),
        /** In the saved image's pixels. */
        pins: PinsSchema,
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
    /** Reset Tutorial: the checklist and hints start over. */
    resetTutorial: send(z.void()),
    setOpenAtLogin: send(z.boolean()),
    /** Show tips: the tutorial's one-time hints. */
    setTips: send(z.boolean()),
    update: send(SettingsSchema.partial()),
  },
  name: "settings",
});

export type SettingsContract = typeof settingsContract;

/** An open window the picker offers, with a small picture of it. */
export interface WindowCandidate {
  readonly id: string;
  readonly app: string | null;
  readonly title: string | null;
  /** A small PNG as a data URL. */
  readonly thumb: string;
}

export interface PickerView {
  /** Changes with every opening, so the page starts over. */
  readonly seq: number;
  /** A new note from the windows, or windows added to an item (its words, for the header). */
  readonly target:
    | { readonly kind: "new" }
    | { readonly kind: "item"; readonly label: string };
  readonly state:
    | { readonly kind: "loading" }
    | {
        readonly kind: "ready";
        readonly candidates: readonly WindowCandidate[];
      }
    | { readonly kind: "failed"; readonly message: string }
    /** macOS: Screen Recording is off, so windows can't be listed. */
    | { readonly kind: "permission" };
  /** Linking is under way: the chosen windows are being captured. */
  readonly linking: boolean;
}

/** The window-link picker: a window of its own, like New Drawing. */
export const pickerContract = defineContract({
  events: { view: event<PickerView>(), ...tutorialEvents },
  global: "insetPicker",
  methods: {
    ...tutorialMethods,
    cancel: send(z.void()),
    choose: invoke(
      z.array(z.string().min(1).max(100)).min(1).max(20),
      out<ActionResult>()
    ),
    getView: invoke(z.void(), out<PickerView>()),
    /** Screen Recording is off: the onboarding opens at it, in place of the picker. */
    setUpScreenRecording: send(z.void()),
    refresh: send(z.void()),
  },
  name: "picker",
});

export type PickerContract = typeof pickerContract;

/** The first-run permission onboarding (src/main/permissions/, src/renderer/onboarding/). */
export const onboardingContract = defineContract({
  events: { view: event<OnboardingView>() },
  global: "insetOnboarding",
  methods: {
    /** A row's Allow, or Waiting…, which asks again. */
    allow: send(PermissionIdSchema),
    /** Back, or ←. */
    back: send(z.void()),
    /** Done's buttons: start using the app, or start with the walkthrough. */
    finish: send(HandOffChoiceSchema),
    /** The page's height, so the window fits it without empty space. */
    fitHeight: send(z.number().int().min(120).max(1200)),
    getView: invoke(z.void(), out<OnboardingView>()),
    /** Get Started, Continue, →, or Not now on Allow access. */
    next: send(z.void()),
    /** Reopen to finish, for Screen Recording. */
    reopen: send(z.void()),
    /** Not now on Welcome: the whole flow. */
    skip: send(z.void()),
    /** The app's tile, dragged into System Settings' list as the app bundle. */
    startDrag: send(z.void()),
  },
  name: "onboarding",
});

export type OnboardingContract = typeof onboardingContract;

export type ShelfContract = typeof shelfContract;

export type ToastContract = typeof toastContract;

export type ScreenshotContract = typeof screenshotContract;

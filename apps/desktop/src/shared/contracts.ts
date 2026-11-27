import { z } from "zod";

import type { CodeEditor } from "./code-editors";
import { StrokeMarksSchema } from "./drawing-scene";
import type { DrawingMark } from "./drawing-scene";
import { defineContract, event, invoke, out, send } from "./ipc";
import { HandOffChoiceSchema, PermissionIdSchema } from "./onboarding";
import type { OnboardingView } from "./onboarding";
import { WHY_MAX } from "./pill";
import type { PillView } from "./pill";
import { SettingsSchema } from "./settings";
import type { SettingsView } from "./settings";
import {
  AttachmentIdSchema,
  ItemIdSchema,
  PinsSchema,
  ShelfOpSchema,
  WindowIdSchema,
} from "./shelf";
import type { AttachmentId, ItemId, ShelfDoc } from "./shelf";
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
    /** Opens the item's details at this field: the why field's way in when the pill couldn't get the keyboard. */
    readonly field?: DetailField;
    /** A screenshot's item: open details stay open, and the notice main sends offers Show. */
    readonly keepDetails?: true;
  } | null;
  /** An item can be restored with undoRemove. */
  readonly canUndo: boolean;
  /** Recall: the open items from the window the shelf opened beside; absent or null when there are none. */
  readonly here?: ShelfHere | null;
  /** The user's home folder, so a file's path shows from "~"; absent where it is not known. */
  readonly home?: string;
  /** The code editors main knows, whose items open their file on a click; absent, the registry's own. */
  readonly editors?: readonly CodeEditor[];
}

/** The open items from the window the shelf opened beside (src/shared/recall.ts). */
export interface ShelfHere {
  readonly ids: readonly ItemId[];
  /** The window's place in a few words: "GitHub · acme/app #12". */
  readonly label: string;
  /** Changes with every opening. */
  readonly seq: number;
  /** Opened from the recall pill: the list starts filtered to these items. */
  readonly filter: boolean;
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

/** What attaching to an item did: the attachments it put there, and why any or all weren't, or null when all were. */
export interface AttachResult {
  readonly attached: readonly AttachmentId[];
  readonly message: string | null;
}

const PASTE_MAX_BYTES = 30 * 1024 * 1024;

/** The most files one drop or paste hands main by path: the page says so for more, and main refuses them. */
export const DROPPED_PATHS_MAX = 50;

const DroppedPathsSchema = z
  .array(z.string().min(1).max(4096))
  .min(1)
  .max(DROPPED_PATHS_MAX);

/**
 * The in-app tutorial (src/main/tutorial/, src/renderer/tutorial/), in
 * every window that shows a hint: its view, and what the page asks or reports.
 */
const tutorialEvents = { tutorial: event<TutorialView>() } as const;

const tutorialMethods = {
  getTutorial: invoke(z.void(), out<TutorialView>()),
  tutorial: send(TutorialActionSchema),
} as const;

/** Pictures and files attached to an item after capture (src/main/attachments.ts). */
const attachmentMethods = {
  /** The file dialog, for files to attach to this item. */
  pickFilesFor: send(ItemIdSchema),
  /** Files dropped on an item's row, by path; main reads them. */
  addFilesTo: invoke(
    z.object({
      id: ItemIdSchema,
      paths: DroppedPathsSchema,
    }),
    out<AttachResult>()
  ),
  /** A picture pasted with the item open, or with null the clipboard's own: main reads it. */
  pasteImageTo: invoke(
    z.object({
      bytes: z
        .instanceof(Uint8Array)
        .refine((bytes) => bytes.byteLength <= PASTE_MAX_BYTES)
        .nullable(),
      id: ItemIdSchema,
    }),
    out<AttachResult>()
  ),
  /** Drags one attachment out as a file: a picture with its pins drawn in, a file as itself. */
  startAttachmentDrag: send(
    z.object({ attachmentId: AttachmentIdSchema, id: ItemIdSchema })
  ),
  /** New Drawing in details: a blank page in the drawing window, saved as this item's attachment. */
  newDrawingFor: send(ItemIdSchema),
  /** Opens an attached picture in the drawing window, to look at or draw on; `pinMode` with the Pin tool. */
  openAttachment: send(
    z.object({
      attachmentId: AttachmentIdSchema,
      id: ItemIdSchema,
      pinMode: z.boolean(),
    })
  ),
} as const;

export const shelfContract = defineContract({
  events: {
    command: event<ShelfCommand>(),
    /** Quitting: the page sends every edit it still holds, then answers with `settled` and this number. */
    settle: event<number>(),
    /** A short note on something main did, shown as a toast: a confirmation, or why it failed. `show`: the item it names, which open details offer to show. */
    notice: event<{
      readonly message: string;
      readonly tone: NoticeTone;
      readonly show?: ItemId;
    }>(),
    view: event<ShelfView>(),
    /** Main showed the shelf: the page puts the caret in the note field unless something is under way. */
    shown: event<null>(),
    ...tutorialEvents,
  },
  global: "insetShelf",
  methods: {
    ...tutorialMethods,
    ...attachmentMethods,
    /** Getting Started in the ⋯ menu (Windows): the checklist comes back. */
    gettingStarted: send(z.void()),
    /** Show Me Around in the ⋯ menu (Windows): the walkthrough. */
    showMeAround: send(z.void()),
    /**
     * A menu in the shelf opened (true) or the last one closed: meanwhile
     * the menu takes every key, so main holds back the menu bar's keys.
     */
    menuOpen: send(z.boolean()),
    /** A notice main sent is on the page, for the trial log; the page says nothing of one that never rendered. */
    noticeShown: send(
      z.object({
        message: z.string().max(2000),
        tone: z.enum(["done", "failed"]),
      })
    ),
    /** Files dropped or pasted into the shelf, by path; main reads them, and its notice says how it went once they are on disk. */
    addFiles: send(DroppedPathsSchema),
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
    /** The docs site, in the browser: Help in the shelf's ⋯, and Help › Inset Shelf Help. */
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
    pasteImage: send(
      z
        .instanceof(Uint8Array)
        .refine((bytes) => bytes.byteLength <= PASTE_MAX_BYTES)
    ),
    startDrag: send(ItemIdSchema),
  },
  name: "shelf",
});

/** A done thing gets a tick; a failed one says so. */
export type NoticeTone = "done" | "failed";

/** The notice window's corner nearest the pointer, where the notice is drawn. */
export type NoticeCorner =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

/** What the pill shows (src/shared/pill.ts). */
export type ToastView = PillView;

export type { PillView } from "./pill";

/** A new screenshot on its card beside the shelf. */
export interface ScreenshotView {
  /** Changes with every screenshot; actions name it, so they never reach a newer one. */
  readonly seq: number;
  readonly imageUrl: string;
  readonly widthPx: number;
  readonly heightPx: number;
  /** Where its save stands. */
  readonly save: ShotSave;
}

/** Which add saves the screenshot: Add to Shelf, or a drop on an item. */
export type ShotSaveTo = "shelf" | "item";

/**
 * Where the shelf shows the card's screenshot right now, not saved: as a row
 * of its own, or attached to an item, with the name the card shows for it.
 * The shelf owns it there. Retry for that place is the card's only add,
 * until the user takes the screenshot off the shelf.
 */
export type ShotPlaced =
  | { readonly to: "shelf" }
  | { readonly to: "item"; readonly id: ItemId; readonly label: string };

/**
 * A screenshot card's save: none yet, writing (its button reads Saving…, a
 * drop's save too), or failed (the card says why). `placed` is read from the
 * shelf each time the view is sent. While it is null, nothing holds the
 * screenshot and the card offers Add to Shelf, and a drop on an item.
 */
export type ShotSave =
  | { readonly state: "idle" }
  | { readonly state: "saving"; readonly placed: ShotPlaced | null }
  | {
      readonly state: "failed";
      readonly message: string;
      readonly placed: ShotPlaced;
    }
  | {
      readonly state: "failed";
      readonly message: string;
      readonly placed: null;
      /** "shelf" when Add to Shelf reads Retry; null when it reads Add to Shelf (a failed drop's retry is another drag). */
      readonly to: "shelf" | null;
    };

const Seq = z.number().int().min(0);

const WhyTextSchema = z.object({
  seq: Seq,
  text: z.string().max(WHY_MAX),
});

export const toastContract = defineContract({
  events: { view: event<ToastView>() },
  global: "insetToast",
  methods: {
    getView: invoke(z.void(), out<ToastView | null>()),
    /** The pointer is on the notice: it takes the click and stays until the pointer leaves. */
    hover: send(z.boolean()),
    /** Opens the shelf at what the notice named; `seq` keeps a late click from reaching a newer notice. */
    open: send(Seq),
    // Say why (src/shared/pill.ts): the capture notice turns into a one-line field.
    /** The Why target: open the field. */
    why: send(Seq),
    /** The field has the keyboard; its caret shows from now on. */
    whyReady: send(Seq),
    /** The field's words, on every change, so main keeps them when the field closes another way. */
    whyInput: send(WhyTextSchema),
    /** Return. */
    saveWhy: send(WhyTextSchema),
    /** Esc. */
    cancelWhy: send(Seq),
    /** The recall pill's close button: this place stays quiet from now on. */
    dismiss: send(Seq),
  },
  name: "toast",
});

export const screenshotContract = defineContract({
  events: {
    view: event<ScreenshotView | null>(),
    ...tutorialEvents,
  },
  global: "insetScreenshot",
  methods: {
    ...tutorialMethods,
    addToShelf: send(Seq),
    /** The only Retry adding to “…”: main refuses it once the shelf shows the screenshot on another item, or on none. */
    addToItem: send(z.object({ id: ItemIdSchema, seq: Seq })),
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
    /** Drags the screenshot out as a file: onto an item in the shelf, or into another app. */
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
    /** Esc: the window closes, as its × does. */
    close: send(z.void()),
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

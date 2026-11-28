import type { NoticeCorner, NoticeTone } from "./contracts";
import type { Rect } from "./geometry";
import type { PlaceKey } from "./recall";
import type { ItemId } from "./shelf";

/**
 * The pill: the small notice window beside the pointer
 * (src/main/toast-window.ts runs it, src/renderer/toast/ draws it). Every
 * state it can be in, what may replace what, which timers run and when it
 * holds the keyboard are here, so precedence and key ownership are tested
 * without Electron.
 */

/** How long a notice stays. */
export const NOTICE_MS = 2500;

/** After the pointer leaves the notice: long enough to come back to it. */
export const AFTER_HOVER_MS = 1200;

/** The why field has this long to get the keyboard; after it the shelf opens at the item's description instead. */
export const TAKE_KEYS_MS = 300;

/** An empty why field left alone gives the keyboard back after this long. A field with words waits. */
export const IDLE_WHY_MS = 8000;

/** How long "Why saved" shows. */
export const SAVED_MS = 900;

/** How long words that couldn't be written are offered again, unless the pointer holds the notice: long enough to look up from typing. */
export const UNSAVED_MS = 8000;

/** The longest why the field takes. */
export const WHY_MAX = 500;

/**
 * Open decision 5: clicking away from the why field, or switching apps,
 * saves what was typed. False makes it the same as Esc.
 */
export const BLUR_SAVES = true;

/**
 * Open decision 4: a second Double Shift on the same selection, or on none,
 * while the capture notice shows, opens the why field. False leaves the Why
 * target as its only way in, and a second Double Shift captures or toggles as
 * before.
 */
export const SECOND_TAP_SAYS_WHY = true;

/** How long the recall pill stays, unless the pointer holds it. */
export const RECALL_MS = 4000;

/**
 * Open decision 6: the recall pill sits inside the front window's
 * bottom-right corner, away from the next click. "pointer" puts it beside
 * the pointer, as the capture notice.
 */
export const RECALL_AT: "window" | "pointer" = "window";

/**
 * The field taking the keyboard and typing; then, with the keyboard back with
 * the app in front, the words on their way to the disk and the short
 * confirmation once it holds them.
 */
export type WhyPhase = "taking" | "typing" | "saving" | "saved";

/** How writing a why ended. */
export type WhyOutcome =
  | { readonly kind: "saved" }
  | { readonly kind: "failed"; readonly message: string }
  /** The item was deleted meanwhile: nothing was stored. */
  | { readonly kind: "gone" };

export const WHY_GONE = "This item no longer exists, so the why wasn’t saved.";

/** How much of the words a notice about a why that couldn't be written repeats. */
const WHY_ECHO = 60;

/** What the pill shows, without where: the runner adds the corner it drew it in. */
export type PillBody =
  | {
      readonly kind: "notice";
      readonly seq: number;
      readonly title: string;
      readonly tone: NoticeTone;
      /** What its end offers, as ⇧⇧ again does: the why field after a capture, or writing again the words that couldn't be written. */
      readonly offer: "why" | "again" | null;
    }
  | {
      readonly kind: "why";
      readonly seq: number;
      /** The field, "typing" once the page has the keyboard, and "saved" for the short confirmation. */
      readonly phase: Exclude<WhyPhase, "saving">;
    }
  | {
      readonly kind: "why";
      readonly seq: number;
      readonly phase: "saving";
      /** The words on their way to the disk, shown beside Saving…. */
      readonly text: string;
    }
  | {
      readonly kind: "recall";
      readonly seq: number;
      /** Open items from the window in front. */
      readonly count: number;
      /** The window's place in a few words: "GitHub · acme/app #12". */
      readonly label: string;
    };

export type PillView = PillBody & {
  /** The window's corner nearest the pointer, where the pill is drawn. */
  readonly corner: NoticeCorner;
};

/** What a notice offers a second Double Shift, or a click on its end. */
export interface WhyOffer {
  readonly item: ItemId;
  /** The selection the capture took, which a second Double Shift is compared with. */
  readonly text: string;
  /** Words a write couldn't keep: taking the offer writes them again. Without them it opens the field. */
  readonly unsaved: string | null;
}

interface Notice {
  readonly title: string;
  readonly tone: NoticeTone;
  /** The item a click opens the shelf at. */
  readonly item: ItemId | null;
  readonly offer: WhyOffer | null;
}

interface Why {
  readonly item: ItemId;
  /** The selection the capture took, for offering the words again. */
  readonly selection: string;
  /** What the field holds, as the page last said; after Return, the words being written. */
  readonly text: string;
  /** A notice that arrived while the field had the keyboard, shown after it. */
  readonly waiting: Notice | null;
}

export type Shown =
  | { readonly kind: "hidden" }
  | (Notice & {
      readonly kind: "notice";
      readonly hovered: boolean;
      /** A Double Shift is copying to decide whether it means the why field; the notice waits for it. */
      readonly held: boolean;
    })
  /** The why field. This is the only pill that holds the keyboard, or is taking it. */
  | (Why & {
      readonly kind: "why";
      readonly phase: "taking" | "typing";
    })
  /** The words after Return, on their way to the disk and then confirmed. The keyboard is back with the app in front. */
  | (Why & {
      readonly kind: "write";
      readonly phase: "saving" | "saved";
    })
  | {
      readonly kind: "recall";
      readonly place: PlaceKey;
      readonly ids: readonly ItemId[];
      readonly label: string;
      /** The window it was shown for, where a click docks the shelf; null when it couldn't be read. */
      readonly window: Rect<"screen"> | null;
      readonly hovered: boolean;
    };

export interface PillState {
  /** The newest pill's number. A click or timer for an older one does nothing. */
  readonly seq: number;
  readonly shown: Shown;
}

export const INITIAL_PILL: PillState = { seq: 0, shown: { kind: "hidden" } };

export type PillEvent =
  /** A selection was saved while the shelf was hidden. */
  | {
      readonly type: "captured";
      readonly item: ItemId;
      readonly title: string;
      readonly text: string;
    }
  /** Main says something done or failed. */
  | {
      readonly type: "notified";
      readonly title: string;
      readonly tone: NoticeTone;
    }
  | { readonly type: "hover"; readonly on: boolean }
  /** A Double Shift started (on) or ended (off) its copy while notice `seq` offered the why field. */
  | { readonly type: "holding"; readonly seq: number; readonly on: boolean }
  | { readonly type: "timeout"; readonly seq: number }
  /** A click on the pill's body. */
  | { readonly type: "opened"; readonly seq: number }
  /** A second Double Shift, or a click on the notice's end: Why, or Try again. */
  | { readonly type: "whyAsked"; readonly seq: number }
  /** The page's field has the keyboard. */
  | { readonly type: "whyReady"; readonly seq: number }
  /** The field's words changed. */
  | { readonly type: "whyInput"; readonly seq: number; readonly text: string }
  /** Return. */
  | { readonly type: "whySaved"; readonly seq: number; readonly text: string }
  /** Esc. */
  | { readonly type: "whyCancelled"; readonly seq: number }
  /** Main wrote the words Return, a click away or Try again saved, or couldn't. */
  | {
      readonly type: "whyStored";
      readonly seq: number;
      readonly text: string;
      readonly outcome: WhyOutcome;
    }
  /** The pill's window lost the keyboard: a click elsewhere, or another app. */
  | { readonly type: "blurred" }
  | { readonly type: "shelfShown" }
  /** Open items came from the window in front, which was away long enough (src/shared/recall.ts). */
  | {
      readonly type: "recalled";
      readonly place: PlaceKey;
      readonly ids: readonly ItemId[];
      readonly label: string;
      /** The front window, whose corner the pill sits in; null when it can't be read. */
      readonly window: Rect<"screen"> | null;
    }
  /** The recall pill's close button. */
  | { readonly type: "dismissed"; readonly seq: number }
  /** Any key, from the system-wide hook: the user is typing. */
  | { readonly type: "keyDown" };

export type PillEffect =
  /** Shows the view beside the pointer, or where the pill already is, at its new size. */
  | {
      readonly type: "show";
      readonly view: PillBody;
      readonly at: "pointer" | "same";
    }
  /** Shows the view inside a window's bottom-right corner, or the screen's without one. */
  | {
      readonly type: "show";
      readonly view: PillBody;
      readonly at: "window";
      readonly window: Rect<"screen"> | null;
    }
  | { readonly type: "hide" }
  /** Replaces the one pending timer. */
  | { readonly type: "timer"; readonly seq: number; readonly ms: number }
  | { readonly type: "stopTimer" }
  /** The pill takes clicks, or lets them through to the window below. */
  | { readonly type: "clicks"; readonly take: boolean }
  /** The pill's window takes the keyboard without making Inset the active app. */
  | { readonly type: "takeKeys" }
  /** It gives the keyboard back to the app in front. */
  | { readonly type: "giveKeys" }
  /** Writes the words to the item; main answers with whyStored for `seq`. */
  | {
      readonly type: "saveWhy";
      readonly item: ItemId;
      readonly text: string;
      readonly seq: number;
    }
  | {
      readonly type: "openShelf";
      readonly item: ItemId | null;
      /** The field to open in the item's details. */
      readonly field: "description" | null;
    }
  /** The shelf opens beside the window the pill was shown for, filtered to its items: the click itself changes the window in front. */
  | {
      readonly type: "openRecall";
      readonly ids: readonly ItemId[];
      readonly label: string;
      readonly window: Rect<"screen"> | null;
    }
  /** The recall pill went, and how, for when to show the next one. */
  | {
      readonly type: "recallEnded";
      readonly place: PlaceKey;
      readonly how: "opened" | "dismissed" | "ignored";
    };

export interface PillStep {
  readonly state: PillState;
  readonly effects: readonly PillEffect[];
}

/** The why field holds the keyboard, or is taking it: Double Shift must not copy now. */
export const holdsKeys = (state: PillState): boolean =>
  state.shown.kind === "why";

/** The why field a second Double Shift would open, for the capture notice showing now. */
export const offerOf = (
  state: PillState
): (WhyOffer & { readonly seq: number }) | null =>
  state.shown.kind === "notice" && state.shown.offer !== null
    ? { ...state.shown.offer, seq: state.seq }
    : null;

/** What a Double Shift does, given the why field the capture notice offered when it began. */
export const secondTap = (
  offer: WhyOffer | null,
  result:
    | { readonly kind: "text"; readonly text: string }
    | { readonly kind: "files" }
    | { readonly kind: "none" }
): "why" | "capture" | "toggle" => {
  // Files copied in Explorer or Finder are never the text the notice offers a why for.
  if (result.kind === "files") {
    return "capture";
  }

  if (offer === null || !SECOND_TAP_SAYS_WHY) {
    return result.kind === "text" ? "capture" : "toggle";
  }

  return result.kind === "none" || result.text.trim() === offer.text.trim()
    ? "why"
    : "capture";
};

/** An item's description with a why added: after what it already says, on a line of its own. */
export const withWhy = (description: string, why: string): string =>
  description.trim() === "" ? why : `${description.trimEnd()}\n${why}`;

const same = (state: PillState): PillStep => ({ effects: [], state });

const hidden = (state: PillState): PillStep => ({
  effects: [{ type: "hide" }, { type: "stopTimer" }],
  state: { ...state, shown: { kind: "hidden" } },
});

/** Hides the recall pill and says how it went; anything else showing just hides. */
const ended = (
  state: PillState,
  how: "opened" | "dismissed" | "ignored"
): PillStep => {
  const { shown } = state;
  const closed = hidden(state);

  return shown.kind === "recall"
    ? {
        effects: [
          ...closed.effects,
          { how, place: shown.place, type: "recallEnded" },
        ],
        state: closed.state,
      }
    : closed;
};

const showRecall = (
  state: PillState,
  event: Extract<PillEvent, { readonly type: "recalled" }>
): PillStep => {
  const seq = state.seq + 1;

  const view: PillBody = {
    count: event.ids.length,
    kind: "recall",
    label: event.label,
    seq,
  };

  return {
    effects: [
      { take: false, type: "clicks" },
      RECALL_AT === "window"
        ? { at: "window", type: "show", view, window: event.window }
        : { at: "pointer", type: "show", view },
      { ms: RECALL_MS, seq, type: "timer" },
    ],
    state: {
      seq,
      shown: {
        hovered: false,
        ids: event.ids,
        kind: "recall",
        label: event.label,
        place: event.place,
        window: event.window,
      },
    },
  };
};

/** Beside the pointer, or where the pill it answers already is. */
const showNotice = (
  state: PillState,
  notice: Notice,
  at: "pointer" | "same" = "pointer"
): PillStep => {
  const seq = state.seq + 1;
  const again = notice.offer !== null && notice.offer.unsaved !== null;
  const offered = again ? "again" : "why";

  return {
    effects: [
      { take: false, type: "clicks" },
      {
        at,
        type: "show",
        view: {
          kind: "notice",
          offer: notice.offer === null ? null : offered,
          seq,
          title: notice.title,
          tone: notice.tone,
        },
      },
      { ms: again ? UNSAVED_MS : NOTICE_MS, seq, type: "timer" },
    ],
    state: {
      seq,
      shown: { ...notice, held: false, hovered: false, kind: "notice" },
    },
  };
};

/** Hides the pill, or shows the notice that waited for the field. */
const closeWhy = (state: PillState, waiting: Notice | null): PillStep =>
  waiting === null ? hidden(state) : showNotice(state, waiting);

/**
 * Leaves the field. The keyboard goes back before anything else happens, so
 * no step can leave the pill holding it. `save` writes the words, if any,
 * after the pill has gone; a failure then comes back as a notice.
 */
const leaveWhy = (
  state: PillState,
  how: { readonly save: boolean }
): PillStep => {
  const { shown } = state;

  if (shown.kind !== "why") {
    return same(state);
  }

  const text = shown.text.trim().slice(0, WHY_MAX);

  const save: readonly PillEffect[] =
    how.save && text !== ""
      ? [{ item: shown.item, seq: state.seq, text, type: "saveWhy" }]
      : [];

  const closed = closeWhy(state, shown.waiting);

  return {
    effects: [{ type: "giveKeys" }, ...save, ...closed.effects],
    state: closed.state,
  };
};

/**
 * Starts writing the words. The pill reads Saving… where it is and holds no
 * keyboard: `first` gives it back when the field had it, before anything else.
 */
const write = (
  state: PillState,
  why: Why,
  first: readonly PillEffect[]
): PillStep => ({
  effects: [
    ...first,
    { take: false, type: "clicks" },
    { type: "stopTimer" },
    {
      at: "same",
      type: "show",
      view: { kind: "why", phase: "saving", seq: state.seq, text: why.text },
    },
    { item: why.item, seq: state.seq, text: why.text, type: "saveWhy" },
  ],
  state: { ...state, shown: { ...why, kind: "write", phase: "saving" } },
});

const askWhy = (state: PillState, seq: number): PillStep => {
  const { shown } = state;

  if (seq !== state.seq || shown.kind !== "notice" || shown.offer === null) {
    return same(state);
  }

  const { item, text: selection, unsaved } = shown.offer;

  // Words a write couldn't keep: the same words go again, and nobody's keyboard is taken for it.
  if (unsaved !== null) {
    return write(state, { item, selection, text: unsaved, waiting: null }, []);
  }

  const next = state.seq + 1;

  return {
    effects: [
      { type: "stopTimer" },
      { take: true, type: "clicks" },
      {
        at: "same",
        type: "show",
        view: { kind: "why", phase: "taking", seq: next },
      },
      { type: "takeKeys" },
      { ms: TAKE_KEYS_MS, seq: next, type: "timer" },
    ],
    state: {
      seq: next,
      shown: {
        item,
        kind: "why",
        phase: "taking",
        selection,
        text: "",
        waiting: null,
      },
    },
  };
};

/** The field's idle timer runs only while it is empty. */
const idleTimer = (state: PillState, text: string): PillEffect =>
  text.trim() === ""
    ? { ms: IDLE_WHY_MS, seq: state.seq, type: "timer" }
    : { type: "stopTimer" };

const timedOut = (state: PillState): PillStep => {
  const { shown } = state;

  if (shown.kind === "write") {
    // While the words are written the write answers, not a timer.
    return shown.phase === "saved"
      ? closeWhy(state, shown.waiting)
      : same(state);
  }

  if (shown.kind !== "why") {
    return shown.kind === "hidden" ? same(state) : ended(state, "ignored");
  }

  // The field never got the keyboard: the shelf opens at the item's description instead.
  if (shown.phase === "taking") {
    const closed = hidden(state);

    return {
      effects: [
        { type: "giveKeys" },
        ...closed.effects,
        { field: "description", item: shown.item, type: "openShelf" },
      ],
      state: closed.state,
    };
  }

  return shown.text.trim() === ""
    ? leaveWhy(state, { save: false })
    : same(state);
};

type Handler<T extends PillEvent["type"]> = (
  state: PillState,
  event: Extract<PillEvent, { readonly type: T }>
) => PillStep;

const isCurrent = (state: PillState, seq: number): boolean => seq === state.seq;

const arrived = (state: PillState, notice: Notice): PillStep => {
  const { shown } = state;

  // The field keeps the keyboard; the notice shows once it closes.
  if (shown.kind === "why") {
    return same({ ...state, shown: { ...shown, waiting: notice } });
  }

  const shownNotice = showNotice(state, notice);

  // A recall pill gives way to what the user just did.
  return shown.kind === "recall"
    ? {
        effects: [
          { how: "ignored", place: shown.place, type: "recallEnded" },
          ...shownNotice.effects,
        ],
        state: shownNotice.state,
      }
    : shownNotice;
};

/** The notice's timer, unless the pointer or a Double Shift's copy holds it. */
const soon = (state: PillState): readonly PillEffect[] => {
  const { shown } = state;

  const free =
    (shown.kind === "notice" && !shown.hovered && !shown.held) ||
    (shown.kind === "recall" && !shown.hovered);

  return free ? [{ ms: AFTER_HOVER_MS, seq: state.seq, type: "timer" }] : [];
};

/** "The disk is full. “half a thought” wasn’t saved." The reason comes first, so long words never push it out of the notice. */
const notWritten = (text: string, message: string): string => {
  const line = text.replaceAll(/\s+/gu, " ");

  const echo =
    line.length > WHY_ECHO ? `${line.slice(0, WHY_ECHO - 1)}…` : line;

  return `${message} “${echo}” wasn’t saved.`;
};

const failedNotice = (title: string): Notice => ({
  item: null,
  offer: null,
  title,
  tone: "failed",
});

/**
 * How writing the words ended. While the pill still reads Saving… it says Why
 * saved, offers the words again with the reason, or says the item is gone;
 * once the pill has moved on, only a failure is said, in a notice that
 * repeats them. No answer takes the keyboard.
 */
const stored = (
  state: PillState,
  event: Extract<PillEvent, { readonly type: "whyStored" }>
): PillStep => {
  const { shown } = state;
  const { outcome } = event;

  if (outcome.kind === "saved") {
    return isCurrent(state, event.seq) && shown.kind === "write"
      ? {
          effects: [
            {
              at: "same",
              type: "show",
              view: { kind: "why", phase: "saved", seq: state.seq },
            },
            { ms: SAVED_MS, seq: state.seq, type: "timer" },
          ],
          state: { ...state, shown: { ...shown, phase: "saved" } },
        }
      : same(state);
  }

  const title =
    outcome.kind === "gone"
      ? WHY_GONE
      : notWritten(event.text, outcome.message);

  if (
    !isCurrent(state, event.seq) ||
    shown.kind !== "write" ||
    shown.phase !== "saving"
  ) {
    return arrived(state, failedNotice(title));
  }

  // The words the shelf couldn't write are offered again where Saving… was; a notice that waited for the field gives way to them.
  return showNotice(
    state,
    outcome.kind === "gone"
      ? failedNotice(title)
      : {
          item: shown.item,
          offer: {
            item: shown.item,
            text: shown.selection,
            unsaved: shown.text,
          },
          title,
          tone: "failed",
        },
    "same"
  );
};

/** One handler per event, each given only its own event. */
type Handlers = { readonly [T in PillEvent["type"]]: Handler<T> };

const HANDLERS: Handlers = {
  blurred: (state) => {
    const { shown } = state;

    // Losing the keyboard while taking it is left to the timer: the field never had it. After Return the pill has given it back itself.
    return shown.kind === "why" && shown.phase === "typing"
      ? leaveWhy(state, { save: BLUR_SAVES })
      : same(state);
  },

  captured: (state, event) =>
    arrived(state, {
      item: event.item,
      offer: { item: event.item, text: event.text, unsaved: null },
      title: event.title,
      tone: "done",
    }),

  holding: (state, event) => {
    const { shown } = state;

    if (!isCurrent(state, event.seq) || shown.kind !== "notice") {
      return same(state);
    }

    const next: PillState = { ...state, shown: { ...shown, held: event.on } };

    return {
      effects: event.on ? [{ type: "stopTimer" }] : soon(next),
      state: next,
    };
  },

  hover: (state, event) => {
    const { shown } = state;

    if (shown.kind !== "notice" && shown.kind !== "recall") {
      return same(state);
    }

    const next: PillState = {
      ...state,
      shown: { ...shown, hovered: event.on },
    };

    return {
      effects: event.on
        ? [{ type: "stopTimer" }, { take: true, type: "clicks" }]
        : [{ take: false, type: "clicks" }, ...soon(next)],
      state: next,
    };
  },

  notified: (state, event) =>
    arrived(state, {
      item: null,
      offer: null,
      title: event.title,
      tone: event.tone,
    }),

  dismissed: (state, event) =>
    isCurrent(state, event.seq) && state.shown.kind === "recall"
      ? ended(state, "dismissed")
      : same(state),

  // The user is typing: a recall pill steps aside.
  keyDown: (state) =>
    state.shown.kind === "recall" ? ended(state, "ignored") : same(state),

  opened: (state, event) => {
    const { shown } = state;

    if (!isCurrent(state, event.seq)) {
      return same(state);
    }

    if (shown.kind === "recall") {
      const closed = ended(state, "opened");

      return {
        effects: [
          ...closed.effects,
          {
            ids: shown.ids,
            label: shown.label,
            type: "openRecall",
            window: shown.window,
          },
        ],
        state: closed.state,
      };
    }

    if (shown.kind !== "notice") {
      return same(state);
    }

    const closed = hidden(state);

    return {
      effects: [
        ...closed.effects,
        { field: null, item: shown.item, type: "openShelf" },
      ],
      state: closed.state,
    };
  },

  // The shelf shows what a waiting notice would have said.
  shelfShown: (state) => {
    const { shown } = state;

    if (shown.kind === "why") {
      return leaveWhy(
        { ...state, shown: { ...shown, waiting: null } },
        { save: shown.phase === "typing" && BLUR_SAVES }
      );
    }

    return shown.kind === "hidden" ? same(state) : ended(state, "ignored");
  },

  // A recall pill never replaces a capture notice or the why field.
  recalled: (state, event) =>
    state.shown.kind === "hidden" ? showRecall(state, event) : same(state),

  timeout: (state, event) =>
    isCurrent(state, event.seq) ? timedOut(state) : same(state),

  whyAsked: (state, event) => askWhy(state, event.seq),

  whyCancelled: (state, event) =>
    isCurrent(state, event.seq) && state.shown.kind === "why"
      ? leaveWhy(state, { save: false })
      : same(state),

  whyInput: (state, event) => {
    const { shown } = state;

    if (!isCurrent(state, event.seq) || shown.kind !== "why") {
      return same(state);
    }

    return {
      effects: shown.phase === "typing" ? [idleTimer(state, event.text)] : [],
      state: { ...state, shown: { ...shown, text: event.text } },
    };
  },

  whyReady: (state, event) => {
    const { shown } = state;

    if (
      !isCurrent(state, event.seq) ||
      shown.kind !== "why" ||
      shown.phase !== "taking"
    ) {
      return same(state);
    }

    return {
      effects: [
        {
          at: "same",
          type: "show",
          view: { kind: "why", phase: "typing", seq: state.seq },
        },
        idleTimer(state, shown.text),
      ],
      state: { ...state, shown: { ...shown, phase: "typing" } },
    };
  },

  whySaved: (state, event) => {
    const { shown } = state;

    if (!isCurrent(state, event.seq) || shown.kind !== "why") {
      return same(state);
    }

    const text = event.text.trim().slice(0, WHY_MAX);

    // Return: the keyboard goes back at once and the words are written behind it. With nothing typed the field just closes.
    return text === ""
      ? leaveWhy({ ...state, shown: { ...shown, text } }, { save: false })
      : write(state, { ...shown, text }, [{ type: "giveKeys" }]);
  },

  whyStored: stored,
};

const handle = <T extends PillEvent["type"]>(
  state: PillState,
  event: Extract<PillEvent, { readonly type: T }>
): PillStep => {
  const handler: Handler<T> = HANDLERS[event.type];

  return handler(state, event);
};

export const stepPill = (state: PillState, event: PillEvent): PillStep =>
  handle(state, event);

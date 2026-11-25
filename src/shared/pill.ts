import type { NoticeCorner, NoticeTone } from "./contracts";
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

export type WhyPhase = "taking" | "typing" | "saved";

/** What the pill shows, without where: the runner adds the corner it drew it in. */
export type PillBody =
  | {
      readonly kind: "notice";
      readonly seq: number;
      readonly title: string;
      readonly tone: NoticeTone;
      /** The capture notice offers the why field. */
      readonly why: boolean;
    }
  | {
      readonly kind: "why";
      readonly seq: number;
      /** "typing" once the page has the keyboard, "saved" for the short confirmation. */
      readonly phase: WhyPhase;
    };

export type PillView = PillBody & {
  /** The window's corner nearest the pointer, where the pill is drawn. */
  readonly corner: NoticeCorner;
};

/** What a second Double Shift is compared with: the item the capture notice is for. */
export interface WhyOffer {
  readonly item: ItemId;
  readonly text: string;
}

interface Notice {
  readonly title: string;
  readonly tone: NoticeTone;
  /** The item a click opens the shelf at. */
  readonly item: ItemId | null;
  readonly offer: WhyOffer | null;
}

export type Shown =
  | { readonly kind: "hidden" }
  | (Notice & {
      readonly kind: "notice";
      readonly hovered: boolean;
      /** A Double Shift is copying to decide whether it means the why field; the notice waits for it. */
      readonly held: boolean;
    })
  | {
      readonly kind: "why";
      readonly item: ItemId;
      readonly phase: WhyPhase;
      /** What the field holds, as the page last said. */
      readonly text: string;
      /** A notice that arrived while the field had the keyboard, shown after it. */
      readonly waiting: Notice | null;
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
  /** A second Double Shift, or a click on Why. */
  | { readonly type: "whyAsked"; readonly seq: number }
  /** The page's field has the keyboard. */
  | { readonly type: "whyReady"; readonly seq: number }
  /** The field's words changed. */
  | { readonly type: "whyInput"; readonly seq: number; readonly text: string }
  /** Return. */
  | { readonly type: "whySaved"; readonly seq: number; readonly text: string }
  /** Esc. */
  | { readonly type: "whyCancelled"; readonly seq: number }
  /** The pill's window lost the keyboard: a click elsewhere, or another app. */
  | { readonly type: "blurred" }
  | { readonly type: "shelfShown" };

export type PillEffect =
  /** Shows the view beside the pointer, or where the pill already is, at its new size. */
  | {
      readonly type: "show";
      readonly view: PillBody;
      readonly at: "pointer" | "same";
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
  | { readonly type: "saveWhy"; readonly item: ItemId; readonly text: string }
  | {
      readonly type: "openShelf";
      readonly item: ItemId | null;
      /** The field to open in the item's details. */
      readonly field: "description" | null;
    };

export interface PillStep {
  readonly state: PillState;
  readonly effects: readonly PillEffect[];
}

/** The why field holds the keyboard, or is taking it: Double Shift must not copy now. */
export const holdsKeys = (state: PillState): boolean =>
  state.shown.kind === "why" && state.shown.phase !== "saved";

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
    | { readonly kind: "none" }
): "why" | "capture" | "toggle" => {
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

const showNotice = (state: PillState, notice: Notice): PillStep => {
  const seq = state.seq + 1;

  return {
    effects: [
      { take: false, type: "clicks" },
      {
        at: "pointer",
        type: "show",
        view: {
          kind: "notice",
          seq,
          title: notice.title,
          tone: notice.tone,
          why: notice.offer !== null,
        },
      },
      { ms: NOTICE_MS, seq, type: "timer" },
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
 * no step can leave the pill holding it. `save` keeps the words, if any.
 */
const leaveWhy = (
  state: PillState,
  how: { readonly save: boolean; readonly after: "close" | "confirm" }
): PillStep => {
  const { shown } = state;

  if (shown.kind !== "why") {
    return same(state);
  }

  const text = shown.text.trim().slice(0, WHY_MAX);
  const saved = how.save && text !== "";

  const save: readonly PillEffect[] = saved
    ? [{ item: shown.item, text, type: "saveWhy" }]
    : [];

  const given: readonly PillEffect[] =
    shown.phase === "saved" ? [] : [{ type: "giveKeys" }];

  if (saved && how.after === "confirm") {
    return {
      effects: [
        ...given,
        ...save,
        { take: false, type: "clicks" },
        {
          at: "same",
          type: "show",
          view: { kind: "why", phase: "saved", seq: state.seq },
        },
        { ms: SAVED_MS, seq: state.seq, type: "timer" },
      ],
      state: { ...state, shown: { ...shown, phase: "saved", text } },
    };
  }

  const closed = closeWhy(state, shown.waiting);

  return {
    effects: [...given, ...save, ...closed.effects],
    state: closed.state,
  };
};

const askWhy = (state: PillState, seq: number): PillStep => {
  const { shown } = state;

  if (seq !== state.seq || shown.kind !== "notice" || shown.offer === null) {
    return same(state);
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
        item: shown.offer.item,
        kind: "why",
        phase: "taking",
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

  if (shown.kind !== "why") {
    return shown.kind === "hidden" ? same(state) : hidden(state);
  }

  switch (shown.phase) {
    // The field never got the keyboard: the shelf opens at the item's description instead.
    case "taking": {
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

    case "typing": {
      return shown.text.trim() === ""
        ? leaveWhy(state, { after: "close", save: false })
        : same(state);
    }

    case "saved": {
      return closeWhy(state, shown.waiting);
    }

    default: {
      return same(state);
    }
  }
};

type Handler<T extends PillEvent["type"]> = (
  state: PillState,
  event: Extract<PillEvent, { readonly type: T }>
) => PillStep;

const isCurrent = (state: PillState, seq: number): boolean => seq === state.seq;

const arrived = (state: PillState, notice: Notice): PillStep => {
  const { shown } = state;

  // The field keeps the keyboard; the notice shows once it closes.
  if (shown.kind === "why" && holdsKeys(state)) {
    return same({ ...state, shown: { ...shown, waiting: notice } });
  }

  return showNotice(state, notice);
};

/** The notice's timer, unless the pointer or a Double Shift's copy holds it. */
const soon = (state: PillState): readonly PillEffect[] =>
  state.shown.kind === "notice" && !state.shown.hovered && !state.shown.held
    ? [{ ms: AFTER_HOVER_MS, seq: state.seq, type: "timer" }]
    : [];

/** One handler per event, each given only its own event. */
type Handlers = { readonly [T in PillEvent["type"]]: Handler<T> };

const HANDLERS: Handlers = {
  blurred: (state) =>
    // Losing the keyboard while taking it is left to the timer: the field never had it.
    state.shown.kind === "why" && state.shown.phase === "typing"
      ? leaveWhy(state, { after: "close", save: BLUR_SAVES })
      : same(state),

  captured: (state, event) =>
    arrived(state, {
      item: event.item,
      offer: { item: event.item, text: event.text },
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

    if (shown.kind !== "notice") {
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

  opened: (state, event) => {
    const { shown } = state;

    if (!isCurrent(state, event.seq) || shown.kind !== "notice") {
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

    if (shown.kind === "why" && holdsKeys(state)) {
      return leaveWhy(
        { ...state, shown: { ...shown, waiting: null } },
        { after: "close", save: shown.phase === "typing" && BLUR_SAVES }
      );
    }

    return shown.kind === "hidden" ? same(state) : hidden(state);
  },

  timeout: (state, event) =>
    isCurrent(state, event.seq) ? timedOut(state) : same(state),

  whyAsked: (state, event) => askWhy(state, event.seq),

  whyCancelled: (state, event) =>
    isCurrent(state, event.seq) && holdsKeys(state)
      ? leaveWhy(state, { after: "close", save: false })
      : same(state),

  whyInput: (state, event) => {
    const { shown } = state;

    if (
      !isCurrent(state, event.seq) ||
      shown.kind !== "why" ||
      !holdsKeys(state)
    ) {
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

    if (
      !isCurrent(state, event.seq) ||
      shown.kind !== "why" ||
      !holdsKeys(state)
    ) {
      return same(state);
    }

    return leaveWhy(
      { ...state, shown: { ...shown, text: event.text } },
      { after: "confirm", save: true }
    );
  },
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

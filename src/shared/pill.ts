import type { NoticeCorner, NoticeTone } from "./contracts";
import type { ItemId } from "./shelf";

/**
 * The pill: the small notice window beside the pointer
 * (src/main/toast-window.ts runs it, src/renderer/toast/ draws it). Every
 * state it can be in, what may replace what, and which timers run, are here,
 * so precedence is tested without Electron.
 */

/** How long a notice stays. */
export const NOTICE_MS = 2500;

/** After the pointer leaves the notice: long enough to come back to it. */
export const AFTER_HOVER_MS = 1200;

/** What the pill shows, without where: the runner adds the corner it drew it in. */
export interface PillBody {
  readonly kind: "notice";
  readonly seq: number;
  readonly title: string;
  readonly tone: NoticeTone;
  /** The capture notice offers the why field. */
  readonly why: boolean;
}

export type PillView = PillBody & {
  /** The window's corner nearest the pointer, where the pill is drawn. */
  readonly corner: NoticeCorner;
};

export type Shown =
  | { readonly kind: "hidden" }
  | {
      readonly kind: "notice";
      readonly title: string;
      readonly tone: NoticeTone;
      /** The item a click opens the shelf at. */
      readonly item: ItemId | null;
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
  | { readonly type: "timeout"; readonly seq: number }
  /** A click on the pill's body. */
  | { readonly type: "opened"; readonly seq: number }
  | { readonly type: "shelfShown" };

export type PillEffect =
  /** Shows the view: beside the pointer, or where the pill already is. */
  | { readonly type: "show"; readonly view: PillBody; readonly at: "pointer" }
  | { readonly type: "hide" }
  /** Replaces the one pending timer. */
  | { readonly type: "timer"; readonly seq: number; readonly ms: number }
  | { readonly type: "stopTimer" }
  /** The pill takes clicks, or lets them through to the window below. */
  | { readonly type: "clicks"; readonly take: boolean }
  | { readonly type: "openShelf"; readonly item: ItemId | null };

export interface PillStep {
  readonly state: PillState;
  readonly effects: readonly PillEffect[];
}

const same = (state: PillState): PillStep => ({ effects: [], state });

const hidden = (state: PillState): PillStep => ({
  effects: [{ type: "hide" }, { type: "stopTimer" }],
  state: { ...state, shown: { kind: "hidden" } },
});

const showNotice = (
  state: PillState,
  notice: {
    readonly title: string;
    readonly tone: NoticeTone;
    readonly item: ItemId | null;
  }
): PillStep => {
  const seq = state.seq + 1;

  return {
    effects: [
      { type: "clicks", take: false },
      {
        at: "pointer",
        type: "show",
        view: {
          kind: "notice",
          seq,
          title: notice.title,
          tone: notice.tone,
          why: false,
        },
      },
      { ms: NOTICE_MS, seq, type: "timer" },
    ],
    state: { seq, shown: { ...notice, hovered: false, kind: "notice" } },
  };
};

export const stepPill = (state: PillState, event: PillEvent): PillStep => {
  const { shown } = state;

  switch (event.type) {
    case "captured": {
      return showNotice(state, {
        item: event.item,
        title: event.title,
        tone: "done",
      });
    }

    case "notified": {
      return showNotice(state, {
        item: null,
        title: event.title,
        tone: event.tone,
      });
    }

    case "hover": {
      if (shown.kind !== "notice") {
        return same(state);
      }

      return {
        effects: event.on
          ? [{ type: "stopTimer" }, { take: true, type: "clicks" }]
          : [
              { take: false, type: "clicks" },
              { ms: AFTER_HOVER_MS, seq: state.seq, type: "timer" },
            ],
        state: { ...state, shown: { ...shown, hovered: event.on } },
      };
    }

    case "timeout": {
      return event.seq === state.seq && shown.kind !== "hidden"
        ? hidden(state)
        : same(state);
    }

    case "opened": {
      if (event.seq !== state.seq || shown.kind !== "notice") {
        return same(state);
      }

      const closed = hidden(state);

      return {
        effects: [...closed.effects, { item: shown.item, type: "openShelf" }],
        state: closed.state,
      };
    }

    case "shelfShown": {
      return shown.kind === "hidden" ? same(state) : hidden(state);
    }

    default: {
      return same(state);
    }
  }
};

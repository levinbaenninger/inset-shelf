import type { Rect } from "@shared/geometry";
import type { PlaceSource } from "@shared/recall";

/**
 * Notices when another window comes to the front, for context recall.
 * Electron has no event for another app's window, but every switch the user
 * makes starts with input the key hook already sees: a click, or a shortcut
 * held with Cmd, Ctrl or Alt. A pause after it reads the front window once. A
 * slow poll covers the rest (a swipe between Spaces, an address typed into a
 * browser) while the machine is in use. Nothing is read while recall can't
 * show, and the costly page address only when it could match.
 */

/** A window must stay in front this long, with no click or key, before it is read. */
export const SETTLE_MS = 1200;

/** The slow poll, which also runs only when there was input within it. */
export const POLL_MS = 20_000;

export type Activity = "pointer" | "chord" | "key";

/** The front window as recall reads it: its source, and its bounds for the pill's corner. */
export interface FrontRead {
  readonly source: PlaceSource;
  readonly bounds: Rect<"screen"> | null;
}

export interface FrontWatchDeps {
  /**
   * Reads the window in front; null when it is Inset's own or none. Without
   * `address` it sends no Apple Event and can never raise a prompt.
   */
  readonly probe: (address: boolean) => Promise<FrontRead | null>;
  readonly setTimer: (run: () => void, ms: number) => () => void;
  /** Seconds since the last input anywhere on the system. */
  readonly idleSeconds: () => number;
  /** Recall could show now: it is on, no Inset window or pill shows, no capture runs, and an open item has a source. */
  readonly allowed: () => boolean;
  /** An open item came from a page or app link in this app, so its window's address is worth asking for. */
  readonly wantsAddress: (app: string | null) => boolean;
  readonly onArrived: (read: FrontRead) => void;
}

export interface FrontWatch {
  /** Input the key hook saw, as a kind only: no key is passed on or kept. */
  readonly activity: (kind: Activity) => void;
  readonly start: () => void;
  readonly stop: () => void;
}

const sameWindow = (a: PlaceSource, b: PlaceSource): boolean =>
  a.app === b.app && a.title === b.title;

export const createFrontWatch = (deps: FrontWatchDeps): FrontWatch => {
  let running = false;
  let reading = false;
  let last: PlaceSource | null = null;
  let cancelSettle: (() => void) | null = null;
  let cancelPoll: (() => void) | null = null;

  const read = async (): Promise<void> => {
    if (!running || reading || !deps.allowed()) {
      return;
    }

    reading = true;

    try {
      const cheap = await deps.probe(false);

      // Inset in front, or the same window as last time: nothing new.
      if (cheap === null || (last !== null && sameWindow(last, cheap.source))) {
        return;
      }

      last = cheap.source;

      const full =
        deps.wantsAddress(cheap.source.app) && deps.allowed()
          ? await deps.probe(true)
          : null;

      if (running && deps.allowed()) {
        deps.onArrived(full ?? cheap);
      }
    } finally {
      reading = false;
    }
  };

  const settle = (): void => {
    cancelSettle?.();
    cancelSettle = deps.setTimer(() => {
      cancelSettle = null;
      void read();
    }, SETTLE_MS);
  };

  const poll = (): void => {
    cancelPoll = deps.setTimer(() => {
      if (deps.idleSeconds() < POLL_MS / 1000) {
        void read();
      }

      poll();
    }, POLL_MS);
  };

  return {
    activity: (kind) => {
      if (!running) {
        return;
      }

      // A plain key starts nothing, but pushes back a read that is waiting: no read while the user types.
      if (kind !== "key" || cancelSettle !== null) {
        settle();
      }
    },
    start: () => {
      if (running) {
        return;
      }

      running = true;
      poll();
    },
    stop: () => {
      running = false;
      last = null;
      cancelSettle?.();
      cancelSettle = null;
      cancelPoll?.();
      cancelPoll = null;
    },
  };
};

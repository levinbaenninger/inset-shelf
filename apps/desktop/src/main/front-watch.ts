import type { Rect } from "@shared/geometry";
import type { PlaceSource } from "@shared/recall";
import type { ItemContext } from "@shared/shelf";

/**
 * Notices when another window comes to the front, for context recall.
 * Electron has no event for another app's window, but every switch the user
 * makes starts with input the key hook already sees: a click, or a shortcut
 * held with Cmd, Ctrl or Alt. A pause after it reads the front window once. A
 * slow poll covers the rest (a swipe between Spaces, an address typed into a
 * browser) while the machine is in use, and waits for the same pause. Nothing
 * is read while recall can't show, and the costly page address only in an app
 * where it could match: there it is asked on every read, since two pages of
 * one app can share a title.
 */

/** A window must stay in front this long, with no click or key, before it is read. */
export const SETTLE_MS = 1200;

/** The slow poll, which also runs only when there was input within it. */
export const POLL_MS = 20_000;

export type Activity = "pointer" | "chord" | "key";

/** The front window as recall reads it: its source, and its bounds for the pill's corner. */
export interface FrontRead {
  readonly source: ItemContext;
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

/** The same window showing the same page or app link. */
const samePage = (a: PlaceSource, b: PlaceSource): boolean =>
  sameWindow(a, b) &&
  a.url === b.url &&
  (a.appLink ?? null) === (b.appLink ?? null);

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

      // Inset in front: nothing new.
      if (cheap === null) {
        return;
      }

      // An app the shelf holds a page from is told apart by its address, since a web app can keep one title on every page. Any other app is the same window while its title stays, and is never asked.
      const addressed = deps.wantsAddress(cheap.source.app);

      const front =
        addressed && deps.allowed() ? await deps.probe(true) : cheap;

      const same = addressed ? samePage : sameWindow;

      if (front === null || (last !== null && same(last, front.source))) {
        return;
      }

      last = front.source;

      if (running && deps.allowed()) {
        deps.onArrived(front);
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
      // The poll's read waits for a pause like any other, so none is sent while the user types. One already waiting keeps its time.
      if (deps.idleSeconds() < POLL_MS / 1000 && cancelSettle === null) {
        settle();
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

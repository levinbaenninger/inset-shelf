import type { PlaceSource } from "@shared/recall";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import { createFrontWatch, POLL_MS, SETTLE_MS } from "./front-watch";
import type { FrontRead, FrontWatchDeps } from "./front-watch";

const window = (
  app: string,
  title: string,
  url: string | null = null
): FrontRead => ({
  bounds: null,
  source: { app, appLink: null, title, url },
});

const PR_IN_CHROME = window(
  "Google Chrome",
  "Fix the build · Pull Request #12",
  "https://github.com/acme/app/pull/12"
);

/** Two pages of one web app whose title never changes. */
const BOARD = "https://tracker.example/board/7";
const INBOX = "https://tracker.example/inbox";

const tracker = (url: string): FrontRead =>
  window("Google Chrome", "Tracker", url);

const inChrome = (app: string | null): boolean => app === "Google Chrome";

const NOTES = window("Notes", "Standup");

/** A watcher over a front window the test changes, and everything it read and reported. Only a read that asks for the address learns it. */
const watched = (options: Partial<FrontWatchDeps> = {}) => {
  let front: FrontRead | null = NOTES;
  let idle = 0;
  const reads: boolean[] = [];
  const arrived: PlaceSource[] = [];

  const watch = createFrontWatch({
    allowed: () => true,
    idleSeconds: () => idle,
    onArrived: (read) => {
      arrived.push(read.source);
    },
    probe: async (address) => {
      reads.push(address);

      return await Promise.resolve(
        front === null || address
          ? front
          : { ...front, source: { ...front.source, url: null } }
      );
    },
    setTimer: (run, ms) => {
      const timer = setTimeout(run, ms);

      return () => {
        clearTimeout(timer);
      };
    },
    wantsAddress: () => false,
    ...options,
  });

  return {
    arrived,
    reads,
    set: (next: FrontRead | null) => {
      front = next;
    },
    setIdle: (seconds: number) => {
      idle = seconds;
    },
    watch,
  };
};

describe(createFrontWatch, () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads the front window once, a moment after a click", async () => {
    const { arrived, reads, watch } = watched();

    watch.start();
    watch.activity("pointer");
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 1);

    expect(reads).toStrictEqual([]);

    await vi.advanceTimersByTimeAsync(1);

    expect(reads).toStrictEqual([false]);
    expect(arrived).toStrictEqual([NOTES.source]);
  });

  it("waits while the user types, and plain typing alone reads nothing", async () => {
    const { reads, watch } = watched();

    watch.start();
    watch.activity("key");
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 2);

    expect(reads).toStrictEqual([]);

    watch.activity("chord");
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 200);
    watch.activity("key");
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 200);

    expect(reads).toStrictEqual([]);

    await vi.advanceTimersByTimeAsync(200);

    expect(reads).toStrictEqual([false]);
  });

  it("reports a window once, not on every read while it stays in front", async () => {
    const { arrived, set, watch } = watched();

    watch.start();

    for (const next of [NOTES, NOTES, PR_IN_CHROME, PR_IN_CHROME, NOTES]) {
      set(next);
      watch.activity("pointer");
      // oxlint-disable-next-line no-await-in-loop -- one settled read after each click, in order.
      await vi.advanceTimersByTimeAsync(SETTLE_MS);
    }

    expect(arrived.map((source) => source.app)).toStrictEqual([
      "Notes",
      "Google Chrome",
      "Notes",
    ]);
  });

  it("reads nothing while recall can't show: it is off, the shelf shows, or no item has a source", async () => {
    const { reads, watch } = watched({ allowed: () => false });

    watch.start();
    watch.activity("pointer");
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);

    expect(reads).toStrictEqual([]);
  });

  it("reads nothing once stopped", async () => {
    const { reads, watch } = watched();

    watch.start();
    watch.stop();
    watch.activity("pointer");
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);

    expect(reads).toStrictEqual([]);
  });

  it("asks for the page address only for an app the shelf holds a page from, on each read of its window", async () => {
    const { arrived, reads, set, watch } = watched({
      wantsAddress: inChrome,
    });

    watch.start();

    for (const next of [NOTES, NOTES, PR_IN_CHROME, PR_IN_CHROME]) {
      set(next);
      watch.activity("pointer");
      // oxlint-disable-next-line no-await-in-loop -- one settled read after each click, in order.
      await vi.advanceTimersByTimeAsync(SETTLE_MS);
    }

    expect(reads).toStrictEqual([false, false, false, true, false, true]);
    expect(arrived).toStrictEqual([NOTES.source, PR_IN_CHROME.source]);
  });

  it("reports two pages of one app with one title, each by its address, and the return to the first", async () => {
    const { arrived, set, watch } = watched({ wantsAddress: inChrome });

    watch.start();

    for (const url of [BOARD, INBOX, BOARD]) {
      set(tracker(url));
      watch.activity("pointer");
      // oxlint-disable-next-line no-await-in-loop -- one settled read after each click, in order.
      await vi.advanceTimersByTimeAsync(SETTLE_MS);
    }

    expect(arrived.map((source) => source.url)).toStrictEqual([
      BOARD,
      INBOX,
      BOARD,
    ]);
  });

  it("reports a page once while its address stays, however often it is read", async () => {
    const { arrived, set, watch } = watched({ wantsAddress: inChrome });

    watch.start();

    for (const url of [BOARD, BOARD, BOARD]) {
      set(tracker(url));
      watch.activity("pointer");
      // oxlint-disable-next-line no-await-in-loop -- one settled read after each click, in order.
      await vi.advanceTimersByTimeAsync(SETTLE_MS);
    }

    expect(arrived.map((source) => source.url)).toStrictEqual([BOARD]);
  });

  it("notices a new address under one title by the slow poll, with no click", async () => {
    const { arrived, set, watch } = watched({ wantsAddress: inChrome });

    watch.start();
    set(tracker(BOARD));
    await vi.advanceTimersByTimeAsync(POLL_MS + SETTLE_MS);
    set(tracker(INBOX));
    await vi.advanceTimersByTimeAsync(POLL_MS);

    expect(arrived.map((source) => source.url)).toStrictEqual([BOARD, INBOX]);
  });

  it("never reads on the poll while the user types: it waits for a pause", async () => {
    const { reads, set, watch } = watched({ wantsAddress: inChrome });

    watch.start();
    set(tracker(BOARD));
    await vi.advanceTimersByTimeAsync(POLL_MS - 100);

    // Typing through the moment the poll comes due, a key every 400 ms.
    for (let key = 0; key < 6; key += 1) {
      watch.activity("key");
      // oxlint-disable-next-line no-await-in-loop -- keys one after another, as typed.
      await vi.advanceTimersByTimeAsync(400);
    }

    expect(reads).toStrictEqual([]);

    await vi.advanceTimersByTimeAsync(SETTLE_MS);

    expect(reads).toStrictEqual([false, true]);
  });

  it("polls only while the machine is in use", async () => {
    const { reads, set, setIdle, watch } = watched();

    watch.start();
    setIdle(60);
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);

    expect(reads).toStrictEqual([]);

    setIdle(3);
    set(PR_IN_CHROME);
    await vi.advanceTimersByTimeAsync(POLL_MS + SETTLE_MS);

    expect(reads).toStrictEqual([false]);
  });

  it("reports nothing while Inset's own window is in front", async () => {
    const { arrived, set, watch } = watched();

    watch.start();
    set(null);
    watch.activity("pointer");
    await vi.advanceTimersByTimeAsync(SETTLE_MS);

    expect(arrived).toStrictEqual([]);
  });
});

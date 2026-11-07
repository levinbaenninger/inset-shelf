import { TEXT_MAX } from "@shared/shelf";

/** Typing in a text item's field sends its words to main after this pause (Round 7). */
export const LIVE_EDIT_DELAY_MS = 300;

/** One text item's field while it is open. */
export interface LiveEdit {
  /** The words changed: they go to main after a pause. */
  readonly change: (markdown: string) => void;
  /** Return, or focus leaving: sends now. An emptied field keeps the item's words. */
  readonly finish: (markdown: string) => void;
  /** Escape: the item's words go back to what they were when the field opened. */
  readonly cancel: () => void;
  /** Sends the words still waiting for their pause, if any are. */
  readonly flush: () => void;
}

export interface LiveEdits {
  readonly open: (options: {
    readonly original: string;
    readonly send: (text: string) => void;
    /** The item the field edits, so Discard changes can stop it. */
    readonly owner?: string;
  }) => LiveEdit;
  /** Sends every edit still waiting for its pause: before a quit, a copy or a drag. */
  readonly flushAll: () => void;
  /** Discard changes: the owner's open fields send nothing more, so words typed there never come back after main puts the saved ones back. */
  readonly drop: (owner: string) => void;
}

const clean = (markdown: string): string => markdown.trim().slice(0, TEXT_MAX);

/**
 * The page's only drafts: words typed into a text item's field that have
 * not reached main yet. Main holds every other edit as it is made, so
 * `onCount` tells it how many there are whenever that changes.
 */
export const createLiveEdits = (deps: {
  readonly setTimer: (run: () => void, ms: number) => () => void;
  readonly onCount: (count: number) => void;
}): LiveEdits => {
  const waiting = new Map<
    symbol,
    { readonly owner: string | undefined; readonly flush: () => void }
  >();

  // How many times each owner's edits were dropped; an edit opened before the latest drop sends nothing.
  const drops = new Map<string, number>();
  let reported = 0;

  const report = (): void => {
    if (waiting.size !== reported) {
      reported = waiting.size;
      deps.onCount(reported);
    }
  };

  return {
    drop: (owner) => {
      drops.set(owner, (drops.get(owner) ?? 0) + 1);

      for (const entry of waiting.values()) {
        if (entry.owner === owner) {
          entry.flush();
        }
      }
    },
    flushAll: () => {
      for (const entry of waiting.values()) {
        entry.flush();
      }
    },
    open: ({ original, owner, send }) => {
      const key = Symbol("edit");
      const opened = owner === undefined ? 0 : (drops.get(owner) ?? 0);

      const dropped = (): boolean =>
        owner !== undefined && (drops.get(owner) ?? 0) !== opened;

      let sent = original;
      let latest = original;
      let cancelTimer: (() => void) | null = null;

      const stop = (): void => {
        cancelTimer?.();
        cancelTimer = null;
        waiting.delete(key);
        report();
      };

      const sendText = (text: string): void => {
        if (text !== sent && !dropped()) {
          sent = text;
          send(text);
        }
      };

      const flush = (): void => {
        if (cancelTimer === null) {
          return;
        }

        stop();

        const text = clean(latest);

        // An emptied field sends nothing until it is left.
        if (text !== "") {
          sendText(text);
        }
      };

      return {
        cancel: () => {
          stop();
          sendText(original);
        },
        change: (markdown) => {
          if (dropped()) {
            return;
          }

          latest = markdown;
          cancelTimer?.();
          cancelTimer = deps.setTimer(flush, LIVE_EDIT_DELAY_MS);
          waiting.set(key, { flush, owner });
          report();
        },
        finish: (markdown) => {
          latest = markdown;
          stop();

          const text = clean(markdown);

          sendText(text === "" ? original : text);
        },
        flush,
      };
    },
  };
};

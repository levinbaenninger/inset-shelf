import { once } from "node:events";

import type { Emitter } from "./menu-open";

/**
 * Main's side of asking the shelf page for the edits it still holds before
 * a quit (Round 7). The page answers with the number it was asked with,
 * after it has sent those edits, so main has them when the answer arrives:
 * both travel over the same ordered channel.
 */
export interface PageSettle {
  /** Asks the page; true once it answers, false when it goes away first, or at once when none has spoken since the last one went away. */
  readonly request: () => Promise<boolean>;
  /** The page's answer to request number `seq`, which also answers every earlier one. */
  readonly answered: (seq: number) => void;
  /** The page's own count of edits it hasn't sent yet. */
  readonly setDrafts: (count: number) => void;
  readonly drafts: () => number;
  /**
   * The page reloaded or went away: no answer is coming. Its last count
   * stays, so a quit still asks about the edits it may have held; only a
   * freshly loaded page's own report changes it (Round 8).
   */
  readonly reset: () => void;
}

/** The page events after which the page that was asked can't answer: a crash, a reload or navigation, the page gone. */
const PAGE_ENDS = [
  "did-start-loading",
  "did-navigate",
  "render-process-gone",
  "destroyed",
] as const;

/**
 * Follows the shelf page: each end resets the request. Nothing clears the
 * count on load, so a crash or reload is never taken as "nothing unsaved";
 * the new page reports its own count when it starts.
 */
export const followPage = (
  page: Emitter,
  settle: Pick<PageSettle, "reset">
): void => {
  for (const event of PAGE_ENDS) {
    page.on(event, settle.reset);
  }
};

export const createPageSettle = (ask: (seq: number) => void): PageSettle => {
  const changes = new EventTarget();
  let seq = 0;
  let answered = 0;
  // Each reload or crash; a request that sees one gets no answer.
  let resets = 0;
  let drafts = 0;
  // False from a reload or crash until the new page first speaks: no page is there to answer until then.
  let speaking = true;

  return {
    answered: (answer) => {
      speaking = true;
      answered = Math.max(answered, answer);
      changes.dispatchEvent(new Event("change"));
    },
    drafts: () => drafts,
    request: async () => {
      if (!speaking) {
        return false;
      }

      seq += 1;
      const mine = seq;
      const before = resets;

      const settled = (): boolean | null => {
        if (answered >= mine) {
          return true;
        }

        return resets === before ? null : false;
      };

      ask(mine);

      for (;;) {
        const outcome = settled();

        if (outcome !== null) {
          return outcome;
        }

        // oxlint-disable-next-line no-await-in-loop -- until the page answers or goes away.
        await once(changes, "change");
      }
    },
    reset: () => {
      resets += 1;
      speaking = false;
      changes.dispatchEvent(new Event("change"));
    },
    setDrafts: (count) => {
      speaking = true;
      drafts = count;
    },
  };
};

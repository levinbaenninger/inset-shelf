import { shelfBridge } from "@/shared/bridge";

import { createLiveEdits } from "./live-edits";

const api = shelfBridge();

/** The shelf page's text edits still on their way to main. */
export const liveEdits = createLiveEdits({
  onCount: (count) => {
    api.drafts(count);
  },
  setTimer: (run, ms) => {
    const timer = setTimeout(run, ms);

    return () => {
      clearTimeout(timer);
    };
  },
});

// A fresh page says it holds nothing yet: main keeps the count a crashed or reloaded page left until then (Round 8).
api.drafts(0);

// Quitting: every waiting edit goes to main first, then the answer, over the same channel.
api.on("settle", (seq) => {
  liveEdits.flushAll();
  api.settled(seq);
});

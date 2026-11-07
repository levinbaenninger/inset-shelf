import { describe, expect, it } from "vitest";

import { createLiveEdits, LIVE_EDIT_DELAY_MS } from "./live-edits";

/** Live edits with timers the test fires itself, recording what reaches main. */
const setup = () => {
  const timers: { run: () => void; ms: number }[] = [];
  const counts: number[] = [];
  const sent: string[] = [];

  const edits = createLiveEdits({
    onCount: (count) => {
      counts.push(count);
    },
    setTimer: (run, ms) => {
      const timer = { ms, run };

      timers.push(timer);

      return () => {
        const index = timers.indexOf(timer);

        if (index !== -1) {
          timers.splice(index, 1);
        }
      };
    },
  });

  const edit = edits.open({
    original: "Book the movers",
    send: (text) => {
      sent.push(text);
    },
  });

  const pause = (): void => {
    for (const timer of timers.splice(0)) {
      timer.run();
    }
  };

  return { counts, edit, edits, pause, sent, timers };
};

describe(createLiveEdits, () => {
  it("sends the words after a pause in typing, without the field being left", () => {
    const { counts, edit, pause, sent, timers } = setup();

    edit.change("Book the movers for");
    edit.change("Book the movers for Monday at 9 ");

    expect([sent, timers.map((timer) => timer.ms)]).toStrictEqual([
      [],
      [LIVE_EDIT_DELAY_MS],
    ]);

    pause();

    expect([sent, counts]).toStrictEqual([
      ["Book the movers for Monday at 9"],
      [1, 0],
    ]);
  });

  it("sends every edit still waiting at once when main asks before quitting", () => {
    const { counts, edit, edits, sent, timers } = setup();

    edit.change("Book the movers for Monday");
    edits.flushAll();

    expect({ counts, sent, timers }).toStrictEqual({
      counts: [1, 0],
      sent: ["Book the movers for Monday"],
      timers: [],
    });
  });

  it("puts the words back as they were on Escape, after some were already sent", () => {
    const { edit, pause, sent } = setup();

    edit.change("Book the");
    pause();
    edit.change("Book the van");
    edit.cancel();
    pause();

    expect(sent).toStrictEqual(["Book the", "Book the movers"]);
  });

  it("keeps the item's words when the field is left empty", () => {
    const { edit, pause, sent } = setup();

    edit.change("Book");
    pause();
    edit.change("");
    pause();
    edit.finish("");

    expect(sent).toStrictEqual(["Book", "Book the movers"]);
  });

  it("sends nothing for a field left as it opened", () => {
    const { counts, edit, sent } = setup();

    edit.finish("Book the movers");
    edit.flush();

    expect([sent, counts]).toStrictEqual([[], []]);
  });

  it("sends the last words once, however the field ends", () => {
    const { edit, edits, sent } = setup();

    edit.change("Book the movers today");
    edits.flushAll();
    edit.finish("Book the movers today");

    expect(sent).toStrictEqual(["Book the movers today"]);
  });

  it("sends nothing more from an item's field once its changes are discarded, and a field opened on it later sends again", () => {
    const { counts, edits, pause, sent } = setup();

    const open = () =>
      edits.open({
        original: "Book the movers",
        owner: "a",
        send: (text) => {
          sent.push(text);
        },
      });

    const typing = open();

    typing.change("Book the movers for Monday");
    edits.drop("a");
    pause();
    typing.change("Book the movers for Monday at 9");
    typing.finish("Book the movers for Monday at 9");
    typing.cancel();

    open().finish("Book the movers, again");

    expect({ counts, sent }).toStrictEqual({
      counts: [1, 0],
      sent: ["Book the movers, again"],
    });
  });
});

import { describe, expect, it } from "vite-plus/test";

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

  /** A field on code, whose words are sent exactly as typed. */
  const codeEdit = (original: string, into: string[]) =>
    edits.open({
      code: true,
      original,
      send: (text) => {
        into.push(text);
      },
    });

  return { codeEdit, counts, edit, edits, pause, sent, timers };
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

  it("drops the spaces around a note's words, so four typed before them never make it code", () => {
    const { edit, sent } = setup();

    edit.finish("\n    Book the movers today  \n");

    expect(sent).toStrictEqual(["Book the movers today"]);
  });

  it("sends code exactly as typed, every blank line and space kept", () => {
    const { codeEdit, pause, sent, timers } = setup();
    const original = "\n\tcall()  \n";
    const edit = codeEdit(original, sent);

    edit.change("\n\tcall()  \n\n\tnext()  \n");
    pause();
    edit.finish("\n\tcall()  \n\n\tnext()  \n\n");

    expect([sent, timers]).toStrictEqual([
      ["\n\tcall()  \n\n\tnext()  \n", "\n\tcall()  \n\n\tnext()  \n\n"],
      [],
    ]);
  });

  it("sends nothing for code left as it opened, or typed back to it, whatever its spaces", () => {
    const { codeEdit, pause, sent } = setup();
    const original = "\n\tcall()  \n";
    const edit = codeEdit(original, sent);

    edit.change(`${original}x`);
    edit.change(original);
    pause();
    edit.finish(original);

    expect(sent).toStrictEqual([]);
  });

  it("keeps the item's code when its field is left blank", () => {
    const { codeEdit, sent } = setup();

    codeEdit("\tcall()", sent).finish("  \n\t");

    expect(sent).toStrictEqual([]);
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

  it("sends nothing for a captured selection left as it opened, though it ends in a line break", () => {
    const { edits } = setup();
    const sent: string[] = [];
    const original = "const total = sum(items);\n";

    const send = (text: string): void => {
      sent.push(text);
    };

    const closed = edits.open({ original, send });
    const undone = edits.open({ original, send });

    closed.finish(original);
    undone.change(`${original}x`);
    undone.change(original);
    undone.flush();
    undone.finish(original);

    expect(sent).toStrictEqual([]);
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

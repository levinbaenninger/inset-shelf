import { once } from "node:events";
import { setImmediate } from "node:timers/promises";

import type { QuitAnswer, QuitPrompt } from "@shared/contracts";
import { emptyShelf, ItemIdSchema, SectionIdSchema } from "@shared/shelf";
import type { ItemId, ShelfDoc } from "@shared/shelf";
import { describe, expect, it } from "vitest";

import { createPageSettle } from "./page-settle";
import {
  createQuitHold,
  decideQuit,
  QUIT_WAIT_MS,
  SAVE_TOO_SLOW,
  withinWait,
} from "./quit-hold";
import type { NativeQuestion } from "./quit-hold";
import { createShelfController } from "./shelf-controller";
import type { WriteResult } from "./shelf-store";

/** The shelf page as the quit sees it: whether it answers, the edit it still holds, and its count. */
interface FakePage {
  answers: boolean;
  drafts: number;
  pending: { id: ItemId; text: string } | null;
  settles: number;
}

const uuid = (n: number) =>
  `8d4a1f2c-6b3e-4f70-9a2d-1c5e7b9f3a${String(n).padStart(2, "0")}`;

const DISK_FULL: WriteResult = { message: "disk full", ok: false };

/** Lets every pending save and timer callback run. */
const settled = async (): Promise<void> => {
  await setImmediate();
};

/**
 * The real controller and quit hold on a disk that fills up on request or
 * holds the next save back, with timers the test fires itself.
 */
const setup = () => {
  const disk = { full: false };
  const timers: { readonly run: () => void; readonly ms: number }[] = [];
  const onDisk: ShelfDoc[] = [];
  const held: Promise<WriteResult>[] = [];
  const asked: QuitPrompt[] = [];
  let shown: QuitPrompt | null = null;
  const finished: string[] = [];
  let saves = 0;
  let next = 10;

  const setTimer = (run: () => void, ms: number): (() => void) => {
    const timer = { ms, run };

    timers.push(timer);

    return () => {
      timers.splice(timers.indexOf(timer), 1);
    };
  };

  const controller = createShelfController({
    deleteAttachment: async () => {
      await Promise.resolve();
    },
    env: {
      newItemId: () => ItemIdSchema.parse(uuid((next += 1))),
      newSectionId: () => SectionIdSchema.parse(uuid((next += 1))),
      now: () => new Date("2026-11-06T10:00:00.000Z"),
    },
    initial: emptyShelf(SectionIdSchema.parse(uuid(1))),
    save: async (doc) => {
      saves += 1;

      const result =
        (await held.shift()) ?? (disk.full ? DISK_FULL : { ok: true });

      if (result.ok) {
        onDisk.push(doc);
      }

      return result;
    },
    setTimer,
    status: {
      floatOnTop: true,
      keys: "granted",
      problem: null,
      quitPrompt: null,
      readOnly: false,
      saveError: null,
      selectionCapture: true,
    },
  });

  /** The shelf page: whether it answers main's settle, what it still sends then, and its last draft count. */
  const page: FakePage = {
    answers: true,
    drafts: 0,
    pending: null,
    settles: 0,
  };

  /** The drawing window's marks, and whether its save reaches the shelf. */
  const drawing = { dirty: false, saves: 0, saveWorks: true };
  // What each of the drawing's saves was handed to stop it, and a save the test holds back.
  const drawingStops: AbortSignal[] = [];
  let drawingHeld: Promise<unknown> = Promise.resolve();
  const questions: NativeQuestion[] = [];
  // Main's own dialog: the test answers it.
  const native = new EventTarget();
  let nativeAnswer: QuitAnswer = "cancel";

  const hold = createQuitHold({
    ask: async (question) => {
      questions.push(question);
      await once(native, "answer");

      return nativeAnswer;
    },
    flush: controller.flush,
    pageDrafts: () => page.drafts,
    saveDrawing: async (stop) => {
      drawing.saves += 1;
      drawingStops.push(stop);
      await drawingHeld;

      if (drawing.saveWorks) {
        controller.apply({ text: "the drawing", type: "compose" });
        drawing.dirty = false;
      }
    },
    settlePage: async () => {
      page.settles += 1;

      if (!page.answers) {
        // A page that never answers.
        await once(new EventTarget(), "never");

        return false;
      }

      if (page.pending !== null) {
        controller.apply({ ...page.pending, type: "editText" });
        page.pending = null;
        page.drafts = 0;
      }

      return true;
    },
    prompt: (prompt) => {
      shown = prompt;

      if (prompt !== null) {
        asked.push(prompt);
      }
    },
    setTimer,
    state: () => ({
      drawing: drawing.dirty,
      readOnly: false,
      saveError: controller.view().status.saveError,
      unsaved: controller.unsaved(),
    }),
  });

  const compose = (text: string): ItemId => {
    const id = controller.apply({ text, type: "compose" });

    if (id === null) {
      throw new Error("not added");
    }

    return id;
  };

  /** The next save waits until `release` gives its outcome. */
  const holdNextSave = () => {
    const signal = new EventTarget();
    const released = once(signal, "release");
    let outcome: WriteResult = { ok: true };

    held.push(
      (async () => {
        await released;

        return outcome;
      })()
    );

    return (result: WriteResult): void => {
      outcome = result;
      signal.dispatchEvent(new Event("release"));
    };
  };

  const fire = (ms: number): void => {
    for (const timer of timers.filter((candidate) => candidate.ms === ms)) {
      timer.run();
    }
  };

  const texts = (): readonly string[] =>
    onDisk
      .at(-1)
      ?.items.map((item) => (item.kind === "text" ? item.text : "")) ?? [];

  return {
    /** Answers main's own dialog. */
    answerNative: (answer: QuitAnswer): void => {
      nativeAnswer = answer;
      native.dispatchEvent(new Event("answer"));
    },
    asked,
    compose,
    controller,
    disk,
    drawing,
    drawingStops,
    finished,
    fire,
    hold,
    /** The drawing's next save waits until the returned function runs. */
    holdDrawingSave: () => {
      const signal = new EventTarget();

      drawingHeld = once(signal, "release");

      return (): void => {
        signal.dispatchEvent(new Event("release"));
      };
    },
    holdNextSave,
    page,
    questions,
    quit: () => {
      hold.request(() => {
        finished.push("quit");
      });
    },
    saves: () => saves,
    shown: () => shown,
    texts,
  };
};

describe(decideQuit, () => {
  it.each([
    {
      expected: { kind: "quit" },
      name: "quits once the disk holds every change",
      state: {
        drawing: false,
        readOnly: false,
        saveError: null,
        timedOut: false,
        unsaved: 0,
      },
    },
    {
      expected: { count: 2, kind: "hold", message: "disk full" },
      name: "holds with the save's error",
      state: {
        drawing: false,
        readOnly: false,
        saveError: "disk full",
        timedOut: false,
        unsaved: 2,
      },
    },
    {
      expected: {
        count: 1,
        kind: "hold",
        message: "Saving didn't finish in time.",
      },
      name: "holds when the save is still running at the end of the wait",
      state: {
        drawing: false,
        readOnly: false,
        saveError: "disk full",
        timedOut: true,
        unsaved: 1,
      },
    },
    {
      expected: { kind: "quit" },
      name: "quits in a session that saves nothing",
      state: {
        drawing: false,
        readOnly: true,
        saveError: "Nothing is saved this session.",
        timedOut: false,
        unsaved: 3,
      },
    },
    {
      expected: {
        count: 1,
        kind: "hold",
        message: "Your drawing isn't on the shelf yet.",
      },
      name: "holds for a drawing with unsaved marks, on a shelf that is saved",
      state: {
        drawing: true,
        readOnly: false,
        saveError: null,
        timedOut: false,
        unsaved: 0,
      },
    },
    {
      expected: {
        count: 3,
        kind: "hold",
        message: "disk full Your drawing isn't on the shelf yet.",
      },
      name: "counts the drawing as one more change",
      state: {
        drawing: true,
        readOnly: false,
        saveError: "disk full",
        timedOut: false,
        unsaved: 2,
      },
    },
  ])("$name", ({ expected, state }) => {
    expect(decideQuit(state)).toStrictEqual(expected);
  });
});

describe("the quit hold", () => {
  it("quits without asking when the disk holds every change", async () => {
    const shelf = setup();

    shelf.compose("one");
    await shelf.controller.flush();
    shelf.quit();
    await settled();

    expect(shelf.finished).toStrictEqual(["quit"]);
    expect(shelf.asked).toStrictEqual([]);
  });

  it("writes an edit still waiting for its pause, then quits", async () => {
    const shelf = setup();
    const id = shelf.compose("one");

    await shelf.controller.flush();
    shelf.controller.apply({ id, text: "one, edited", type: "editText" });
    shelf.quit();
    await settled();

    expect(shelf.texts()).toStrictEqual(["one, edited"]);
    expect(shelf.finished).toStrictEqual(["quit"]);
    expect(shelf.asked).toStrictEqual([]);
  });

  it("holds the quit when the save fails, and Retry writes the changes and quits", async () => {
    const shelf = setup();
    const one = shelf.compose("one");
    const two = shelf.compose("two");

    await shelf.controller.flush();
    shelf.disk.full = true;
    shelf.controller.apply({ id: one, text: "one, edited", type: "editText" });
    shelf.controller.apply({ id: two, text: "two, edited", type: "editText" });
    shelf.quit();
    await settled();

    expect([shelf.finished, shelf.shown()]).toStrictEqual([
      [],
      { count: 2, message: "disk full", state: "asking" },
    ]);

    shelf.disk.full = false;
    shelf.hold.answer("retry");

    expect(shelf.shown()).toStrictEqual({
      count: 2,
      message: "disk full",
      state: "retrying",
    });

    await settled();

    expect([shelf.texts(), shelf.finished, shelf.shown()]).toStrictEqual([
      ["one, edited", "two, edited"],
      ["quit"],
      null,
    ]);
  });

  it("keeps asking after a Retry that fails again, and says so", async () => {
    const shelf = setup();

    shelf.disk.full = true;
    shelf.compose("one");
    shelf.quit();
    await settled();
    shelf.hold.answer("retry");
    await settled();

    expect(shelf.finished).toStrictEqual([]);
    expect(shelf.shown()).toStrictEqual({
      count: 1,
      message: "disk full",
      state: "stillFailing",
    });
  });

  it("quits without saving, and without another write", async () => {
    const shelf = setup();

    shelf.disk.full = true;
    shelf.compose("one");
    shelf.quit();
    await settled();

    const saves = shelf.saves();

    shelf.hold.answer("discard");
    await settled();

    expect(shelf.finished).toStrictEqual(["quit"]);
    expect(shelf.saves() - saves).toBe(0);
    expect(shelf.texts()).toStrictEqual([]);
  });

  it("keeps running after Cancel, and a later quit starts over", async () => {
    const shelf = setup();

    shelf.disk.full = true;
    shelf.compose("one");
    shelf.quit();
    await settled();
    shelf.hold.answer("cancel");

    expect(shelf.shown()).toBeNull();
    expect(shelf.finished).toStrictEqual([]);

    shelf.disk.full = false;
    shelf.quit();
    await settled();

    expect(shelf.texts()).toStrictEqual(["one"]);
    expect(shelf.finished).toStrictEqual(["quit"]);
  });

  it("writes a change made during the wait before the quit goes on", async () => {
    const shelf = setup();
    const first = shelf.holdNextSave();

    shelf.compose("one");
    await settled();
    shelf.quit();

    const second = shelf.holdNextSave();

    shelf.compose("two");
    first({ ok: true });
    await settled();

    expect(shelf.finished).toStrictEqual([]);

    second({ ok: true });
    await settled();

    expect(shelf.texts()).toStrictEqual(["one", "two"]);
    expect(shelf.finished).toStrictEqual(["quit"]);
    expect(shelf.asked).toStrictEqual([]);
  });

  it("asks when a save outlasts the wait, and its late success doesn't quit on its own", async () => {
    const shelf = setup();
    const release = shelf.holdNextSave();

    shelf.compose("one");
    shelf.quit();
    await settled();
    shelf.fire(QUIT_WAIT_MS);
    await settled();

    expect(shelf.shown()).toStrictEqual({
      count: 1,
      message: "Saving didn't finish in time.",
      state: "asking",
    });

    release({ ok: true });
    await settled();

    expect(shelf.finished).toStrictEqual([]);

    shelf.hold.answer("retry");
    await settled();

    expect(shelf.finished).toStrictEqual(["quit"]);
  });

  it("ignores answers while it waits, and brings the prompt back on a second quit", async () => {
    const shelf = setup();
    const release = shelf.holdNextSave();

    shelf.compose("one");
    shelf.quit();
    shelf.hold.answer("discard");
    release(DISK_FULL);
    await settled();

    expect(shelf.finished).toStrictEqual([]);

    shelf.quit();

    expect(shelf.asked).toStrictEqual([
      { count: 1, message: "disk full", state: "asking" },
      { count: 1, message: "disk full", state: "asking" },
    ]);
  });

  it("takes an edit still open in the shelf page before it decides, and writes it", async () => {
    const shelf = setup();
    const id = shelf.compose("Book the movers");

    await shelf.controller.flush();
    // Typed into the open editor, not yet sent: the page's count says so.
    shelf.page.pending = { id, text: "Book the movers for Monday at 9" };
    shelf.page.drafts = 1;
    shelf.quit();
    await settled();

    expect({
      asked: shelf.asked,
      finished: shelf.finished,
      settles: shelf.page.settles,
      texts: shelf.texts(),
    }).toStrictEqual({
      asked: [],
      finished: ["quit"],
      settles: 1,
      texts: ["Book the movers for Monday at 9"],
    });
  });

  it("holds the quit with the open edit when the disk refuses it", async () => {
    const shelf = setup();
    const id = shelf.compose("Book the movers");

    await shelf.controller.flush();
    shelf.disk.full = true;
    shelf.page.pending = { id, text: "Book the movers for Monday at 9" };
    shelf.page.drafts = 1;
    shelf.quit();
    await settled();

    expect([shelf.finished, shelf.shown()]).toStrictEqual([
      [],
      { count: 1, message: "disk full", state: "asking" },
    ]);
  });

  it("goes on when the page doesn't answer but its last word was that it holds nothing", async () => {
    const shelf = setup();

    shelf.compose("one");
    await shelf.controller.flush();
    shelf.page.answers = false;
    shelf.quit();
    await settled();

    expect(shelf.finished).toStrictEqual([]);

    shelf.fire(QUIT_WAIT_MS);
    await settled();

    expect([shelf.finished, shelf.questions]).toStrictEqual([["quit"], []]);
  });

  it("asks in main's own dialog when the page doesn't answer and holds an edit: Wait asks the page again", async () => {
    const shelf = setup();
    const id = shelf.compose("one");

    await shelf.controller.flush();
    shelf.page.answers = false;
    shelf.page.drafts = 1;
    shelf.quit();
    await settled();
    shelf.fire(QUIT_WAIT_MS);
    await settled();

    expect([shelf.questions, shelf.finished, shelf.shown()]).toStrictEqual([
      [{ kind: "unconfirmed" }],
      [],
      null,
    ]);

    // The page answers this time, with the edit it held.
    shelf.page.answers = true;
    shelf.page.pending = { id, text: "one, edited" };
    shelf.answerNative("retry");
    await settled();

    expect([shelf.page.settles, shelf.texts(), shelf.finished]).toStrictEqual([
      2,
      ["one, edited"],
      ["quit"],
    ]);
  });

  it.each([
    { answer: "discard" as const, finished: ["quit"] },
    { answer: "cancel" as const, finished: [] },
  ])(
    "takes $answer in main's dialog for a page that doesn't answer",
    async ({ answer, finished }) => {
      const shelf = setup();

      shelf.page.answers = false;
      shelf.page.drafts = 1;
      shelf.quit();
      await settled();
      shelf.fire(QUIT_WAIT_MS);
      await settled();
      shelf.answerNative(answer);
      await settled();

      expect(shelf.finished).toStrictEqual(finished);
    }
  );

  it("never treats a page that doesn't answer as saved: a held quit asks in main's dialog, not the page", async () => {
    const shelf = setup();

    shelf.disk.full = true;
    shelf.compose("one");
    shelf.page.answers = false;
    shelf.quit();
    await settled();
    shelf.fire(QUIT_WAIT_MS);
    await settled();

    expect([shelf.questions, shelf.asked, shelf.finished]).toStrictEqual([
      [
        {
          kind: "held",
          prompt: { count: 1, message: "disk full", state: "asking" },
        },
      ],
      [],
      [],
    ]);
  });

  it("holds for a drawing with unsaved marks; Cancel leaves it, Retry saves it to the shelf and quits", async () => {
    const shelf = setup();

    shelf.drawing.dirty = true;
    shelf.quit();
    await settled();

    expect(shelf.shown()).toStrictEqual({
      count: 1,
      message: "Your drawing isn't on the shelf yet.",
      state: "asking",
    });

    shelf.hold.answer("cancel");
    await settled();

    expect([shelf.drawing, shelf.finished]).toStrictEqual([
      { dirty: true, saves: 0, saveWorks: true },
      [],
    ]);

    shelf.quit();
    await settled();
    shelf.hold.answer("retry");
    await settled();

    expect([shelf.drawing.saves, shelf.texts(), shelf.finished]).toStrictEqual([
      1,
      ["the drawing"],
      ["quit"],
    ]);
  });

  it.each([
    { answer: "cancel" as const, finished: [] },
    { answer: "discard" as const, finished: ["quit"] },
  ])(
    "stops the drawing's save still on its way when $answer is picked during its Retry",
    async ({ answer, finished }) => {
      const shelf = setup();

      shelf.drawing.dirty = true;
      shelf.quit();
      await settled();

      const release = shelf.holdDrawingSave();

      shelf.hold.answer("retry");
      await settled();
      const during = shelf.drawingStops.map((stop) => stop.aborted);

      shelf.hold.answer(answer);
      const after = shelf.drawingStops.map((stop) => stop.aborted);

      release();
      await settled();

      expect({ after, during, finished: shelf.finished }).toStrictEqual({
        after: [true],
        during: [false],
        finished,
      });
    }
  );

  it("asks in main's dialog when the page reloads before it answers and its last count held an edit", async () => {
    const page = createPageSettle(() => {});
    const questions: NativeQuestion[] = [];
    const finished: string[] = [];

    const hold = createQuitHold({
      ask: async (question) => {
        questions.push(question);
        await Promise.resolve();

        return "cancel";
      },
      flush: async () => await Promise.resolve({ ok: true }),
      pageDrafts: page.drafts,
      prompt: () => {},
      saveDrawing: async () => {
        await Promise.resolve();
      },
      settlePage: page.request,
      setTimer: () => () => {},
      state: () => ({
        drawing: false,
        readOnly: false,
        saveError: null,
        unsaved: 0,
      }),
    });

    page.setDrafts(1);
    hold.request(() => {
      finished.push("quit");
    });
    page.reset();
    await settled();

    expect({ finished, questions }).toStrictEqual({
      finished: [],
      questions: [{ kind: "unconfirmed" }],
    });
  });

  it("drops the drawing's marks on Quit without saving, without saving them", async () => {
    const shelf = setup();

    shelf.drawing.dirty = true;
    shelf.quit();
    await settled();
    shelf.hold.answer("discard");

    expect([shelf.drawing.saves, shelf.finished]).toStrictEqual([0, ["quit"]]);
  });

  it("counts the drawing with the shelf's unsaved items", async () => {
    const shelf = setup();

    shelf.disk.full = true;
    shelf.compose("one");
    shelf.drawing.dirty = true;
    shelf.quit();
    await settled();

    expect(shelf.shown()).toStrictEqual({
      count: 2,
      message: "disk full Your drawing isn't on the shelf yet.",
      state: "asking",
    });
  });

  it("cancels at once while a Retry is still saving, and the Retry's late success doesn't quit", async () => {
    const shelf = setup();

    shelf.disk.full = true;
    shelf.compose("one");
    shelf.quit();
    await settled();

    const release = shelf.holdNextSave();

    shelf.hold.answer("retry");
    await settled();
    shelf.hold.answer("cancel");

    expect(shelf.shown()).toBeNull();

    release({ ok: true });
    await settled();

    expect([shelf.finished, shelf.texts()]).toStrictEqual([[], ["one"]]);
  });

  it("quits without saving at once while a Retry is still saving", async () => {
    const shelf = setup();

    shelf.disk.full = true;
    shelf.compose("one");
    shelf.quit();
    await settled();
    shelf.holdNextSave();
    shelf.hold.answer("retry");
    await settled();
    shelf.hold.answer("discard");

    expect(shelf.finished).toStrictEqual(["quit"]);
  });

  it("asks again when a Retry outlasts the wait", async () => {
    const shelf = setup();

    shelf.disk.full = true;
    shelf.compose("one");
    shelf.quit();
    await settled();
    shelf.holdNextSave();
    shelf.hold.answer("retry");
    await settled();
    shelf.fire(QUIT_WAIT_MS);
    await settled();

    expect([shelf.shown(), shelf.finished]).toStrictEqual([
      {
        count: 1,
        message: "Saving didn't finish in time.",
        state: "stillFailing",
      },
      [],
    ]);
  });
});

/** Timers the test fires itself, with the delays they were set for. */
const handTimer = () => {
  const pending: (() => void)[] = [];
  const delays: number[] = [];

  return {
    delays,
    fire: () => {
      for (const run of pending.splice(0)) {
        run();
      }
    },
    setTimer: (run: () => void, ms: number) => {
      pending.push(run);
      delays.push(ms);

      return () => {
        pending.splice(pending.indexOf(run), 1);
      };
    },
  };
};

/** A write the disk never finishes. */
const hangs = async (): Promise<WriteResult> => {
  await once(new EventTarget(), "never");

  return { ok: true };
};

describe(withinWait, () => {
  it("gives up on a save that hangs once the time is up, and says so", async () => {
    const { delays, fire, setTimer } = handTimer();
    const waiting = withinWait(hangs(), setTimer);

    fire();

    await expect(waiting).resolves.toStrictEqual({
      message: SAVE_TOO_SLOW,
      ok: false,
    });
    expect(delays).toStrictEqual([QUIT_WAIT_MS]);
  });

  it("answers with the save's own outcome when it finishes in time", async () => {
    const { setTimer } = handTimer();
    const full: WriteResult = { message: "The disk is full.", ok: false };

    await expect(
      withinWait(Promise.resolve(full), setTimer)
    ).resolves.toStrictEqual(full);
  });
});

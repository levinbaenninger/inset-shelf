import { once } from "node:events";
import { setImmediate } from "node:timers/promises";

import type { QuitAnswer, QuitPrompt } from "@shared/contracts";
import { emptyShelf, ItemIdSchema, SectionIdSchema } from "@shared/shelf";
import type { ItemId, ShelfDoc } from "@shared/shelf";
import { describe, expect, it } from "vitest";

import { createPageSettle, followPage } from "./page-settle";
import {
  createQuitHold,
  decideQuit,
  nativeDialog,
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

/** The drawing window's marks, why its last save failed, and whether its save reaches the shelf. */
interface FakeDrawing {
  dirty: boolean;
  error: string | null;
  saves: number;
  saveWorks: boolean;
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
    restore: async () => await Promise.resolve(false),
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

  const drawing: FakeDrawing = {
    dirty: false,
    error: null,
    saves: 0,
    saveWorks: true,
  };

  // Each time the quit locked (true) or unlocked the drawing's marks.
  const quitting: boolean[] = [];
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
    quitting: (busy) => {
      if (quitting.at(-1) !== busy) {
        quitting.push(busy);
      }
    },
    setTimer,
    state: () => ({
      drawing: drawing.dirty ? "unsaved" : "none",
      drawingError: drawing.error,
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
    quitting,
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
        drawing: "none",
        drawingError: null,
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
        drawing: "none",
        drawingError: null,
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
        message: "Saving didn’t finish in time.",
      },
      name: "holds when the save is still running at the end of the wait",
      state: {
        drawing: "none",
        drawingError: null,
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
        drawing: "none",
        drawingError: null,
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
        message: "Your drawing isn’t on the shelf yet.",
      },
      name: "holds for a drawing with unsaved marks, on a shelf that is saved",
      state: {
        drawing: "unsaved",
        drawingError: null,
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
        message: "disk full Your drawing isn’t on the shelf yet.",
      },
      name: "counts the drawing as one more change",
      state: {
        drawing: "unsaved",
        drawingError: null,
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
        message: "The disk is full. Your drawing isn’t on the shelf yet.",
      },
      name: "says why the drawing's own save failed",
      state: {
        drawing: "unsaved",
        drawingError: "The disk is full.",
        readOnly: false,
        saveError: null,
        timedOut: false,
        unsaved: 0,
      },
    },
    {
      expected: { count: 2, kind: "hold", message: "The disk is full." },
      name: "counts a drawing already on the shelf with the shelf's items, and says a cause they share once",
      state: {
        drawing: "onShelf",
        drawingError: "The disk is full.",
        readOnly: false,
        saveError: "The disk is full.",
        timedOut: false,
        unsaved: 2,
      },
    },
    {
      expected: {
        count: 1,
        kind: "hold",
        message:
          "Nothing is saved this session. Your drawing isn’t on the shelf yet.",
      },
      name: "holds for a drawing put on a shelf that saves nothing this session",
      state: {
        drawing: "onShelf",
        drawingError: "Nothing is saved this session.",
        readOnly: true,
        saveError: "Nothing is saved this session.",
        timedOut: false,
        unsaved: 1,
      },
    },
  ] as const)("$name", ({ expected, state }) => {
    expect(decideQuit(state)).toStrictEqual(expected);
  });
});

/**
 * The shelf page answers each settle by sending the edits it holds; the
 * first write the quit asks for waits until the test lets it go.
 */
/** `countStuck`: the page answers, but its count stays where it was, as a late message from a dying page can leave it. */
const duringDiskWait = (countStuck = false) => {
  const typed: string[] = [];
  const inMain: string[] = [];
  const onDisk: string[] = [];
  const questions: NativeQuestion[] = [];
  const finished: string[] = [];
  const contents = new EventTarget();
  const disk = new EventTarget();
  let holdNext = true;
  let alive = true;

  const page = createPageSettle((seq) => {
    if (!alive) {
      return;
    }

    inMain.push(...typed.splice(0));

    if (!countStuck) {
      page.setDrafts(0);
    }

    page.answered(seq);
  });

  const hold = createQuitHold({
    ask: async (question) => {
      questions.push(question);
      await Promise.resolve();

      return "cancel";
    },
    flush: async () => {
      if (holdNext) {
        holdNext = false;
        disk.dispatchEvent(new Event("writing"));
        await once(disk, "release");
      }

      onDisk.push(...inMain.splice(0));

      return { ok: true };
    },
    pageDrafts: page.drafts,
    prompt: () => {},
    quitting: () => {},
    saveDrawing: async () => {
      await Promise.resolve();
    },
    settlePage: page.request,
    setTimer: () => () => {},
    state: () => ({
      drawing: "none",
      drawingError: null,
      readOnly: false,
      saveError: null,
      unsaved: inMain.length,
    }),
  });

  followPage(
    {
      on: (event, listener) => {
        contents.addEventListener(event, listener);
      },
    },
    () => {
      page.reset();
      hold.pageEnded();
    }
  );

  return {
    /** The page crashes, reloads or goes away: it answers nothing more. */
    end: (event: string): void => {
      alive = false;
      contents.dispatchEvent(new Event(event));
    },
    finished,
    onDisk,
    page,
    questions,
    /** Quits, and resolves once the first write is on its way. */
    quit: async (): Promise<void> => {
      const writing = once(disk, "writing");

      hold.request(() => {
        finished.push("quit");
      });
      await writing;
    },
    release: (): void => {
      disk.dispatchEvent(new Event("release"));
    },
    /** The user types in the shelf page: an edit main doesn't have yet. */
    type: (text: string): void => {
      typed.push(text);
      page.setDrafts(typed.length);
    },
  };
};

const DISK_FULL_SENTENCE = "The disk is full.";

/**
 * The real PageSettle following a shelf page that shows the quit's prompt,
 * on a disk that refuses every write (`holdWrite`: the first one only once
 * the test lets it go). Main's dialog waits for the test's answer.
 */
const promptOnPage = (options: { readonly holdWrite?: boolean } = {}) => {
  const contents = new EventTarget();
  const disk = new EventTarget();
  const native = new EventTarget();
  const questions: NativeQuestion[] = [];
  const finished: string[] = [];
  const locks: boolean[] = [];
  const timers: { readonly run: () => void; readonly ms: number }[] = [];
  let nativeAnswer: QuitAnswer = "cancel";
  let shown: QuitPrompt | null = null;
  let holdWrite = options.holdWrite === true;
  // A page that ended, or hangs, answers nothing.
  let answers = true;

  const page = createPageSettle((seq) => {
    if (answers) {
      page.answered(seq);
    }
  });

  const hold = createQuitHold({
    ask: async (question) => {
      questions.push(question);
      await once(native, "answer");

      return nativeAnswer;
    },
    flush: async () => {
      if (holdWrite) {
        holdWrite = false;
        await once(disk, "release");
      }

      return { message: DISK_FULL_SENTENCE, ok: false };
    },
    pageDrafts: page.drafts,
    prompt: (prompt) => {
      shown = prompt;
    },
    quitting: (busy) => {
      locks.push(busy);
    },
    saveDrawing: async () => {
      await Promise.resolve();
    },
    settlePage: page.request,
    setTimer: (run, ms) => {
      const timer = { ms, run };

      timers.push(timer);

      return () => {
        timers.splice(timers.indexOf(timer), 1);
      };
    },
    state: () => ({
      drawing: "none",
      drawingError: null,
      readOnly: false,
      saveError: DISK_FULL_SENTENCE,
      unsaved: 1,
    }),
  });

  // As main wires it: each end of the page reaches the settle and the hold.
  followPage(
    {
      on: (event, listener) => {
        contents.addEventListener(event, listener);
      },
    },
    () => {
      page.reset();
      hold.pageEnded();
    }
  );

  return {
    answerNative: (answer: QuitAnswer): void => {
      nativeAnswer = answer;
      native.dispatchEvent(new Event("answer"));
    },
    /** The page loads again and reports its count, as a fresh page does. */
    comeBack: (): void => {
      answers = true;
      page.setDrafts(0);
    },
    /** The page crashes, reloads, navigates or goes away. */
    end: (...events: readonly string[]): void => {
      answers = false;

      for (const event of events) {
        contents.dispatchEvent(new Event(event));
      }
    },
    finished,
    fire: (ms: number): void => {
      for (const timer of timers.filter((candidate) => candidate.ms === ms)) {
        timer.run();
      }
    },
    /** The page stops answering without ending. */
    hang: (): void => {
      answers = false;
    },
    locked: (): boolean | undefined => locks.at(-1),
    questions,
    quit: async (): Promise<void> => {
      hold.request(() => {
        finished.push("quit");
      });
      await settled();
    },
    release: (): void => {
      disk.dispatchEvent(new Event("release"));
    },
    shown: (): QuitPrompt | null => shown,
  };
};

const HELD_ON_FULL_DISK: QuitPrompt = {
  count: 1,
  message: DISK_FULL_SENTENCE,
  state: "asking",
};

describe("the quit hold", () => {
  it.each([
    "render-process-gone",
    "did-navigate",
    "did-start-loading",
    "destroyed",
  ])(
    "asks in main's dialog, with the same count, when the page showing the quit prompt ends (%s), and Cancel unlocks the drawing (Sol round 8)",
    async (end) => {
      const app = promptOnPage();

      await app.quit();
      const before = app.shown();

      // A crash reloads the page, so its events come in a burst.
      app.end(end, "did-start-loading", "did-navigate");
      await settled();

      const asked = {
        locked: app.locked(),
        questions: [...app.questions],
        shown: app.shown(),
      };

      app.answerNative("cancel");
      await settled();

      expect({
        after: { finished: app.finished, locked: app.locked() },
        asked,
        before,
      }).toStrictEqual({
        after: { finished: [], locked: false },
        asked: {
          locked: true,
          questions: [{ kind: "gone", prompt: HELD_ON_FULL_DISK }],
          shown: null,
        },
        before: HELD_ON_FULL_DISK,
      });
    }
  );

  it("quits on Quit anyway in main's dialog after the page showing the prompt ended", async () => {
    const app = promptOnPage();

    await app.quit();
    app.end("render-process-gone");
    await settled();
    app.answerNative("discard");
    await settled();

    expect(app.finished).toStrictEqual(["quit"]);
  });

  it("asks in the page that came back on Wait in main's dialog", async () => {
    const app = promptOnPage();

    await app.quit();
    app.end("render-process-gone", "did-start-loading", "did-navigate");
    app.comeBack();
    await settled();
    app.answerNative("retry");
    await settled();

    expect({
      finished: app.finished,
      questions: app.questions.length,
      shown: app.shown(),
    }).toStrictEqual({
      finished: [],
      questions: 1,
      shown: HELD_ON_FULL_DISK,
    });
  });

  it("asks with main's Retry dialog on Wait when no page came back, and never quits on its own", async () => {
    const app = promptOnPage();

    await app.quit();
    app.end("render-process-gone");
    await settled();
    app.answerNative("retry");
    await settled();

    expect({
      finished: app.finished,
      questions: app.questions,
      shown: app.shown(),
    }).toStrictEqual({
      finished: [],
      questions: [
        { kind: "gone", prompt: HELD_ON_FULL_DISK },
        { kind: "held", prompt: HELD_ON_FULL_DISK },
      ],
      shown: null,
    });
  });

  it("asks in main's dialog when the page ends before it answers, holding nothing, and the write fails", async () => {
    const app = promptOnPage();

    app.hang();
    await app.quit();
    app.end("render-process-gone");
    await settled();

    expect({
      finished: app.finished,
      questions: app.questions,
      shown: app.shown(),
    }).toStrictEqual({
      finished: [],
      questions: [{ kind: "gone", prompt: HELD_ON_FULL_DISK }],
      shown: null,
    });
  });

  it("asks in main's dialog when the page that answered ends during the disk wait and the write fails", async () => {
    const app = promptOnPage({ holdWrite: true });

    await app.quit();
    app.end("render-process-gone");
    app.release();
    await settled();

    expect({ questions: app.questions, shown: app.shown() }).toStrictEqual({
      questions: [{ kind: "gone", prompt: HELD_ON_FULL_DISK }],
      shown: null,
    });
  });

  it("brings the prompt back on a second quit while its page answers, and asks in main's dialog once it no longer does", async () => {
    const app = promptOnPage();

    await app.quit();
    await app.quit();
    const live = { questions: app.questions.length, shown: app.shown() };

    app.hang();
    await app.quit();
    const waiting = app.questions.length;

    app.fire(QUIT_WAIT_MS);
    await settled();

    expect({ live, questions: app.questions, waiting }).toStrictEqual({
      live: { questions: 0, shown: HELD_ON_FULL_DISK },
      questions: [{ kind: "gone", prompt: HELD_ON_FULL_DISK }],
      waiting: 0,
    });
  });

  it("asks in main's dialog on a second quit after the page showing the prompt went away unheard (Sol's round 8 probe)", async () => {
    const questions: NativeQuestion[] = [];

    const page = createPageSettle((seq) => {
      page.answered(seq);
    });

    const hold = createQuitHold({
      ask: async (question) => {
        questions.push(question);
        await Promise.resolve();

        return "cancel";
      },
      flush: async () =>
        await Promise.resolve({ message: DISK_FULL_SENTENCE, ok: false }),
      pageDrafts: page.drafts,
      prompt: () => {},
      quitting: () => {},
      saveDrawing: async () => {
        await Promise.resolve();
      },
      settlePage: page.request,
      setTimer: () => () => {},
      state: () => ({
        drawing: "none",
        drawingError: null,
        readOnly: false,
        saveError: DISK_FULL_SENTENCE,
        unsaved: 1,
      }),
    });

    hold.request(() => {});
    await settled();
    page.reset();
    hold.request(() => {});
    await settled();

    expect(questions).toStrictEqual([
      { kind: "gone", prompt: HELD_ON_FULL_DISK },
    ]);
  });

  it("says in main's dialog how many changes are held and that the shelf window stopped responding", () => {
    expect(
      nativeDialog(
        {
          kind: "gone",
          prompt: {
            count: 2,
            message: DISK_FULL_SENTENCE,
            state: "stillFailing",
          },
        },
        "Inset Shelf"
      )
    ).toStrictEqual({
      buttons: ["Wait", "Quit anyway", "Cancel"],
      detail:
        "Still not saved. The disk is full. The shelf window stopped responding, so Inset Shelf asks here. Wait asks again, in the shelf window if it’s back.",
      message: "2 changes couldn’t be saved",
    });
  });

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

  it("locks the drawing from the first wait while the prompt, a Retry or main's dialog is up, and unlocks it on Cancel", async () => {
    const shelf = setup();

    shelf.disk.full = true;
    shelf.drawing.dirty = true;
    shelf.quit();
    const waiting = [...shelf.quitting];

    await settled();
    const held = [...shelf.quitting];

    shelf.hold.answer("retry");
    await settled();
    const retried = [...shelf.quitting];

    shelf.hold.answer("cancel");

    expect({
      cancelled: shelf.quitting,
      held,
      retried,
      waiting,
    }).toStrictEqual({
      cancelled: [true, false],
      held: [true],
      retried: [true],
      waiting: [true],
    });
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
      message: "Saving didn’t finish in time.",
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
      message: "Your drawing isn’t on the shelf yet.",
      state: "asking",
    });

    shelf.hold.answer("cancel");
    await settled();

    expect([shelf.drawing, shelf.finished]).toStrictEqual([
      { dirty: true, error: null, saves: 0, saveWorks: true },
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

  it.each(["render-process-gone", "did-navigate", "did-start-loading"])(
    "asks in main's dialog when the page ends (%s) before it answers, even once a new page has loaded, until that page reports its own count",
    async (end) => {
      const page = createPageSettle(() => {});
      const contents = new EventTarget();
      const questions: NativeQuestion[] = [];
      const finished: string[] = [];

      followPage(
        {
          on: (event, listener) => {
            contents.addEventListener(event, listener);
          },
        },
        page.reset
      );

      const hold = createQuitHold({
        ask: async (question) => {
          questions.push(question);
          await Promise.resolve();

          return "cancel";
        },
        flush: async () => await Promise.resolve({ ok: true }),
        pageDrafts: page.drafts,
        prompt: () => {},
        quitting: () => {},
        saveDrawing: async () => {
          await Promise.resolve();
        },
        settlePage: page.request,
        setTimer: () => () => {},
        state: () => ({
          drawing: "none",
          drawingError: null,
          readOnly: false,
          saveError: null,
          unsaved: 0,
        }),
      });

      const quit = async (): Promise<void> => {
        hold.request(() => {
          finished.push("quit");
        });
        await settled();
      };

      page.setDrafts(1);
      await quit();
      contents.dispatchEvent(new Event(end));
      // Electron loads the page again after a crash or reload.
      contents.dispatchEvent(new Event("did-finish-load"));
      await settled();
      await quit();
      contents.dispatchEvent(new Event("destroyed"));
      await settled();

      const before = { finished: [...finished], questions: [...questions] };

      // The new page says it holds nothing.
      page.setDrafts(0);
      await quit();
      page.answered(3);
      await settled();

      expect({ after: finished, before }).toStrictEqual({
        after: ["quit"],
        before: {
          finished: [],
          questions: [{ kind: "unconfirmed" }, { kind: "unconfirmed" }],
        },
      });
    }
  );

  it.each([
    "render-process-gone",
    "did-navigate",
    "did-start-loading",
    "destroyed",
  ])(
    "asks in main's dialog when the page ends (%s) during the disk wait holding an edit it hadn't sent (red-team round 8)",
    async (end) => {
      const app = duringDiskWait();

      await app.quit();
      app.type("typed during the wait");
      app.end(end);
      app.release();
      await settled();

      expect({
        drafts: app.page.drafts(),
        finished: app.finished,
        questions: app.questions,
      }).toStrictEqual({
        drafts: 1,
        finished: [],
        questions: [{ kind: "unconfirmed" }],
      });
    }
  );

  it("asks in main's dialog, after a few rounds, when the page answers but its count never falls to 0", async () => {
    const app = duringDiskWait(true);

    await app.quit();
    app.type("typed during the wait");
    app.release();
    await settled();

    expect({
      finished: app.finished,
      questions: app.questions,
    }).toStrictEqual({
      finished: [],
      questions: [{ kind: "unconfirmed" }],
    });
  });

  it("asks the page again for an edit typed during the disk wait, and writes it before it quits", async () => {
    const app = duringDiskWait();

    await app.quit();
    app.type("typed during the wait");
    app.release();
    await settled();

    expect({
      finished: app.finished,
      onDisk: app.onDisk,
      questions: app.questions,
    }).toStrictEqual({
      finished: ["quit"],
      onDisk: ["typed during the wait"],
      questions: [],
    });
  });

  it("explains that the shelf window stopped responding when it asks", () => {
    expect(nativeDialog({ kind: "unconfirmed" }, "Inset Shelf")).toStrictEqual({
      buttons: ["Wait", "Quit anyway", "Cancel"],
      detail:
        "The shelf window stopped responding, so an edit you were typing there may not be saved. Wait gives it more time to answer.",
      message: "Inset Shelf couldn’t confirm your changes were saved",
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
      message: "disk full Your drawing isn’t on the shelf yet.",
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
        message: "Saving didn’t finish in time.",
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

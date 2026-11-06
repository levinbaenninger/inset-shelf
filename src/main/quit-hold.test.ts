import { once } from "node:events";
import { setImmediate } from "node:timers/promises";

import type { QuitPrompt } from "@shared/contracts";
import { emptyShelf, ItemIdSchema, SectionIdSchema } from "@shared/shelf";
import type { ItemId, ShelfDoc } from "@shared/shelf";
import { describe, expect, it } from "vitest";

import { createQuitHold, decideQuit, QUIT_WAIT_MS } from "./quit-hold";
import { createShelfController } from "./shelf-controller";
import type { WriteResult } from "./shelf-store";

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

  const hold = createQuitHold({
    flush: controller.flush,
    prompt: (prompt) => {
      shown = prompt;

      if (prompt !== null) {
        asked.push(prompt);
      }
    },
    setTimer,
    state: () => ({
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
    asked,
    compose,
    controller,
    disk,
    finished,
    fire,
    hold,
    holdNextSave,
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
      state: { readOnly: false, saveError: null, timedOut: false, unsaved: 0 },
    },
    {
      expected: { count: 2, kind: "hold", message: "disk full" },
      name: "holds with the save's error",
      state: {
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
        readOnly: true,
        saveError: "Nothing is saved this session.",
        timedOut: false,
        unsaved: 3,
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
});

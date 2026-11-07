import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { setImmediate } from "node:timers/promises";
import { compileFunction } from "node:vm";

import type { QuitAnswer, QuitPrompt } from "@shared/contracts";
import { describe, expect, it, vi } from "vitest";

import { createPageSettle, followPage } from "./page-settle";
import { createQuitHold } from "./quit-hold";
import type { NativeQuestion } from "./quit-hold";
import type { ShelfController } from "./shelf-controller";
import { createShelfWindow } from "./shelf-window";
import type { ShelfWindow } from "./shelf-window";

// Electron's native side doesn't load under Node. Only it is faked: a window whose methods throw once it is destroyed, as Electron's do.
// oxlint-disable-next-line anti-slop/no-module-mocking, vitest/prefer-import-in-mock -- createShelfWindow builds its own BrowserWindow, and the fake has only what it calls, not Electron's full types.
vi.mock("electron", () => {
  class FakeWindow extends EventTarget {
    readonly webContents = {
      emit: (name: string): boolean =>
        this.pageEvents.dispatchEvent(new Event(name)),
      on: (name: string, listener: () => void): void => {
        this.pageEvents.addEventListener(name, listener);
      },
      setWindowOpenHandler: (): void => undefined,
    };

    private readonly pageEvents = new EventTarget();

    private dead = false;
    private visible = false;

    destroy(): void {
      this.dead = true;
    }

    focus(): void {
      this.alive();
    }

    getBounds() {
      this.alive();

      return { height: 600, width: 360, x: 0, y: 0 };
    }

    isDestroyed(): boolean {
      return this.dead;
    }

    on(name: string, listener: () => void): void {
      this.addEventListener(name, listener);
    }

    isVisible(): boolean {
      this.alive();

      return this.visible;
    }

    setAlwaysOnTop(): void {
      this.alive();
    }

    setBounds(): void {
      this.alive();
    }

    setVisibleOnAllWorkspaces(): void {
      this.alive();
    }

    show(): void {
      this.alive();
      this.visible = true;
    }

    private alive(): void {
      if (this.dead) {
        throw new TypeError("Object has been destroyed");
      }
    }
  }

  const workArea = { height: 900, width: 1400, x: 0, y: 0 };

  return {
    app: {
      hide: (): void => undefined,
      isPackaged: true,
      show: (): void => undefined,
    },
    BrowserWindow: FakeWindow,
    screen: {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayMatching: () => ({ workArea }),
      getDisplayNearestPoint: () => ({ workArea }),
    },
    session: {},
  };
});

const DISK_FULL_SENTENCE = "The disk is full.";

type PromptCallback = (prompt: QuitPrompt | null) => void;

type PromptFactory = (
  controller: Pick<ShelfController, "setStatus">,
  shelf: ShelfWindow,
  showShelf: () => Promise<void>,
  isMac: boolean
) => PromptCallback;

/** Main's own `prompt` callback for the quit hold, read from index.ts so the test runs the code main runs. */
const mainPrompt = async (shelf: ShelfWindow): Promise<PromptCallback> => {
  const source = await readFile(new URL("index.ts", import.meta.url), "utf-8");

  const callback =
    /\n {4}prompt: (?<body>\(quitPrompt\) => \{\n[\s\S]*?\n {4}\}),\n {4}quitting:/u.exec(
      source
    )?.groups?.body;

  if (callback === undefined) {
    throw new Error("index.ts no longer has the quit hold's prompt callback");
  }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SAFETY: the source is the arrow function index.ts hands the quit hold, over the four names it uses.
  const factory = compileFunction(`return ${callback};`, [
    "controller",
    "shelf",
    "showShelf",
    "isMac",
  ]) as PromptFactory;

  return factory(
    { setStatus: (): void => undefined },
    shelf,
    async () => {
      await Promise.resolve();
      shelf.show(null);
    },
    true
  );
};

/** Lets every pending dialog answer and write run. */
const settled = async (): Promise<void> => {
  await setImmediate();
  await setImmediate();
};

/**
 * The real shelf window, settle and quit hold, wired as main wires them,
 * holding one change the full disk refuses. Main's dialog waits for the
 * test's answer.
 */
const shelfOnFullDisk = async () => {
  const shelf = createShelfWindow({
    preload: "",
    url: "inset://app/shelf.html",
  });

  const native = new EventTarget();
  const questions: NativeQuestion[] = [];
  const locks: boolean[] = [];
  const finished: string[] = [];
  let nativeAnswer: QuitAnswer = "cancel";

  const page = createPageSettle((seq) => {
    page.answered(seq);
  });

  const hold = createQuitHold({
    ask: async (question) => {
      questions.push(question);
      await once(native, "answer");

      return nativeAnswer;
    },
    flush: async () =>
      await Promise.resolve({ message: DISK_FULL_SENTENCE, ok: false }),
    pageDrafts: page.drafts,
    prompt: await mainPrompt(shelf),
    quitting: (busy) => {
      locks.push(busy);
    },
    saveDrawing: async () => {
      await Promise.resolve();
    },
    settlePage: page.request,
    setTimer: () => (): void => undefined,
    state: () => ({
      drawing: "none",
      drawingError: null,
      readOnly: false,
      saveError: DISK_FULL_SENTENCE,
      unsaved: 1,
    }),
  });

  followPage(shelf.webContents, () => {
    page.reset();
    hold.pageEnded();
  });

  const ends = {
    page: (): void => {
      shelf.webContents.emit("destroyed");
    },
    window: (): void => {
      shelf.dialogParent.destroy();
    },
  };

  return {
    answerNative: async (answer: QuitAnswer): Promise<void> => {
      nativeAnswer = answer;
      native.dispatchEvent(new Event("answer"));
      await settled();
    },
    end: async (part: keyof typeof ends): Promise<void> => {
      ends[part]();
      await settled();
    },
    finished,
    locked: (): boolean | undefined => locks.at(-1),
    questions,
    quit: async (): Promise<void> => {
      hold.request(() => {
        finished.push("quit");
      });
      await settled();
    },
  };
};

describe(createShelfWindow, () => {
  it.each([
    ["the window, then its page", "window", "page"],
    ["its page, then the window", "page", "window"],
  ] as const)(
    "keeps main's dialog asking when the window showing the quit prompt is destroyed (%s), and Cancel unlocks the drawing (red team round 9)",
    async (_order, first, second) => {
      const app = await shelfOnFullDisk();

      await app.quit();
      await app.end(first);
      await app.end(second);
      await app.answerNative("retry");
      await app.answerNative("retry");
      await app.answerNative("cancel");

      expect({
        finished: app.finished,
        locked: app.locked(),
        questions: app.questions,
      }).toStrictEqual({
        finished: [],
        locked: false,
        questions: [
          {
            kind: "gone",
            prompt: { count: 1, message: DISK_FULL_SENTENCE, state: "asking" },
          },
          {
            kind: "held",
            prompt: { count: 1, message: DISK_FULL_SENTENCE, state: "asking" },
          },
          {
            kind: "held",
            prompt: {
              count: 1,
              message: DISK_FULL_SENTENCE,
              state: "stillFailing",
            },
          },
        ],
      });
    }
  );
});

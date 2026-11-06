import { once } from "node:events";

import { quitTitle } from "@shared/contracts";
import type { QuitAnswer, QuitPrompt } from "@shared/contracts";

import { SAVE_FAILED } from "./shelf-controller";
import type { WriteResult } from "./shelf-store";

/** How long quitting waits for the shelf page to answer, and then for the disk, before it asks (Round 7). */
export const QUIT_WAIT_MS = 3000;

export const SAVE_TOO_SLOW = "Saving didn't finish in time.";

export const DRAWING_UNSAVED = "Your drawing isn't on the shelf yet.";

/**
 * A save the user waits on outside quitting (the banner's Retry, a copy's
 * wait) gives up after the same limit and says so, so neither ever hangs.
 */
export const withinWait = async (
  save: Promise<WriteResult>,
  setTimer: (run: () => void, ms: number) => () => void
): Promise<WriteResult> => {
  const timer = new EventTarget();

  const cancelTimer = setTimer(() => {
    timer.dispatchEvent(new Event("late"));
  }, QUIT_WAIT_MS);

  const late = (async (): Promise<WriteResult> => {
    await once(timer, "late");

    return { message: SAVE_TOO_SLOW, ok: false };
  })();

  try {
    return await Promise.race([save, late]);
  } finally {
    cancelTimer();
  }
};

/** Flushes in a row while changes keep arriving during the wait; the time limit ends it anyway. */
const SETTLE_ROUNDS = 5;

/** Everything a quit could lose, once the wait is over. */
export interface QuitState {
  /** Shelf items the disk doesn't hold as they are. */
  readonly unsaved: number;
  /** Nothing is saved this session, so there is nothing to wait for or retry on the shelf. */
  readonly readOnly: boolean;
  readonly saveError: string | null;
  /** New Drawing or Annotate holds marks that aren't on the shelf. */
  readonly drawing: boolean;
  readonly timedOut: boolean;
}

export type QuitDecision =
  | { readonly kind: "quit" }
  | { readonly kind: "hold"; readonly count: number; readonly message: string };

/** Why the shelf isn't saved, when it isn't. */
const shelfCause = (state: QuitState, shelf: number): string | null => {
  if (state.timedOut) {
    return SAVE_TOO_SLOW;
  }

  return shelf > 0 ? (state.saveError ?? SAVE_FAILED) : null;
};

export const decideQuit = (state: QuitState): QuitDecision => {
  const shelf = state.readOnly ? 0 : state.unsaved;
  const count = shelf + (state.drawing ? 1 : 0);

  if (count === 0) {
    return { kind: "quit" };
  }

  const cause = shelfCause(state, shelf);

  return {
    count,
    kind: "hold",
    message: [cause, state.drawing ? DRAWING_UNSAVED : null]
      .filter((part) => part !== null)
      .join(" "),
  };
};

/**
 * What main asks in a dialog of its own when the shelf page can't: it
 * didn't confirm it had sent its edits (Wait, Quit anyway, Cancel), or it
 * didn't answer and the quit is held (Retry, Quit without saving, Cancel).
 * Either way the first button answers "retry", the second "discard".
 */
export type NativeQuestion =
  | { readonly kind: "unconfirmed" }
  | { readonly kind: "held"; readonly prompt: QuitPrompt };

/** Main's dialog for a question: its title, its text, and its buttons, which answer retry, discard and cancel in that order. */
export const nativeDialog = (
  question: NativeQuestion,
  appName: string
): {
  readonly message: string;
  readonly detail: string;
  readonly buttons: readonly [string, string, string];
} =>
  question.kind === "unconfirmed"
    ? {
        buttons: ["Wait", "Quit anyway", "Cancel"],
        detail:
          "The shelf window didn't answer in time, so an edit you were typing may not be saved. Wait gives it longer.",
        message: `${appName} couldn't confirm your changes were saved`,
      }
    : {
        buttons: ["Retry", "Quit without saving", "Cancel"],
        detail:
          question.prompt.state === "stillFailing"
            ? `Still not saved. ${question.prompt.message}`
            : question.prompt.message,
        message: quitTitle(question.prompt.count),
      };

export const NATIVE_ANSWERS: readonly QuitAnswer[] = [
  "retry",
  "discard",
  "cancel",
];

export interface QuitHoldDeps {
  /** Asks the shelf page to send every edit it holds; true once it says it has, false when it can't answer. */
  readonly settlePage: () => Promise<boolean>;
  /** The page's last word on how many edits it holds that main doesn't have yet. */
  readonly pageDrafts: () => number;
  readonly flush: () => Promise<WriteResult>;
  /**
   * Retry: the drawing window saves its marks to the shelf; resolves once
   * it has. Cancel or Quit without saving aborts `stop`, so a save still on
   * its way leaves the window and its marks as they are.
   */
  readonly saveDrawing: (stop: AbortSignal) => Promise<void>;
  readonly state: () => Omit<QuitState, "timedOut">;
  readonly setTimer: (run: () => void, ms: number) => () => void;
  /** Shows the prompt in the shelf, or takes it away. */
  readonly prompt: (prompt: QuitPrompt | null) => void;
  readonly ask: (question: NativeQuestion) => Promise<QuitAnswer>;
}

export interface QuitHold {
  /**
   * Quit or restart to update: waits briefly for the page and the disk,
   * then runs `finish`, or holds it and asks. The latest request's `finish`
   * is the one that runs.
   */
  readonly request: (finish: () => void) => void;
  /** The shelf prompt's answer; Cancel and Quit without saving act even while a Retry runs. */
  readonly answer: (answer: QuitAnswer) => void;
  /** `finish` has run, so a quit that comes back through the OS goes straight on. */
  readonly exiting: () => boolean;
}

type Phase =
  | { readonly kind: "idle" }
  /** The first wait shows nothing; a Retry keeps its prompt up. */
  | { readonly kind: "waiting"; readonly prompt: QuitPrompt | null }
  | { readonly kind: "held"; readonly prompt: QuitPrompt }
  /** Main's own dialog is up. */
  | { readonly kind: "asking" }
  | { readonly kind: "exiting" };

const ignore = (): void => undefined;

const LATE = Symbol("late");

export const createQuitHold = (deps: QuitHoldDeps): QuitHold => {
  let phase: Phase = { kind: "idle" };
  let finish = ignore;
  // Each wait's number: a wait that ends after Cancel, or after a newer one started, decides nothing.
  let attempt = 0;
  let drawingSave = new AbortController();

  const enter = (next: Phase): void => {
    phase = next;
    deps.prompt(
      next.kind === "waiting" || next.kind === "held" ? next.prompt : null
    );
  };

  /** Resolves with the task's value, or LATE once the wait is up; it never waits longer. */
  const within = async <T>(task: Promise<T>): Promise<T | typeof LATE> => {
    const timer = new EventTarget();

    const cancelTimer = deps.setTimer(() => {
      timer.dispatchEvent(new Event("late"));
    }, QUIT_WAIT_MS);

    const late = (async (): Promise<typeof LATE> => {
      await once(timer, "late");

      return LATE;
    })();

    try {
      return await Promise.race([task, late]);
    } finally {
      cancelTimer();
    }
  };

  // A change made during the wait is written too, before the quit goes on.
  const settle = async (): Promise<void> => {
    for (let round = 0; round < SETTLE_ROUNDS; round += 1) {
      // oxlint-disable-next-line no-await-in-loop -- one write after another, on purpose.
      const result = await deps.flush();

      if (!result.ok || deps.state().unsaved === 0) {
        return;
      }
    }
  };

  const exit = (): void => {
    drawingSave.abort();
    enter({ kind: "exiting" });
    finish();
  };

  const cancel = (): void => {
    attempt += 1;
    drawingSave.abort();
    finish = ignore;
    enter({ kind: "idle" });
  };

  /** Main's own dialog; null when the quit went on meanwhile. */
  const askNatively = async (
    question: NativeQuestion
  ): Promise<QuitAnswer | null> => {
    enter({ kind: "asking" });

    let answer: QuitAnswer;

    try {
      answer = await deps.ask(question);
    } catch {
      answer = "cancel";
    }

    return phase.kind === "asking" ? answer : null;
  };

  const wait = (retried: QuitPrompt | null): void => {
    // Main's dialog in place of the page's prompt: Wait or Retry waits again.
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- it calls wait, so it lives in it.
    const ask = async (question: NativeQuestion): Promise<void> => {
      const answer = await askNatively(question);

      if (answer === "retry") {
        wait(question.kind === "held" ? question.prompt : null);
      } else if (answer === "discard") {
        exit();
      } else if (answer === "cancel") {
        cancel();
      }
    };

    attempt += 1;
    const mine = attempt;

    enter({
      kind: "waiting",
      prompt: retried === null ? null : { ...retried, state: "retrying" },
    });

    const live = (): boolean => mine === attempt && phase.kind === "waiting";

    void (async () => {
      const answered = await within(deps.settlePage().catch(() => false));

      if (!live()) {
        return;
      }

      // A page that didn't answer is never taken as saved, unless its last word was that it holds nothing.
      const pageAnswered = answered === true;

      if (!pageAnswered && deps.pageDrafts() > 0) {
        void ask({ kind: "unconfirmed" });

        return;
      }

      const saving = (async () => {
        if (retried !== null && deps.state().drawing) {
          drawingSave = new AbortController();
          await deps.saveDrawing(drawingSave.signal);
        }

        await settle();
      })().catch(ignore);

      const saved = await within(saving);

      if (!live()) {
        return;
      }

      const decision = decideQuit({
        ...deps.state(),
        timedOut: saved === LATE,
      });

      if (decision.kind === "quit") {
        exit();

        return;
      }

      const prompt: QuitPrompt = {
        count: decision.count,
        message: decision.message,
        state: retried === null ? "asking" : "stillFailing",
      };

      // The page didn't answer, so it can't show the prompt either.
      if (pageAnswered) {
        enter({ kind: "held", prompt });
      } else {
        void ask({ kind: "held", prompt });
      }
    })();
  };

  return {
    answer: (answer) => {
      const shown =
        phase.kind === "held" ||
        (phase.kind === "waiting" && phase.prompt !== null);

      if (!shown) {
        return;
      }

      if (answer === "retry") {
        if (phase.kind === "held") {
          wait(phase.prompt);
        }
      } else if (answer === "discard") {
        exit();
      } else {
        cancel();
      }
    },
    exiting: () => phase.kind === "exiting",
    request: (next) => {
      if (phase.kind === "exiting") {
        return;
      }

      finish = next;

      if (phase.kind === "idle") {
        wait(null);
      } else if (phase.kind === "held") {
        // Quit again while asked: the prompt comes back to the front.
        enter(phase);
      }
    },
  };
};

import type { QuitAnswer, QuitPrompt } from "@shared/contracts";

import type { WriteResult } from "./shelf-store";

/** How long quitting waits for the shelf to reach the disk before it asks. */
export const QUIT_WAIT_MS = 3000;

export const SAVE_TOO_SLOW = "Saving didn't finish in time.";

const SAVE_FAILED = "The shelf could not be saved to disk.";

/** The shelf once the wait is over. */
export interface QuitState {
  readonly unsaved: number;
  /** Nothing is saved this session, so there is nothing to wait for or retry. */
  readonly readOnly: boolean;
  readonly saveError: string | null;
  readonly timedOut: boolean;
}

export type QuitDecision =
  | { readonly kind: "quit" }
  | { readonly kind: "hold"; readonly count: number; readonly message: string };

export const decideQuit = (state: QuitState): QuitDecision => {
  if (state.readOnly || state.unsaved === 0) {
    return { kind: "quit" };
  }

  return {
    count: state.unsaved,
    kind: "hold",
    message: state.timedOut ? SAVE_TOO_SLOW : (state.saveError ?? SAVE_FAILED),
  };
};

export interface QuitHoldDeps {
  readonly flush: () => Promise<WriteResult>;
  readonly state: () => Omit<QuitState, "timedOut">;
  readonly setTimer: (run: () => void, ms: number) => () => void;
  /** Shows the prompt in the shelf, or takes it away. */
  readonly prompt: (prompt: QuitPrompt | null) => void;
}

export interface QuitHold {
  /**
   * Quit or restart to update: waits briefly for the disk, then runs
   * `finish`, or holds it and asks. The latest request's `finish` is the one
   * that runs.
   */
  readonly request: (finish: () => void) => void;
  /** The prompt's answer; ignored unless the prompt is waiting for one. */
  readonly answer: (answer: QuitAnswer) => void;
  /** `finish` has run, so a quit that comes back through the OS goes straight on. */
  readonly exiting: () => boolean;
}

type Phase =
  | { readonly kind: "idle" }
  /** The first wait shows nothing; a Retry keeps its prompt up. */
  | { readonly kind: "saving"; readonly prompt: QuitPrompt | null }
  | { readonly kind: "held"; readonly prompt: QuitPrompt }
  | { readonly kind: "exiting" };

const ignore = (): void => undefined;

export const createQuitHold = (deps: QuitHoldDeps): QuitHold => {
  let phase: Phase = { kind: "idle" };
  let finish = ignore;
  // Each wait's number; a wait that ends after a newer one started is ignored.
  let attempt = 0;

  const enter = (next: Phase): void => {
    phase = next;
    deps.prompt(
      next.kind === "saving" || next.kind === "held" ? next.prompt : null
    );
  };

  // A change made during the wait is written too, before the quit goes on.
  const settle = async (): Promise<void> => {
    const result = await deps.flush();

    if (result.ok && deps.state().unsaved > 0) {
      await settle();
    }
  };

  const wait = (retried: QuitPrompt | null): void => {
    attempt += 1;
    const mine = attempt;
    let timedOut = false;
    let cancelTimer = ignore;

    enter({
      kind: "saving",
      prompt: retried === null ? null : { ...retried, state: "retrying" },
    });

    const decide = (): void => {
      if (mine !== attempt || phase.kind !== "saving") {
        return;
      }

      cancelTimer();
      const decision = decideQuit({ ...deps.state(), timedOut });

      if (decision.kind === "quit") {
        enter({ kind: "exiting" });
        finish();

        return;
      }

      enter({
        kind: "held",
        prompt: {
          count: decision.count,
          message: decision.message,
          state: retried === null ? "asking" : "stillFailing",
        },
      });
    };

    cancelTimer = deps.setTimer(() => {
      timedOut = true;
      decide();
    }, QUIT_WAIT_MS);

    void (async () => {
      try {
        await settle();
      } catch {
        // The shelf's state says what is still unsaved.
      }

      decide();
    })();
  };

  return {
    answer: (answer) => {
      if (phase.kind !== "held") {
        return;
      }

      switch (answer) {
        case "retry": {
          wait(phase.prompt);
          break;
        }

        case "discard": {
          enter({ kind: "exiting" });
          finish();
          break;
        }

        case "cancel": {
          finish = ignore;
          enter({ kind: "idle" });
          break;
        }

        default: {
          break;
        }
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

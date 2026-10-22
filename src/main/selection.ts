/** S is whatever the clipboard returns as a full copy of its content; it only goes back in. */
export interface SelectionDeps<S> {
  readonly snapshot: () => Promise<S>;
  readonly restore: (snapshot: S) => Promise<void>;
  readonly clear: () => void;
  readonly readText: () => Promise<string>;
  /** Sends Cmd+C to the app in front. */
  readonly copy: () => void;
  readonly wait: (ms: number) => Promise<void>;
}

const POLL_MS = 25;
const POLL_LIMIT = 20;

export type SelectionResult =
  | { readonly kind: "text"; readonly text: string; readonly restored: boolean }
  | { readonly kind: "none"; readonly restored: boolean };

/** Waits for the copied text to arrive, up to `attempts` short waits. */
const pollText = async <S>(
  deps: SelectionDeps<S>,
  attempts: number
): Promise<string> => {
  await deps.wait(POLL_MS);

  const text = await deps.readText();

  return text !== "" || attempts <= 1
    ? text
    : await pollText(deps, attempts - 1);
};

/**
 * Copies the selection of the app in front and puts the clipboard back as it was.
 * The clipboard is cleared first, so "nothing copied" is told apart from
 * "the selection equals what was already on the clipboard".
 */
export const captureSelection = async <S>(
  deps: SelectionDeps<S>
): Promise<SelectionResult> => {
  const saved = await deps.snapshot();

  deps.clear();
  deps.copy();

  const text = await pollText(deps, POLL_LIMIT);

  let restored = true;

  try {
    await deps.restore(saved);
  } catch {
    restored = false;
  }

  return text.trim() === ""
    ? { kind: "none", restored }
    : { kind: "text", restored, text };
};

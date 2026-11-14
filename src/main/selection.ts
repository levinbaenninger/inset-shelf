/** S is whatever the clipboard returns as a full copy of its content; it only goes back in. */
export interface SelectionDeps<S> {
  readonly snapshot: () => Promise<S>;
  readonly restore: (snapshot: S) => Promise<void>;
  readonly clear: () => void;
  readonly readText: () => Promise<string>;
  /** The HTML the app copied next to the text, or "" when it copied none. */
  readonly readHtml: () => Promise<string>;
  /** The address of the page the text was copied from, as browsers note it beside the text, or "". */
  readonly readSource: () => Promise<string>;
  /** Sends the copy shortcut to the app in front. */
  readonly copy: () => void;
  /** Whether the clipboard holds that snapshot's content again: put back, or still empty for an empty one. */
  readonly holds: (snapshot: S) => Promise<boolean>;
  /** Whether every format still matches the capture, with no newer copy to preserve. */
  readonly unchanged: (snapshot: S) => Promise<boolean>;
  readonly wait: (ms: number) => Promise<void>;
}

const POLL_MS = 25;
const POLL_LIMIT = 20;

/**
 * While another app has the clipboard open, Windows lets a write do nothing
 * without an error: the clipboard keeps the copied selection, or stays empty.
 * Putting it back is checked, and tried again for a little over two seconds
 * before giving up, unless a newer copy has superseded the capture.
 */
const RESTORE_ATTEMPTS = 10;
const RESTORE_RETRY_MS = 250;

export type SelectionResult =
  | {
      readonly kind: "text";
      readonly text: string;
      /** Null when the app put no HTML on the clipboard. */
      readonly html: string | null;
      /** Null when the app noted no page. */
      readonly source: string | null;
      readonly restored: boolean;
    }
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

/** Puts the clipboard back, and checks it took: true once it holds what it held. */
const putBack = async <S>(
  deps: SelectionDeps<S>,
  saved: S,
  copied: S | null,
  attempts: number
): Promise<boolean> => {
  let wrote = true;

  try {
    await deps.restore(saved);
  } catch {
    wrote = false;
  }

  if (wrote && (await deps.holds(saved))) {
    return true;
  }

  if (attempts <= 1 || copied === null) {
    return false;
  }

  await deps.wait(RESTORE_RETRY_MS);

  // Ordinary copies are not blocked by a capture. Never replace a newer one.
  if (!(await deps.unchanged(copied).catch(() => false))) {
    return false;
  }

  return await putBack(deps, saved, copied, attempts - 1);
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
  // Read with the text, before the clipboard goes back to what it held.
  const html = text === "" ? "" : await deps.readHtml().catch(() => "");
  const source = text === "" ? "" : await deps.readSource().catch(() => "");

  const copied = await deps.snapshot().catch(() => null);
  const restored = await putBack(deps, saved, copied, RESTORE_ATTEMPTS);

  // Windows copies lines with CRLF; the shelf keeps the LF a text field would leave.
  return text.trim() === ""
    ? { kind: "none", restored }
    : {
        html: html.trim() === "" ? null : html,
        kind: "text",
        restored,
        source: source.trim() === "" ? null : source.trim(),
        text: text.replaceAll("\r\n", "\n"),
      };
};

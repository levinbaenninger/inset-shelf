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
  /** False for a read made while another app had the clipboard open: Electron hands back formats with nothing in them. */
  readonly readable: (snapshot: S) => boolean;
  /** Whether two snapshots hold the same content, format by format. */
  readonly same: (a: S, b: S) => Promise<boolean>;
  readonly now: () => number;
  readonly wait: (ms: number) => Promise<void>;
}

const POLL_MS = 25;
const POLL_LIMIT = 20;

/**
 * While another app has the clipboard open, Windows lets a write do nothing
 * without an error (the clipboard keeps the copied selection), and a read
 * takes about 350 ms and comes back as one empty text. Putting the clipboard
 * back is checked, and tried again for up to three seconds, unless a newer
 * copy has superseded the capture.
 */
const RESTORE_DEADLINE_MS = 3000;
const RESTORE_RETRY_MS = 250;

/** How long the capture waits for a clipboard another app holds, before leaving it alone. */
const SNAPSHOT_WAIT_MS = 1000;
const SNAPSHOT_RETRY_MS = 100;

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
  | { readonly kind: "none"; readonly restored: boolean }
  /** Another app held the clipboard throughout: it was left alone, and nothing was copied. */
  | { readonly kind: "busy" };

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

/** A snapshot that could be read, waiting for another app to let go of the clipboard; null if it doesn't by `until`. */
const readSnapshot = async <S>(
  deps: SelectionDeps<S>,
  until: number,
  retryMs: number
): Promise<S | null> => {
  const snapshot = await deps.snapshot().catch(() => null);

  if (snapshot !== null && deps.readable(snapshot)) {
    return snapshot;
  }

  if (deps.now() >= until) {
    return null;
  }

  await deps.wait(retryMs);

  return await readSnapshot(deps, until, retryMs);
};

/** Puts the clipboard back, and checks it took: true once it holds what it held. */
const putBack = async <S>(
  deps: SelectionDeps<S>,
  saved: S,
  copied: S | null,
  until: number
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

  // Without the clipboard as the capture left it, a newer copy couldn't be told apart: no retry.
  if (copied === null || deps.now() >= until) {
    return false;
  }

  await deps.wait(RESTORE_RETRY_MS);

  // An empty read only means another app still has it open: wait that out, then look again.
  const current = await readSnapshot(deps, until, RESTORE_RETRY_MS);

  // Ordinary copies are not blocked by a capture. Never replace a newer one.
  if (
    current === null ||
    !(await deps.same(copied, current).catch(() => false))
  ) {
    return false;
  }

  return await putBack(deps, saved, copied, until);
};

/**
 * Copies the selection of the app in front and puts the clipboard back as it was.
 * The clipboard is cleared first, so "nothing copied" is told apart from
 * "the selection equals what was already on the clipboard".
 */
export const captureSelection = async <S>(
  deps: SelectionDeps<S>
): Promise<SelectionResult> => {
  // A clipboard that can't be read can't be put back: it is left alone rather than emptied.
  const saved = await readSnapshot(
    deps,
    deps.now() + SNAPSHOT_WAIT_MS,
    SNAPSHOT_RETRY_MS
  );

  if (saved === null) {
    return { kind: "busy" };
  }

  deps.clear();
  deps.copy();

  const text = await pollText(deps, POLL_LIMIT);
  // Read with the text, before the clipboard goes back to what it held.
  const html = text === "" ? "" : await deps.readHtml().catch(() => "");
  const source = text === "" ? "" : await deps.readSource().catch(() => "");

  const until = deps.now() + RESTORE_DEADLINE_MS;
  const copied = await readSnapshot(deps, until, RESTORE_RETRY_MS);
  const restored = await putBack(deps, saved, copied, until);

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

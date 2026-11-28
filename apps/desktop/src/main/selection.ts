import { ConcealedClipboardError } from "./clipboard-privacy";

/** What a copy of the selection put on the clipboard, all from one read: "" for any part it hasn't. */
export interface CopiedSelection {
  readonly text: string;
  readonly html: string;
  /** The address of the page the text was copied from, as browsers note it beside the text. */
  readonly source: string;
}

/** S is whatever the clipboard returns as a full copy of its content; it only goes back in. */
export interface SelectionDeps<S> {
  readonly snapshot: () => Promise<S>;
  readonly restore: (snapshot: S) => Promise<void>;
  readonly clear: () => void;
  /**
   * The copied text, HTML and source page, from one read checked for the private marks, so none of them
   * can come from a newer copy than the check saw. Throws ConcealedClipboardError on a private selection;
   * "" text when the clipboard changed while it was read.
   */
  readonly readSelection: () => Promise<CopiedSelection>;
  /** Sends the copy shortcut to the app in front. */
  readonly copy: () => void;
  /**
   * Whether the clipboard, read as `current`, holds `saved`'s content again: put back, or still empty for an
   * empty one. It judges that read and makes none of its own, which a hold starting meanwhile would spoil.
   */
  readonly holds: (saved: S, current: S) => Promise<boolean>;
  /** The plain text and HTML in a snapshot, "" for either it hasn't. */
  readonly content: (snapshot: S) => Promise<{
    readonly html: string;
    readonly text: string;
  }>;
  /** False for a read made while another app had the clipboard open: Electron hands back formats with nothing in them. */
  readonly readable: (snapshot: S) => boolean;
  /** Whether two snapshots hold the same content, format by format. */
  readonly same: (a: S, b: S) => Promise<boolean>;
  readonly now: () => number;
  readonly wait: (ms: number) => Promise<void>;
}

const POLL_MS = 25;

const NOTHING_COPIED: CopiedSelection = { html: "", source: "", text: "" };
const POLL_LIMIT = 20;

/**
 * While another app has the clipboard open, Windows lets a write do nothing
 * without an error (the clipboard keeps the copied selection), and a read
 * takes about 350 ms and comes back as one empty text. Putting the clipboard
 * back is checked, and a hold is waited out for up to ten seconds after the
 * copy, unless a newer copy has superseded the capture. The capture ends as
 * soon as the hold does; holds of four seconds were seen on Windows.
 */
const RESTORE_DEADLINE_MS = 10_000;
const RESTORE_RETRY_MS = 250;

/** How long the capture waits for a clipboard another app holds, before leaving it alone. */
const SNAPSHOT_WAIT_MS = 1000;
const SNAPSHOT_RETRY_MS = 100;

/**
 * How the capture ended. `restored`: the clipboard holds again what it held.
 * `unchecked`: another app still held the clipboard when time ran out, so
 * whether it was put back couldn't be read.
 */
interface PutBackResult {
  readonly restored: boolean;
  readonly unchecked: boolean;
}

export type SelectionResult =
  | (PutBackResult & {
      readonly kind: "text";
      readonly text: string;
      /** Null when the app put no HTML on the clipboard. */
      readonly html: string | null;
      /** Null when the app noted no page. */
      readonly source: string | null;
    })
  | (PutBackResult & { readonly kind: "none" })
  /** Another app held the clipboard, so the selection couldn't be copied. Left alone if it held it from the start. */
  | (PutBackResult & { readonly kind: "busy" })
  /**
   * A password manager's private copy was met, so the capture stopped at once. `original`: the clipboard
   * it started with (left alone); `selection`: the copied selection (not captured).
   */
  | (PutBackResult & {
      readonly kind: "concealed";
      readonly which: "original" | "selection";
    });

/** A failed read is no snapshot, except for a private clipboard, which ends the capture. */
const orNull = (error: Error): null => {
  if (error instanceof ConcealedClipboardError) {
    throw error;
  }

  return null;
};

/** A snapshot that could be read, waiting for another app to let go of the clipboard; null if it doesn't by `until`. */
const readSnapshot = async <S>(
  deps: SelectionDeps<S>,
  until: number,
  retryMs: number
): Promise<S | null> => {
  const snapshot = await deps.snapshot().catch(orNull);

  if (snapshot !== null && deps.readable(snapshot)) {
    return snapshot;
  }

  if (deps.now() >= until) {
    return null;
  }

  await deps.wait(retryMs);

  return await readSnapshot(deps, until, retryMs);
};

/**
 * Waits for the copied text. Nothing there yet is waited for a moment (the
 * app is still copying, or nothing was selected); a clipboard another app
 * holds, which reads as nothing too, is waited for until `until`.
 */
const pollText = async <S>(
  deps: SelectionDeps<S>,
  quietUntil: number,
  until: number
): Promise<{ readonly held: boolean; readonly copied: CopiedSelection }> => {
  // A read that meets a private selection throws ConcealedClipboardError out of here.
  await deps.wait(POLL_MS);

  const copied = await deps.readSelection();

  if (copied.text !== "") {
    return { copied, held: false };
  }

  const snapshot = await deps.snapshot().catch(orNull);
  const held = snapshot !== null && !deps.readable(snapshot);

  // The text read may have run into a hold that has ended since: read once more.
  if (!held) {
    const again = await deps.readSelection();

    if (again.text !== "") {
      return { copied: again, held: false };
    }
  }

  if (deps.now() >= (held ? until : quietUntil)) {
    return { copied: NOTHING_COPIED, held };
  }

  return await pollText(deps, quietUntil, until);
};

type Baseline<S> =
  /** The clipboard as the capture left it, to tell a newer copy apart later. */
  | { readonly kind: "read"; readonly snapshot: S }
  /** It couldn't be read at all: one try to put back, without retries. */
  | { readonly kind: "unread" }
  /** Another app copied something newer meanwhile: it is left alone. */
  | { readonly kind: "newer" }
  /** Another app held the clipboard until time ran out. */
  | { readonly kind: "held" };

/**
 * The clipboard right after the capture. A read under a hold says nothing:
 * what comes back after the hold is the capture only if it is exactly what
 * was copied, text and HTML; anything else is a newer copy to leave alone.
 */
const baseline = async <S>(
  deps: SelectionDeps<S>,
  copied: { readonly html: string; readonly text: string },
  until: number
): Promise<Baseline<S>> => {
  const first = await deps.snapshot().catch(orNull);

  if (first === null) {
    return { kind: "unread" };
  }

  if (deps.readable(first)) {
    return { kind: "read", snapshot: first };
  }

  const later = await readSnapshot(deps, until, RESTORE_RETRY_MS);

  if (later === null) {
    return { kind: "held" };
  }

  // Judged from that one read: a second read could fall under a hold that starts meanwhile.
  const { html, text } = await deps.content(later);

  return text === copied.text && html === copied.html
    ? { kind: "read", snapshot: later }
    : { kind: "newer" };
};

/** What the clipboard holds now: put back, still the capture, something newer, or unreadable until time ran out. */
type Look = "restored" | "unchanged" | "changed" | "held";

const look = async <S>(
  deps: SelectionDeps<S>,
  saved: S,
  copied: S | null,
  until: number
): Promise<Look> => {
  const current = await readSnapshot(deps, until, RESTORE_RETRY_MS);

  if (current === null) {
    return "held";
  }

  if (await deps.holds(saved, current)) {
    return "restored";
  }

  // Without the clipboard as the capture left it, a newer copy can't be told apart: treated as one.
  if (copied === null) {
    return "changed";
  }

  return (await deps.same(copied, current).catch(() => false))
    ? "unchanged"
    : "changed";
};

/** Another app held the clipboard from the capture until time ran out: the put back was never tried. */
const NOT_TRIED: PutBackResult = { restored: false, unchecked: false };

const ENDED: Readonly<Record<Look, PutBackResult>> = {
  changed: { restored: false, unchecked: false },
  held: { restored: false, unchecked: true },
  restored: { restored: true, unchecked: false },
  unchanged: { restored: false, unchecked: false },
};

/**
 * Puts the clipboard back and checks it took, waiting out another app's
 * hold before each look. It tries again while the clipboard is still as the
 * capture left it, and never replaces a newer copy.
 */
const putBack = async <S>(
  deps: SelectionDeps<S>,
  saved: S,
  copied: S | null,
  until: number
): Promise<PutBackResult> => {
  try {
    await deps.restore(saved);
  } catch {
    // A write that failed is one more try; the look says what it left.
  }

  const after = await look(deps, saved, copied, until);

  if (after !== "unchanged" || deps.now() >= until) {
    return ENDED[after];
  }

  await deps.wait(RESTORE_RETRY_MS);

  const before = await look(deps, saved, copied, until);

  if (before !== "unchanged") {
    return ENDED[before];
  }

  return await putBack(deps, saved, copied, until);
};

/** Puts the clipboard back after the capture: judged from what it holds right after the copy. */
const restoreAfter = async <S>(
  deps: SelectionDeps<S>,
  saved: S,
  copied: { readonly html: string; readonly text: string },
  until: number
): Promise<PutBackResult> => {
  const left = await baseline(deps, copied, until);

  switch (left.kind) {
    case "read": {
      return await putBack(deps, saved, left.snapshot, until);
    }

    case "unread": {
      return await putBack(deps, saved, null, until);
    }

    case "newer": {
      return ENDED.changed;
    }

    case "held": {
      return NOT_TRIED;
    }

    default: {
      return NOT_TRIED;
    }
  }
};

/** One write putting `saved` back over a private selection, and whether one look then finds it there. */
const putBackOnce = async <S>(
  deps: SelectionDeps<S>,
  saved: S
): Promise<boolean> => {
  try {
    await deps.restore(saved);

    const current = await deps.snapshot();

    return deps.readable(current) && (await deps.holds(saved, current));
  } catch {
    // A failed write, or a clipboard still private: the private selection may still be there.
    return false;
  }
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
  let saved: S | null;

  try {
    saved = await readSnapshot(
      deps,
      deps.now() + SNAPSHOT_WAIT_MS,
      SNAPSHOT_RETRY_MS
    );
  } catch (error) {
    if (error instanceof ConcealedClipboardError) {
      return {
        kind: "concealed",
        restored: true,
        unchecked: false,
        which: "original",
      };
    }

    throw error;
  }

  if (saved === null) {
    return { kind: "busy", restored: true, unchecked: false };
  }

  deps.clear();
  deps.copy();

  const copiedAt = deps.now();
  const until = copiedAt + RESTORE_DEADLINE_MS;

  let polled: { readonly held: boolean; readonly copied: CopiedSelection };

  try {
    polled = await pollText(deps, copiedAt + POLL_MS * POLL_LIMIT, until);
  } catch (error) {
    if (!(error instanceof ConcealedClipboardError)) {
      throw error;
    }

    // The clipboard was cleared for the copy and now holds a private selection: it goes back to what
    // it held, as one write, without waiting out a hold. One look says whether it took: a failed write,
    // or a clipboard still private or unreadable, may still hold the private selection.
    const restored = await putBackOnce(deps, saved);

    return {
      kind: "concealed",
      restored,
      unchecked: false,
      which: "selection",
    };
  }

  const {
    copied: { html, source, text },
    held,
  } = polled;

  // Without a readable selection, a later snapshot could be a newer copy: never put back over it.
  if (held) {
    return { kind: "busy", ...NOT_TRIED };
  }

  let ended: PutBackResult;

  try {
    ended = await restoreAfter(deps, saved, { html, text }, until);
  } catch (error) {
    if (!(error instanceof ConcealedClipboardError)) {
      throw error;
    }

    // A password manager wrote a private item meanwhile: it is the user's newer copy, so the restore
    // stops and leaves it. The capture is kept: it came from a read that saw no private mark before or
    // after it, so it was copied before the private item.
    ended = { restored: true, unchecked: false };
  }

  if (text.trim() === "") {
    return { kind: "none", ...ended };
  }

  // Windows copies lines with CRLF; the shelf keeps the LF a text field would leave.
  return {
    html: html.trim() === "" ? null : html,
    kind: "text",
    source: source.trim() === "" ? null : source.trim(),
    text: text.replaceAll("\r\n", "\n"),
    ...ended,
  };
};

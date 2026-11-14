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
  | (PutBackResult & { readonly kind: "busy" });

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

/**
 * Waits for the copied text. Nothing there yet is waited for a moment (the
 * app is still copying, or nothing was selected); a clipboard another app
 * holds, which reads as nothing too, is waited for until `until`.
 */
const pollText = async <S>(
  deps: SelectionDeps<S>,
  quietUntil: number,
  until: number
): Promise<{ readonly held: boolean; readonly text: string }> => {
  await deps.wait(POLL_MS);

  const text = await deps.readText();

  if (text !== "") {
    return { held: false, text };
  }

  const snapshot = await deps.snapshot().catch(() => null);
  const held = snapshot !== null && !deps.readable(snapshot);

  // The text read may have run into a hold that has ended since: read once more.
  if (!held) {
    const again = await deps.readText();

    if (again !== "") {
      return { held: false, text: again };
    }
  }

  if (deps.now() >= (held ? until : quietUntil)) {
    return { held, text: "" };
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
  const first = await deps.snapshot().catch(() => null);

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

  const text = await deps.readText().catch(() => null);
  const html = await deps.readHtml().catch(() => null);

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

  if (await deps.holds(saved)) {
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
    return { kind: "busy", restored: true, unchecked: false };
  }

  deps.clear();
  deps.copy();

  const copiedAt = deps.now();
  const until = copiedAt + RESTORE_DEADLINE_MS;

  const { held, text } = await pollText(
    deps,
    copiedAt + POLL_MS * POLL_LIMIT,
    until
  );

  // Read with the text, before the clipboard goes back to what it held.
  const html = text === "" ? "" : await deps.readHtml().catch(() => "");
  const source = text === "" ? "" : await deps.readSource().catch(() => "");

  const left = await baseline(deps, { html, text }, until);

  let ended: PutBackResult;

  switch (left.kind) {
    case "read": {
      ended = await putBack(deps, saved, left.snapshot, until);
      break;
    }

    case "unread": {
      ended = await putBack(deps, saved, null, until);
      break;
    }

    case "newer": {
      ended = ENDED.changed;
      break;
    }

    case "held": {
      ended = ENDED.held;
      break;
    }

    default: {
      ended = ENDED.held;
      break;
    }
  }

  if (text.trim() === "") {
    return { kind: held ? "busy" : "none", ...ended };
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

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
  /** The paths of the files the app copied, as Explorer and Finder copy a selected file; empty for none. */
  readonly readFiles: () => Promise<readonly string[]>;
  /** Sends the copy shortcut to the app in front. */
  readonly copy: () => void;
  /**
   * Whether the clipboard, read as `current`, holds `saved`'s content again: put back, or still empty for an
   * empty one. It judges that read and makes none of its own, which a hold starting meanwhile would spoil.
   */
  readonly holds: (saved: S, current: S) => Promise<boolean>;
  /** The plain text and HTML in a snapshot, "" for either it hasn't, the files it lists, and whether they were cut (null when the read can't say). */
  readonly content: (snapshot: S) => Promise<{
    readonly cut: boolean | null;
    readonly files: readonly string[];
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
  /** Files selected in Explorer or Finder: saved as dropping them on the shelf would. */
  | (PutBackResult & {
      readonly kind: "files";
      readonly paths: readonly string[];
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

interface Copied {
  readonly held: boolean;
  readonly text: string;
  /** The files copied: Explorer copies them without text, Finder with their names as text. */
  readonly files: readonly string[];
}

const readFiles = async <S>(
  deps: SelectionDeps<S>
): Promise<readonly string[]> => await deps.readFiles().catch(() => []);

/**
 * Waits for the copied text or files. Nothing there yet is waited for a
 * moment (the app is still copying, or nothing was selected); a clipboard
 * another app holds, which reads as nothing too, is waited for until `until`.
 */
const pollText = async <S>(
  deps: SelectionDeps<S>,
  quietUntil: number,
  until: number
): Promise<Copied> => {
  await deps.wait(POLL_MS);

  const text = await deps.readText();

  if (text !== "") {
    return { files: await readFiles(deps), held: false, text };
  }

  const files = await readFiles(deps);

  if (files.length > 0) {
    return { files, held: false, text: "" };
  }

  const snapshot = await deps.snapshot().catch(() => null);
  const held = snapshot !== null && !deps.readable(snapshot);

  // The text read may have run into a hold that has ended since: read once more.
  if (!held) {
    const again = await deps.readText();

    if (again !== "") {
      return { files: await readFiles(deps), held: false, text: again };
    }
  }

  if (deps.now() >= (held ? until : quietUntil)) {
    return { files: [], held, text: "" };
  }

  return await pollText(deps, quietUntil, until);
};

/** The last name in a path, whichever way it is separated. */
const nameOf = (file: string): string =>
  file.split(/[\\/]+/u).findLast((part) => part !== "") ?? "";

/**
 * Whether the text beside the files is only their names, as Finder copies a
 * selected file, with or without its extension, or nothing. Any other text
 * was selected in an app that put a file URL next to it: the text is the
 * selection.
 */
const namesTheFiles = (text: string, files: readonly string[]): boolean => {
  const lines = new Set(
    text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line !== "")
  );

  if (lines.size === 0) {
    return true;
  }

  const names = files.map(nameOf);
  const stems = names.map((name) => name.replace(/\.[^.]+$/u, ""));

  return [names, stems].some(
    (spelled) =>
      [...lines].every((line) => spelled.includes(line)) &&
      spelled.every((name) => lines.has(name))
  );
};

type Baseline<S> =
  /** The clipboard as the capture left it, to tell a newer copy apart later. */
  | { readonly kind: "read"; readonly snapshot: S }
  /** Another app copied something newer meanwhile: it is left alone. */
  | { readonly kind: "newer" }
  /** The clipboard couldn't be told from a hold until time ran out. */
  | { readonly kind: "held" };

/** What one read shows of the capture: the capture itself, a newer copy, or too little to say. */
type Verdict = "ours" | "newer" | "unsure";

const sameFiles = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((file, at) => file === b[at]);

/** Line breaks and edges as an app may hand text back, to compare it with the text read. */
const words = (text: string): string => text.replaceAll("\r\n", "\n").trim();

/** After a hold, a field holds what the capture copied, or another copy; one that came back empty may be a read cut short. */
const against = (seen: string, had: string): Verdict => {
  if (seen === had) {
    return "ours";
  }

  return seen === "" ? "unsure" : "newer";
};

/**
 * What one read of the clipboard says, judged by itself: a hold turns a read
 * empty or half-read without an error, so a read shows a newer copy only by
 * showing something else, never by lacking something the capture had. After a
 * hold the text and HTML are what was copied, or another one is a newer copy.
 * Files cut are one too: the capture copies; the same files with no effect
 * to read are unsure, since the read may have hidden a cut. Files carry no text or HTML to tell a newer copy by, so the read's own list
 * of files is compared: another list, or text where the capture had none,
 * is a newer copy; no list at all, with nothing else shown, is unsure.
 */
const verdictOn = async <S>(
  deps: SelectionDeps<S>,
  snapshot: S,
  copied: {
    readonly files: readonly string[];
    readonly html: string;
    readonly text: string;
  },
  afterHold: boolean
): Promise<Verdict> => {
  const { cut, files, html, text } = await deps.content(snapshot);

  // The capture only copies: files cut since were cut by the user.
  if (cut === true) {
    return "newer";
  }

  if (afterHold) {
    const fields = new Set([
      against(text, copied.text),
      against(html, copied.html),
    ]);

    if (fields.has("newer")) {
      return "newer";
    }

    if (fields.has("unsure")) {
      return "unsure";
    }
  }

  // A text capture copies no files: a list seen after a hold is a newer copy, as Finder copies a file beside its name.
  if (copied.files.length === 0) {
    return afterHold && files.length > 0 ? "newer" : "ours";
  }

  if (files.length > 0) {
    if (!sameFiles(files, copied.files)) {
      return "newer";
    }

    // The list may be the capture's while the read hid a cut of it.
    return cut === null ? "unsure" : "ours";
  }

  return words(text) !== "" && words(text) !== words(copied.text)
    ? "newer"
    : "unsure";
};

/**
 * The clipboard right after the capture, read until one read says what is
 * there: a read under a hold, one that fails, and one too empty to judge are
 * read again after a pause, until time runs out.
 */
const baseline = async <S>(
  deps: SelectionDeps<S>,
  copied: {
    readonly files: readonly string[];
    readonly html: string;
    readonly text: string;
  },
  until: number,
  afterHold = false
): Promise<Baseline<S>> => {
  const snapshot = await deps.snapshot().catch(() => null);

  if (snapshot !== null && deps.readable(snapshot)) {
    // A read that can't be listed says nothing either.
    const verdict = await verdictOn(deps, snapshot, copied, afterHold).catch(
      (): Verdict => "unsure"
    );

    if (verdict !== "unsure") {
      return verdict === "ours"
        ? { kind: "read", snapshot }
        : { kind: "newer" };
    }
  }

  if (deps.now() >= until) {
    return { kind: "held" };
  }

  await deps.wait(RESTORE_RETRY_MS);

  return await baseline(deps, copied, until, true);
};

/** What the clipboard holds now: put back, still the capture, something newer, or unreadable until time ran out. */
type Look = "restored" | "unchanged" | "changed" | "held";

const look = async <S>(
  deps: SelectionDeps<S>,
  saved: S,
  copied: S,
  until: number
): Promise<Look> => {
  const current = await readSnapshot(deps, until, RESTORE_RETRY_MS);

  if (current === null) {
    return "held";
  }

  if (await deps.holds(saved, current)) {
    return "restored";
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
  copied: S,
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

  const { files, held, text } = await pollText(
    deps,
    copiedAt + POLL_MS * POLL_LIMIT,
    until
  );

  // Without a readable selection, a later snapshot could be a newer copy: never put back over it.
  if (held) {
    return { kind: "busy", ...NOT_TRIED };
  }

  // Read with the text, before the clipboard goes back to what it held.
  const html = text === "" ? "" : await deps.readHtml().catch(() => "");
  const source = text === "" ? "" : await deps.readSource().catch(() => "");

  const left = await baseline(deps, { files, html, text }, until);

  let ended: PutBackResult;

  switch (left.kind) {
    case "read": {
      ended = await putBack(deps, saved, left.snapshot, until);
      break;
    }

    case "newer": {
      ended = ENDED.changed;
      break;
    }

    case "held": {
      ended = NOT_TRIED;
      break;
    }

    default: {
      ended = NOT_TRIED;
      break;
    }
  }

  // Finder copies a file's name as text beside it: the file is what was selected. Other text beside a file URL is the selection.
  if (files.length > 0 && namesTheFiles(text, files)) {
    return { kind: "files", paths: files, ...ended };
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

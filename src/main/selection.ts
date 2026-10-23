/** S is whatever the clipboard returns as a full copy of its content; it only goes back in. */
export interface SelectionDeps<S> {
  readonly snapshot: () => Promise<S>;
  readonly restore: (snapshot: S) => Promise<void>;
  readonly clear: () => void;
  readonly readText: () => Promise<string>;
  /** The HTML the app copied next to the text, or "" when it copied none. */
  readonly readHtml: () => Promise<string>;
  /** Sends the copy shortcut to the app in front. */
  readonly copy: () => void;
  readonly wait: (ms: number) => Promise<void>;
}

const POLL_MS = 25;
const POLL_LIMIT = 20;

export type SelectionResult =
  | {
      readonly kind: "text";
      readonly text: string;
      /** Null when the app put no HTML on the clipboard. */
      readonly html: string | null;
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

  let restored = true;

  try {
    await deps.restore(saved);
  } catch {
    restored = false;
  }

  // Windows copies lines with CRLF; the shelf keeps the LF a text field would leave.
  return text.trim() === ""
    ? { kind: "none", restored }
    : {
        html: html.trim() === "" ? null : html,
        kind: "text",
        restored,
        text: text.replaceAll("\r\n", "\n"),
      };
};

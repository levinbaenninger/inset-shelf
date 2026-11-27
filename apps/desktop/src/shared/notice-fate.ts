/**
 * What the trial log (src/main/e2e-log.ts) says became of a notice: main
 * logs `noticeSent` in `notify`, and `noticeShown` once the shelf page or
 * the toast window put it on screen. A trial reads this instead of the
 * accessibility tree, which can miss a notice that shows for a moment.
 */
export type NoticeFate =
  | { readonly kind: "shown"; readonly via: string }
  | { readonly kind: "sentNotShown"; readonly via: string }
  /** No notice with these words was sent: `sent` holds the words of those that were. */
  | { readonly kind: "notSent"; readonly sent: readonly string[] };

export interface NoticeEvent {
  readonly event: string;
  readonly text?: string;
  readonly via?: string;
}

/** The fate of the notice that says exactly `message`, among `events` (those after the trial's mark). */
export const noticeFate = (
  events: readonly NoticeEvent[],
  message: string
): NoticeFate => {
  const shown = events.find(
    (each) => each.event === "noticeShown" && each.text === message
  );

  if (shown !== undefined) {
    return { kind: "shown", via: shown.via ?? "unknown" };
  }

  const sent = events.filter((each) => each.event === "noticeSent");
  const match = sent.find((each) => each.text === message);

  return match === undefined
    ? { kind: "notSent", sent: sent.map((each) => each.text ?? "") }
    : { kind: "sentNotShown", via: match.via ?? "unknown" };
};

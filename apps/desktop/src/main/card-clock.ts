/** Without the pointer or the keyboard on it, the screenshot card goes after this long. */
export const CARD_VISIBLE_MS = 12_000;

const ignore = (): void => undefined;

/**
 * When the screenshot card goes by itself: its time runs while it shows and
 * nothing holds it. The pointer or the keyboard on it (`hover`) pauses it;
 * `hold` (Keep on Screen) stops it until the card hides. A save can also
 * hold it, for as long as the card shows one, without changing Keep on Screen.
 */
export const createCardClock = (options: {
  readonly setTimer: (run: () => void, ms: number) => () => void;
  /** Its time ran out. */
  readonly expire: () => void;
}) => {
  let showing = false;
  let hovered = false;
  let held = false;
  let saveHeld = false;
  let cancel = ignore;

  const stop = (): void => {
    cancel();
    cancel = ignore;
  };

  const hidden = (): void => {
    stop();
    showing = false;
    hovered = false;
    held = false;
    saveHeld = false;
  };

  const run = (): void => {
    stop();
    cancel = options.setTimer(() => {
      hidden();
      options.expire();
    }, CARD_VISIBLE_MS);
  };

  return {
    /** The card shows a new screenshot: a fresh time, nothing held. */
    shown: (): void => {
      showing = true;
      held = false;
      saveHeld = false;

      if (hovered) {
        stop();
      } else {
        run();
      }
    },
    /** The card went: nothing on it any more. */
    hidden,
    hover: (on: boolean): void => {
      hovered = on;

      if (hovered) {
        stop();
      } else if (showing && !held && !saveHeld) {
        run();
      }
    },
    hold: (): void => {
      held = true;
      stop();
    },
    /** A save holds the card (`on`), or none does any more. Told what it already knows, it changes nothing: the time it has runs on. */
    holdForSave: (on: boolean): void => {
      if (on === saveHeld) {
        return;
      }

      saveHeld = on;

      if (on) {
        stop();
      } else if (showing && !hovered && !held) {
        run();
      }
    },
  };
};

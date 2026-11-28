import type { ShelfHere } from "@shared/contracts";
import { hereOf, hereWith, openingOf, typedNote } from "@shared/recall";
import type { Opening } from "@shared/recall";
import type { ItemContext, MainOp, ShelfDoc, ShelfOp } from "@shared/shelf";

import type { Activity, FrontWatchDeps } from "./front-watch";

/**
 * Open decision 3: the shelf shows a "from here" chip whenever it opens
 * beside a window open items came from. False keeps the filter for the
 * recall pill's click only.
 */
const HERE_CHIP = true;

/**
 * Recall in main: the window the shelf shows beside and the open items from
 * it, sent with the shelf's view. Not shelf data.
 */
export const createShelfHere = (deps: {
  readonly doc: () => ShelfDoc;
  /** Reads the window in front; null when it is Inset's own or none. */
  readonly probe: FrontWatchDeps["probe"];
  readonly setTimer: FrontWatchDeps["setTimer"];
  readonly idleSeconds: () => number;
  /** The shelf shows, so the window in front is the one it floats over. */
  readonly visible: () => boolean;
  /** What is from here changed while the shelf shows. */
  readonly changed: () => void;
}) => {
  let opening: Opening | null = null;
  let seq = 0;

  const open = (
    context: ItemContext | null,
    here: Omit<ShelfHere, "seq"> | null
  ): void => {
    seq += 1;
    opening =
      context === null || here === null
        ? null
        : openingOf(deps.doc(), context, { ...here, seq });
  };

  return {
    /** Input the key hook saw. The opening keeps its window whatever comes to the front. */
    activity: (_kind: Activity): void => undefined,
    /** The shelf opens beside `context`, or beside no window when it is null. */
    opened: (context: ItemContext | null): void => {
      const found = HERE_CHIP ? hereOf(deps.doc(), context) : null;

      open(context, found === null ? null : { ...found, filter: false });
    },
    /** The recall pill shown for `context` opens the shelf filtered to its items. */
    recalled: (
      context: ItemContext | null,
      found: { readonly ids: ShelfHere["ids"]; readonly label: string }
    ): void => {
      open(context, { ...found, filter: true });
    },
    /** What the shelf is told is from here. */
    here: (): ShelfHere | null =>
      opening === null ? null : hereWith(opening, deps.doc()),
    /** A composer request as main carries it out under this opening. */
    typed: (
      op: Extract<ShelfOp, { readonly type: "compose" }>
    ): ShelfOp | MainOp => typedNote(op, opening),
  };
};

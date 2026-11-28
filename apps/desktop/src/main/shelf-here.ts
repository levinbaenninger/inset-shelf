import type { ShelfHere } from "@shared/contracts";
import { hereOf, hereWith, openingOf, typedNote } from "@shared/recall";
import type { Opening } from "@shared/recall";
import type { ItemContext, MainOp, ShelfDoc, ShelfOp } from "@shared/shelf";

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
export const createShelfHere = (deps: { readonly doc: () => ShelfDoc }) => {
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

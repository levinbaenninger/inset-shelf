import type { ScreenshotView } from "@shared/contracts";
import type { ItemId } from "@shared/shelf";

/** What the pill reads: its add, Saving… while any save writes, Retry once it failed. */
export const PILL_LABEL = {
  failed: "Retry",
  idle: "Add to Shelf",
  saving: "Saving…",
} as const;

/** The only Retry's whole name, before the item's: after the pill's word, the caption under it reads the same. */
const RETRY_LEAD = "Retry adding to";

/** Under Retry, once it is the only add: where it adds to. */
const SOLE_LEAD = "adding to";

/**
 * Where the pill's add puts the screenshot, as one word: the shelf, or one
 * item. The pill is keyed by it, so a button the keyboard is on never comes
 * to add somewhere else.
 */
export type AddId = "shelf" | `item:${string}`;

/** The card's adds: the white pill, and under it the item its only Retry adds to. */
export interface CardAdds {
  readonly pill: {
    readonly add: AddId;
    /** The word on it. */
    readonly label: string;
    /** Its whole name, for a screen reader. */
    readonly name: string;
    /** The item a press adds the screenshot to; null for the shelf. */
    readonly item: ItemId | null;
  };
  /** Only names the item the pill's Retry adds to: not a button. */
  readonly line: { readonly lead: string; readonly name: string } | null;
  /**
   * The screenshot is on its item, not saved: Retry adding to it is the only
   * add, so it is the pill.
   */
  readonly sole: boolean;
}

const shelfPill = (state: keyof typeof PILL_LABEL): CardAdds["pill"] => ({
  add: "shelf",
  item: null,
  label: PILL_LABEL[state],
  name: PILL_LABEL[state],
});

/**
 * Which add the card offers. While the shelf holds the screenshot
 * (`save.placed`), the add for that place is the only one. Else it is Add to
 * Shelf, which reads Saving… while any save writes, and Retry when it was
 * Add to Shelf that failed. Adding to an item is a drag of the picture.
 */
export const cardAdds = ({ save }: Pick<ScreenshotView, "save">): CardAdds => {
  if (save.state !== "idle" && save.placed !== null) {
    const { placed, state } = save;

    if (placed.to === "shelf") {
      return { line: null, pill: shelfPill(state), sole: false };
    }

    return {
      line: { lead: SOLE_LEAD, name: placed.label },
      pill: {
        add: `item:${placed.id}`,
        item: placed.id,
        label: PILL_LABEL[state],
        name:
          state === "failed"
            ? `${RETRY_LEAD} “${placed.label}”`
            : PILL_LABEL[state],
      },
      sole: true,
    };
  }

  if (save.state === "saving") {
    return { line: null, pill: shelfPill("saving"), sole: false };
  }

  return {
    line: null,
    pill: shelfPill(
      save.state === "failed" && save.to === "shelf" ? "failed" : "idle"
    ),
    sole: false,
  };
};

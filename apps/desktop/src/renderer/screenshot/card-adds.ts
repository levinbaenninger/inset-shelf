import type { ScreenshotView, ShotSaveTo } from "@shared/contracts";

/** What the pill reads: its add, Saving… while it writes, Retry once it failed. */
export const PILL_LABEL = {
  failed: "Retry",
  idle: "Add to Shelf",
  saving: "Saving…",
} as const;

/** What Add to “…” reads before the item's name. */
const ITEM_LEAD = { failed: "Retry adding to", idle: "Add to" } as const;

/** Under Retry, once it is the only add: where it adds to. After the pill's word it reads as ITEM_LEAD.failed does. */
const SOLE_LEAD = "adding to";

/**
 * Where an add puts the screenshot, as one word: the shelf, or one item. The
 * card keeps one button for each, whether it is drawn as the pill or as the
 * line. So a button the keyboard is on never comes to add somewhere else, and
 * when its add moves between the line and the pill, the keyboard moves with it.
 */
export type AddId = "shelf" | `item:${string}`;

/** The line of words under the pill. */
export type AddLine =
  /** Add to “…”, or Retry adding to “…” with the name on a second line: a press adds to the item. */
  | {
      readonly add: AddId;
      readonly kind: "add";
      readonly lead: string;
      readonly name: string;
      readonly stacked: boolean;
    }
  /** That add while it writes. */
  | { readonly add: AddId; readonly kind: "saving" }
  /** Only names the item the pill's Retry adds to: not a button. */
  | { readonly kind: "caption"; readonly lead: string; readonly name: string };

/** The card's adds: the white pill, and the line under it when an item can be named. */
export interface CardAdds {
  readonly pill: {
    readonly add: AddId;
    /** The word on it. */
    readonly label: string;
    /** Its whole name, for a screen reader. */
    readonly name: string;
    /** Where a press adds the screenshot. */
    readonly to: ShotSaveTo;
  };
  readonly line: AddLine | null;
  /**
   * The screenshot stays on its item, changed there since or held by a write
   * still on its way: Retry adding to it is the only add, so it is the pill.
   */
  readonly sole: boolean;
}

const stateOf = (
  save: ScreenshotView["save"],
  to: ShotSaveTo
): "idle" | "saving" | "failed" =>
  save.state === "idle" || save.to !== to ? "idle" : save.state;

/**
 * Which adds the card offers. `wasSole` is what this said of the view before:
 * a save says `only` when it fails, so while its Retry writes, the card
 * remembers that no other add came back.
 */
export const cardAdds = (
  { save, target }: Pick<ScreenshotView, "save" | "target">,
  wasSole: boolean
): CardAdds => {
  const shelf = PILL_LABEL[stateOf(save, "shelf")];

  const toShelf = {
    add: "shelf",
    label: shelf,
    name: shelf,
    to: "shelf",
  } as const;

  if (target === null) {
    return { line: null, pill: toShelf, sole: false };
  }

  const item = stateOf(save, "item");
  const toItem: AddId = `item:${target.id}`;

  if (item !== "idle" && (save.state === "failed" ? save.only : wasSole)) {
    return {
      line: { kind: "caption", lead: SOLE_LEAD, name: target.label },
      pill: {
        add: toItem,
        label: PILL_LABEL[item],
        name:
          item === "failed"
            ? `${ITEM_LEAD.failed} “${target.label}”`
            : PILL_LABEL[item],
        to: "item",
      },
      sole: true,
    };
  }

  return {
    line:
      item === "saving"
        ? { add: toItem, kind: "saving" }
        : {
            add: toItem,
            kind: "add",
            lead: ITEM_LEAD[item],
            name: target.label,
            stacked: item === "failed",
          },
    pill: toShelf,
    sole: false,
  };
};

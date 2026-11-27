import { AppWindowMacIcon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@inset/ui/lib/utils";
import type { ShelfHere } from "@shared/contracts";
import { FROM_HERE, parseSearch } from "@shared/due";
import { onlyItems } from "@shared/recall";
import type { ItemGroup, ItemId } from "@shared/shelf";
import { useMemo, useState } from "react";

import { InputGroupButton } from "@/components/ui/input-group";
import { tooltipText, Truncated } from "@/shared/clamp";

/** The search with `from:here` added, once. */
export const withFromHere = (query: string): string => {
  const words = query.trim();

  if (parseSearch(words).here) {
    return words;
  }

  return words === "" ? FROM_HERE : `${words} ${FROM_HERE}`;
};

/** The search with `from:here` taken out. */
export const withoutFromHere = (query: string): string =>
  query
    .split(/\s+/u)
    .filter((word) => word !== "" && word !== FROM_HERE)
    .join(" ");

/** "2 open items from GitHub · inset/shelf #482", for the chip's and the menu's tooltip. */
export const hereText = (here: ShelfHere): string =>
  tooltipText(
    `${here.ids.length === 1 ? "1 open item" : `${here.ids.length} open items`} from ${here.label}`
  );

/**
 * Recall in the list. `from:here` in the search keeps only the open items
 * from the window the shelf opened beside; an opening from the recall pill
 * starts with it, once per opening. Clearing the search shows everything.
 */
export const useFromHere = (
  here: ShelfHere | null | undefined,
  query: string,
  setQuery: (query: string) => void
): ((groups: readonly ItemGroup[]) => readonly ItemGroup[]) => {
  const [handled, setHandled] = useState<number | null>(null);

  const ids = useMemo((): ReadonlySet<ItemId> => new Set(here?.ids), [here]);

  if (here?.filter === true && here.seq !== handled) {
    setHandled(here.seq);
    setQuery(FROM_HERE);
  }

  const filtering = parseSearch(query).here;

  return (groups) => (filtering ? onlyItems(groups, ids) : groups);
};

/**
 * In the search field, when the shelf opened beside a window open items came
 * from: "2 from here" ("Here · 2" in a shelf dragged narrower), with the
 * window mark the recall pill has too. It puts `from:here` into the search
 * and stays, pressed and tinted, in words while the filter is on: "Here" at
 * the width the shelf opens at, "2 from here" where the field has room for
 * both. It keeps the keyboard, so Return on it again takes the filter off.
 *
 * Its words follow the search field's own width (search-bar.tsx names the
 * field `search`), not the window's: they change in a field under 240 px
 * (not pressed) and under 290 px (pressed), never at the 250 px the field
 * has when the shelf opens. There it keeps the 77 px from:here needs and
 * the 59 px "Search" needs. A scene sweeps the widths between and fails
 * when any of these words is cut (screens.ts shelf-from-here-widths).
 * Open decision 3; main leaves `here` out to drop it.
 */
export const FromHereChip = ({
  here,
  onChange,
  query,
}: {
  readonly here: ShelfHere | null | undefined;
  readonly query: string;
  readonly onChange: (query: string) => void;
}) => {
  if (here === null || here === undefined || here.ids.length === 0) {
    return null;
  }

  const count = here.ids.length;
  const on = parseSearch(query).here;

  return (
    <InputGroupButton
      aria-label={`Show the ${count === 1 ? "item" : `${count} items`} from here`}
      aria-pressed={on}
      className="shrink-0"
      onClick={() => {
        onChange(on ? withoutFromHere(query) : withFromHere(query));
      }}
      size="xs"
      title={hereText(here)}
      variant={on ? "pressed" : "ghost"}
    >
      {/* Pressed, its tint marks it and the field says from:here: the words keep their room without the mark. */}
      {on ? null : <HugeiconsIcon icon={AppWindowMacIcon} />}
      <span
        className={
          on ? "@max-[290px]/search:hidden" : "@max-[240px]/search:hidden"
        }
      >
        {count} from here
      </span>
      {/* Pressed, "Here" leaves the field room for from:here and the search's ×; the list shows the count. */}
      <span
        className={cn(
          "hidden",
          on ? "@max-[290px]/search:inline" : "@max-[240px]/search:inline"
        )}
      >
        {on ? "Here" : `Here · ${count}`}
      </span>
    </InputGroupButton>
  );
};

/**
 * The opening a note typed now goes with: the window from here, while the
 * list shows its items and × hasn't taken the chip off for this opening
 * (`dismissed` is the seq it was taken off in). Null makes a plain note.
 */
export const noteHere = (
  here: ShelfHere | null | undefined,
  filtering: boolean,
  dismissed: number | null
): ShelfHere | null =>
  filtering &&
  here !== null &&
  here !== undefined &&
  here.ids.length > 0 &&
  here.seq !== dismissed
    ? here
    : null;

/**
 * In the composer while the list shows the items from here: the window a
 * note typed now goes with, so it stays in the list and the shelf finds it
 * beside that window again. × takes it off for this opening of the shelf.
 */
export const HereNoteChip = ({
  here,
  onRemove,
}: {
  readonly here: ShelfHere;
  readonly onRemove: () => void;
}) => (
  <span className="bg-primary/15 text-primary dark:bg-primary/30 dark:text-foreground inline-flex h-5 max-w-full min-w-0 items-center gap-1 rounded-md pl-1.5 text-xs font-medium">
    <HugeiconsIcon className="size-3 shrink-0" icon={AppWindowMacIcon} />
    <span className="sr-only">Notes typed now go with </span>
    <Truncated
      text={here.label}
      tooltip={`Notes typed now go with ${here.label}`}
    />
    <InputGroupButton
      aria-label={`Type notes without ${here.label}`}
      className="size-5 shrink-0"
      onClick={onRemove}
      size="icon-xs"
      title={tooltipText(`Type notes without ${here.label}`)}
    >
      <HugeiconsIcon className="size-3" icon={Cancel01Icon} />
    </InputGroupButton>
  </span>
);

import { AppWindowMacIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ShelfHere } from "@shared/contracts";
import { FROM_HERE, parseSearch } from "@shared/due";
import { onlyItems } from "@shared/recall";
import type { ItemGroup, ItemId } from "@shared/shelf";
import { useMemo, useState } from "react";

import { InputGroupButton } from "@/components/ui/input-group";
import { tooltipText } from "@/shared/clamp";

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
 * from: "2 from here" ("Here · 2" at the shelf's narrowest), with the window
 * mark the recall pill has too. It puts `from:here` into the search and
 * stays, pressed and tinted, in words ("2 from here", "Here"), while the
 * filter is on; it keeps the keyboard, so Return on it again takes the
 * filter off.
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
      <span className="max-[340px]:hidden">{count} from here</span>
      {/* Pressed at the shelf's narrowest, "Here" leaves the field room for from:here; the list shows the count. */}
      <span className="hidden max-[340px]:inline">
        {on ? "Here" : `Here · ${count}`}
      </span>
    </InputGroupButton>
  );
};

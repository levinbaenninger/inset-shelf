import { Location01Icon } from "@hugeicons/core-free-icons";
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
 * from: a mark and the count, which put `from:here` into the search. Its
 * words are in its tooltip, so the field keeps room to type at the shelf's
 * narrowest. Open decision 3; main leaves `here` out to drop it.
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
  if (
    here === null ||
    here === undefined ||
    here.ids.length === 0 ||
    parseSearch(query).here
  ) {
    return null;
  }

  const count = here.ids.length;

  return (
    <InputGroupButton
      aria-label={`Show the ${count === 1 ? "item" : `${count} items`} from here`}
      className="shrink-0"
      onClick={() => {
        onChange(withFromHere(query));
      }}
      size="xs"
      title={tooltipText(
        `${count === 1 ? "1 open item" : `${count} open items`} from ${here.label}`
      )}
    >
      <HugeiconsIcon icon={Location01Icon} />
      {count}
    </InputGroupButton>
  );
};

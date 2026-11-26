import {
  Calendar03Icon,
  Cancel01Icon,
  FilterHorizontalIcon,
  Search01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ShelfHere } from "@shared/contracts";
import {
  DUE_FILTER_LABEL,
  DUE_FILTERS,
  dueSuggestions,
  FROM_HERE,
  parseSearch,
} from "@shared/due";
import type { DueFilter } from "@shared/due";
import { keyText } from "@shared/shortcut";
import { useSyncExternalStore } from "react";
import type { RefObject } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { isMac } from "@/shared/platform";

import {
  FromHereChip,
  hereText,
  withFromHere,
  withoutFromHere,
} from "./from-here";

const DUE_WORD = /(?:^|\s)due:\S*/gu;

/** The search with its due filter swapped for another, or taken out. */
export const withDueFilter = (
  query: string,
  filter: DueFilter | null
): string => {
  const words = query.replaceAll(DUE_WORD, " ").trim();

  if (filter === null) {
    return words;
  }

  return words === "" ? `due:${filter}` : `${words} due:${filter}`;
};

/** The tick by the filter that is on. */
const On = () => (
  <HugeiconsIcon
    aria-label="On"
    className="text-primary mr-1 inline size-3.5"
    icon={Tick02Icon}
  />
);

/**
 * The filter button in the search field: the due filters, so `due:` can be
 * found without knowing it, and with items from the window the shelf opened
 * beside, From this window (`from:here`).
 */
const FilterMenu = ({
  current,
  fromHere,
  here,
  onChoose,
  onFromHere,
}: {
  readonly current: DueFilter | null;
  readonly onChoose: (filter: DueFilter | null) => void;
  readonly here: ShelfHere | null | undefined;
  readonly fromHere: boolean;
  readonly onFromHere: (on: boolean) => void;
}) => {
  const anyOn = current !== null || fromHere;
  const recall = here !== null && here !== undefined && here.ids.length > 0;

  return (
    <DropdownMenu modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <InputGroupButton
              aria-label="Filter"
              aria-pressed={anyOn}
              size="icon-xs"
            >
              <HugeiconsIcon
                className={cn(anyOn && "text-primary")}
                icon={FilterHorizontalIcon}
              />
            </InputGroupButton>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Filter</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-60">
        <DropdownMenuLabel>Show items</DropdownMenuLabel>
        {DUE_FILTERS.map((filter) => (
          <DropdownMenuItem
            aria-current={current === filter ? "true" : undefined}
            key={filter}
            onSelect={() => {
              onChoose(current === filter ? null : filter);
            }}
          >
            {DUE_FILTER_LABEL[filter]}
            <DropdownMenuShortcut>
              {current === filter ? <On /> : null}
              due:{filter}
            </DropdownMenuShortcut>
          </DropdownMenuItem>
        ))}
        {recall ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              aria-current={fromHere ? "true" : undefined}
              onSelect={() => {
                onFromHere(!fromHere);
              }}
              title={hereText(here)}
            >
              From this window
              <DropdownMenuShortcut>
                {fromHere ? <On /> : null}
                {FROM_HERE}
              </DropdownMenuShortcut>
            </DropdownMenuItem>
          </>
        ) : null}
        {anyOn ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                onChoose(null);
                onFromHere(false);
              }}
            >
              Show All
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/** Wide enough that the full placeholder fits beside the from-here chip. */
const ROOMY = "(min-width: 420px)";

const roomy = (): boolean => window.matchMedia(ROOMY).matches;

const onWidth = (changed: () => void): (() => void) => {
  const query = window.matchMedia(ROOMY);

  query.addEventListener("change", changed);

  return () => {
    query.removeEventListener("change", changed);
  };
};

/**
 * Under the search field while `due:` is typed: the filters it may become,
 * so a half-typed word never reads as "no matches".
 */
export const DueSuggestions = ({
  onChoose,
  query,
}: {
  readonly query: string;
  readonly onChoose: (filter: DueFilter) => void;
}) => {
  const { pendingDue } = parseSearch(query);

  if (pendingDue === null) {
    return null;
  }

  return (
    <fieldset className="flex flex-col px-2 pb-2" data-no-highlight>
      <legend className="sr-only">Due filters</legend>
      {dueSuggestions(pendingDue).map((filter, index) => (
        <Button
          aria-label={`${DUE_FILTER_LABEL[filter]} (due:${filter})`}
          className="justify-between"
          key={filter}
          onClick={() => {
            onChoose(filter);
          }}
          size="xs"
          title={index === 0 ? "Return picks this one" : undefined}
          variant={index === 0 ? "secondary" : "ghost"}
        >
          due:{filter}
          <span className="text-muted-foreground font-normal">
            {DUE_FILTER_LABEL[filter]}
          </span>
        </Button>
      ))}
    </fieldset>
  );
};

/**
 * The search field: words, and `due:` filters typed or picked from the
 * calendar. Escape clears a search, and hides the shelf when there is none.
 */
export const SearchBar = ({
  here,
  inputRef,
  onChange,
  onHide,
  query,
}: {
  readonly query: string;
  readonly onChange: (query: string) => void;
  readonly onHide: () => void;
  readonly inputRef: RefObject<HTMLInputElement | null>;
  /** Recall: the open items from the window the shelf opened beside. */
  readonly here?: ShelfHere | null;
}) => {
  const chip = here !== null && here !== undefined && here.ids.length > 0;
  // Beside the from-here chip at the shelf's narrower widths, the placeholder is one word, never cut.
  const wide = useSyncExternalStore(onWidth, roomy);
  const { due, here: fromHere } = parseSearch(query);

  return (
    <InputGroup brand>
      <InputGroupAddon>
        <HugeiconsIcon icon={Search01Icon} />
      </InputGroupAddon>
      <InputGroupInput
        aria-label="Search the shelf"
        onChange={(event) => {
          onChange(event.target.value);
        }}
        onKeyDown={(event) => {
          const { pendingDue } = parseSearch(query);

          const [first] = pendingDue === null ? [] : dueSuggestions(pendingDue);

          // Return finishes a due: being typed with the first filter it may become.
          if (event.key === "Enter" && first !== undefined) {
            event.preventDefault();
            onChange(withDueFilter(query, first));
          }

          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();

            if (query === "") {
              onHide();
            } else {
              onChange("");
            }
          }
        }}
        placeholder={chip && !wide ? "Search" : "Search or due:today"}
        ref={inputRef}
        title={`Search (${keyText("CommandOrControl+F", isMac)})`}
        type="text"
        value={query}
      />
      <InputGroupAddon align="inline-end">
        {/* The chip keeps the keyboard, so Return on it turns the filter off again. */}
        <FromHereChip here={here} onChange={onChange} query={query} />
        {query === "" ? null : (
          <InputGroupButton
            aria-label="Clear Search"
            // Searching only from:here in a shelf dragged narrower, the pressed chip clears it the same way and the field keeps the room to show it.
            className={cn(
              query === FROM_HERE &&
                (here?.ids.length ?? 0) > 0 &&
                "max-[330px]:hidden"
            )}
            onClick={() => {
              onChange("");
              inputRef.current?.focus();
            }}
            size="icon-xs"
          >
            <HugeiconsIcon icon={Cancel01Icon} />
          </InputGroupButton>
        )}
        <FilterMenu
          current={due}
          fromHere={fromHere}
          here={here}
          onChoose={(filter) => {
            onChange(withDueFilter(query, filter));
          }}
          onFromHere={(on) => {
            onChange(on ? withFromHere(query) : withoutFromHere(query));
          }}
        />
      </InputGroupAddon>
    </InputGroup>
  );
};

const NOTHING_DUE: Readonly<Record<DueFilter, string>> = {
  any: "Nothing has a Due",
  none: "Every item has a Due",
  overdue: "Nothing is overdue",
  today: "Nothing is due today",
  week: "Nothing is due this week or overdue",
};

/** What an empty search says, so a filter reads as one. */
const noMatchesText = (query: string): string => {
  const { due, here, terms } = parseSearch(query);

  if (here && due === null && terms.length === 0) {
    return "No open items came from the window in front";
  }

  if (due !== null && terms.length === 0) {
    return NOTHING_DUE[due];
  }

  return `No matches for “${query.trim()}”`;
};

/** A search that finds nothing: what it looked for, and a way back. */
export const NoMatches = ({
  onClear,
  query,
}: {
  readonly query: string;
  readonly onClear: () => void;
}) => (
  <div
    className="flex flex-col items-center gap-3 px-6 py-10 text-center"
    data-no-highlight
  >
    <HugeiconsIcon
      className="text-muted-foreground"
      icon={parseSearch(query).due === null ? Search01Icon : Calendar03Icon}
      size={22}
    />
    <p className="text-muted-foreground max-w-full text-sm wrap-anywhere">
      {noMatchesText(query)}
    </p>
    <Button onClick={onClear} size="sm" variant="outline">
      Clear Search
    </Button>
  </div>
);

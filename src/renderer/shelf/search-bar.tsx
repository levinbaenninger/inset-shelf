import {
  Calendar03Icon,
  Cancel01Icon,
  FilterHorizontalIcon,
  Search01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  DUE_FILTER_LABEL,
  DUE_FILTERS,
  dueSuggestions,
  parseSearch,
} from "@shared/due";
import type { DueFilter } from "@shared/due";
import { keyText } from "@shared/shortcut";
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

/** The filter button in the search field: the due filters, so `due:` can be found without knowing it. */
const DueFilterMenu = ({
  current,
  onChoose,
}: {
  readonly current: DueFilter | null;
  readonly onChoose: (filter: DueFilter | null) => void;
}) => (
  <DropdownMenu modal={false}>
    <Tooltip>
      <TooltipTrigger asChild>
        <DropdownMenuTrigger asChild>
          <InputGroupButton
            aria-label="Filter by Due"
            aria-pressed={current !== null}
            size="icon-xs"
          >
            <HugeiconsIcon
              className={cn(current !== null && "text-primary")}
              icon={FilterHorizontalIcon}
            />
          </InputGroupButton>
        </DropdownMenuTrigger>
      </TooltipTrigger>
      <TooltipContent side="bottom">Filter by Due</TooltipContent>
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
            {current === filter ? (
              <HugeiconsIcon
                aria-label="On"
                className="text-primary mr-1 inline size-3.5"
                icon={Tick02Icon}
              />
            ) : null}
            due:{filter}
          </DropdownMenuShortcut>
        </DropdownMenuItem>
      ))}
      {current === null ? null : (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              onChoose(null);
            }}
          >
            Show All
          </DropdownMenuItem>
        </>
      )}
    </DropdownMenuContent>
  </DropdownMenu>
);

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
  inputRef,
  onChange,
  onHide,
  query,
}: {
  readonly query: string;
  readonly onChange: (query: string) => void;
  readonly onHide: () => void;
  readonly inputRef: RefObject<HTMLInputElement | null>;
}) => (
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
      placeholder="Search or due:today"
      ref={inputRef}
      title={`Search (${keyText("CommandOrControl+F", isMac)})`}
      type="text"
      value={query}
    />
    <InputGroupAddon align="inline-end">
      {query === "" ? null : (
        <InputGroupButton
          aria-label="Clear Search"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          size="icon-xs"
        >
          <HugeiconsIcon icon={Cancel01Icon} />
        </InputGroupButton>
      )}
      <DueFilterMenu
        current={parseSearch(query).due}
        onChoose={(filter) => {
          onChange(withDueFilter(query, filter));
        }}
      />
    </InputGroupAddon>
  </InputGroup>
);

const NOTHING_DUE: Readonly<Record<DueFilter, string>> = {
  any: "Nothing has a Due",
  none: "Every item has a Due",
  overdue: "Nothing is overdue",
  today: "Nothing is due today",
  week: "Nothing is due this week or overdue",
};

/** What an empty search says, so a filter reads as one. */
const noMatchesText = (query: string): string => {
  const { due, terms } = parseSearch(query);

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
    <p className="text-muted-foreground text-sm break-words">
      {noMatchesText(query)}
    </p>
    <Button onClick={onClear} size="sm" variant="outline">
      Clear Search
    </Button>
  </div>
);

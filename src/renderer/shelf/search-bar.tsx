import {
  Calendar03Icon,
  Cancel01Icon,
  Search01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { DUE_FILTER_LABEL, DUE_FILTERS, parseSearch } from "@shared/due";
import type { DueFilter } from "@shared/due";
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

/** The calendar in the search field: the due filters, so `due:` can be found without knowing it. */
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
            aria-label="Filter by due date"
            aria-pressed={current !== null}
            size="icon-xs"
          >
            <HugeiconsIcon
              className={cn(current !== null && "text-pin-ink")}
              icon={Calendar03Icon}
            />
          </InputGroupButton>
        </DropdownMenuTrigger>
      </TooltipTrigger>
      <TooltipContent side="bottom">Filter by due date</TooltipContent>
    </Tooltip>
    <DropdownMenuContent align="end" className="min-w-52">
      <DropdownMenuLabel>Show items</DropdownMenuLabel>
      {DUE_FILTERS.map((filter) => (
        <DropdownMenuItem
          key={filter}
          onSelect={() => {
            onChoose(current === filter ? null : filter);
          }}
        >
          <HugeiconsIcon
            className={cn(current !== filter && "invisible")}
            icon={Tick02Icon}
          />
          {DUE_FILTER_LABEL[filter]}
          <DropdownMenuShortcut>due:{filter}</DropdownMenuShortcut>
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
  <InputGroup>
    <InputGroupAddon>
      <HugeiconsIcon icon={Search01Icon} />
    </InputGroupAddon>
    <InputGroupInput
      aria-label="Search the shelf"
      onChange={(event) => {
        onChange(event.target.value);
      }}
      onKeyDown={(event) => {
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
      placeholder="Search, or due:today"
      ref={inputRef}
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

/** What an empty search says, so a filter reads as one. */
const noMatchesText = (query: string): string => {
  const { due, terms } = parseSearch(query);

  if (due !== null && terms.length === 0) {
    return due === "none"
      ? "Every item has a due date"
      : `Nothing ${DUE_FILTER_LABEL[due].toLowerCase()}`;
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

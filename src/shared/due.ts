/**
 * Due dates: a calendar day, stored as `YYYY-MM-DD` with no time, read in
 * the local time zone. "Due" is a deadline ("should be done by"); it never
 * hides an item.
 */

const ISO_DATE = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u;

const pad = (value: number): string => String(value).padStart(2, "0");

/** The local calendar day of a moment, as `YYYY-MM-DD`; toISOString would shift it near midnight. */
export const isoDay = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** A stored day as a local date at midnight; null when it is no real day. */
export const parseDay = (iso: string): Date | null => {
  const groups = ISO_DATE.exec(iso)?.groups;

  if (groups === undefined) {
    return null;
  }

  const year = Number(groups.year);
  const month = Number(groups.month) - 1;
  const day = Number(groups.day);
  const date = new Date(year, month, day);

  return date.getFullYear() === year &&
    date.getMonth() === month &&
    date.getDate() === day
    ? date
    : null;
};

export const isValidDay = (iso: string): boolean => parseDay(iso) !== null;

const addDays = (date: Date, days: number): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

const SATURDAY = 6;
const SUNDAY = 0;
const MONDAY = 1;
const WEEK = 7;

export type DueChoice = "today" | "tomorrow" | "weekend" | "nextWeek";

export const DUE_CHOICES: readonly DueChoice[] = [
  "today",
  "tomorrow",
  "weekend",
  "nextWeek",
];

export const DUE_CHOICE_LABEL: Readonly<Record<DueChoice, string>> = {
  nextWeek: "Next week",
  today: "Today",
  tomorrow: "Tomorrow",
  weekend: "This weekend",
};

/**
 * The day a quick choice stands for. This weekend is the coming Saturday, or
 * today on a Saturday or Sunday; next week is the coming Monday, a week on
 * from a Monday.
 */
export const dueFor = (choice: DueChoice, now: Date): string => {
  const weekday = now.getDay();

  switch (choice) {
    case "today": {
      return isoDay(now);
    }

    case "tomorrow": {
      return isoDay(addDays(now, 1));
    }

    case "weekend": {
      return weekday === SATURDAY || weekday === SUNDAY
        ? isoDay(now)
        : isoDay(addDays(now, SATURDAY - weekday));
    }

    case "nextWeek": {
      return isoDay(addDays(now, ((MONDAY - weekday + WEEK - 1) % WEEK) + 1));
    }

    default: {
      return isoDay(now);
    }
  }
};

/** How a due day stands against today. "week" is the next six days after today. */
export type DueBucket = "overdue" | "today" | "week" | "later";

const daysBetween = (from: Date, to: Date): number =>
  Math.round(
    (Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) -
      Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) /
      86_400_000
  );

/** Whole days from today to the due day: negative when overdue. */
export const daysUntil = (due: string, now: Date): number | null => {
  const day = parseDay(due);

  return day === null ? null : daysBetween(now, day);
};

export const dueBucket = (due: string, now: Date): DueBucket => {
  const days = daysUntil(due, now) ?? 0;

  if (days < 0) {
    return "overdue";
  }

  if (days === 0) {
    return "today";
  }

  return days < WEEK ? "week" : "later";
};

/**
 * A calendar date in the system's own format ("5 Nov", "Nov 5"), the year
 * only when it isn't this year. `locale` is left out except in tests.
 */
export const dateText = (
  date: Date,
  now: Date,
  options: { readonly weekday?: boolean; readonly locale?: string } = {}
): string =>
  new Intl.DateTimeFormat(options.locale, {
    day: "numeric",
    month: "short",
    weekday: options.weekday === true ? "short" : undefined,
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  }).format(date);

/**
 * A due day as a chip says it: Today, Tomorrow, Yesterday, the weekday in
 * the next six days, else the date.
 */
export const dueText = (due: string, now: Date, locale?: string): string => {
  const day = parseDay(due);
  const days = daysUntil(due, now);

  if (day === null || days === null) {
    return due;
  }

  const near = new Map([
    [-1, "Yesterday"],
    [0, "Today"],
    [1, "Tomorrow"],
  ]);

  if (near.has(days)) {
    return near.get(days) ?? due;
  }

  return days > 1 && days < WEEK
    ? new Intl.DateTimeFormat(locale, { weekday: "short" }).format(day)
    : dateText(day, now, { locale });
};

/** What the Due chip reads: an overdue day says so in words, not by colour alone. */
export const dueChipText = (due: string, now: Date, locale?: string): string =>
  dueBucket(due, now) === "overdue"
    ? `Overdue · ${dueText(due, now, locale)}`
    : dueText(due, now, locale);

/** A due filter typed into search: `due:today`, `due:overdue`, `due:week`, or `due:any` / `due:none`. */
export type DueFilter = "today" | "overdue" | "week" | "any" | "none";

export const DUE_FILTERS: readonly DueFilter[] = [
  "today",
  "overdue",
  "week",
  "any",
  "none",
];

const isDueFilter = (value: string): value is DueFilter =>
  DUE_FILTERS.some((filter) => filter === value);

/** Whether a due day passes a filter. "week" holds today and the six days after it, and anything overdue. */
export const matchesDue = (
  due: string | null,
  filter: DueFilter,
  now: Date
): boolean => {
  if (filter === "none") {
    return due === null;
  }

  if (due === null) {
    return false;
  }

  if (filter === "any") {
    return true;
  }

  const bucket = dueBucket(due, now);

  if (filter === "week") {
    return bucket !== "later";
  }

  return bucket === filter;
};

export interface SearchQuery {
  /** Lower-case words that must all appear. */
  readonly terms: readonly string[];
  readonly due: DueFilter | null;
  /** What follows a `due:` still being typed, which filters nothing yet. */
  readonly pendingDue: string | null;
}

const SEARCH_TERM = /\s+/u;
const DUE_TOKEN = /^due:(?<filter>\S*)$/u;

/**
 * Splits a search into words and an optional due filter. A `due:` word that
 * names no filter yet is held back, so it never empties the list while typed.
 */
export const parseSearch = (query: string): SearchQuery => {
  let due: DueFilter | null = null;
  let pendingDue: string | null = null;
  const terms: string[] = [];

  for (const word of query.toLocaleLowerCase().split(SEARCH_TERM)) {
    const filter = DUE_TOKEN.exec(word)?.groups?.filter;

    if (filter !== undefined && isDueFilter(filter)) {
      due = filter;
    } else if (filter === undefined) {
      if (word !== "") {
        terms.push(word);
      }
    } else {
      pendingDue = filter;
    }
  }

  return { due, pendingDue, terms };
};

/** The filters a `due:` being typed may become; all of them when none starts with it. */
export const dueSuggestions = (pending: string): readonly DueFilter[] => {
  const started = DUE_FILTERS.filter((filter) => filter.startsWith(pending));

  return started.length === 0 ? DUE_FILTERS : started;
};

export const DUE_FILTER_LABEL: Readonly<Record<DueFilter, string>> = {
  any: "Has a Due",
  none: "No Due",
  overdue: "Overdue",
  today: "Due today",
  week: "Due this week (incl. overdue)",
};

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

const WEEKDAY = new Intl.DateTimeFormat("en", { weekday: "short" });

const SHORT_DATE = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
});

const LONG_DATE = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  weekday: "short",
});

/**
 * A due day as the chip shows it: Today, Tomorrow, Yesterday, a weekday in
 * the coming week, else the date. `long` adds the date to a weekday.
 */
export const dueText = (due: string, now: Date, long = false): string => {
  const day = parseDay(due);
  const days = daysUntil(due, now);

  if (day === null || days === null) {
    return due;
  }

  if (days === 0) {
    return "Today";
  }

  if (days === 1) {
    return "Tomorrow";
  }

  if (days === -1) {
    return "Yesterday";
  }

  if (days > 1 && days < WEEK) {
    return long ? LONG_DATE.format(day) : WEEKDAY.format(day);
  }

  return long ? LONG_DATE.format(day) : SHORT_DATE.format(day);
};

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
}

const SEARCH_TERM = /\s+/u;
const DUE_TOKEN = /^due:(?<filter>[a-z]*)$/u;

/** Splits a search into words and an optional due filter; an unknown `due:` word is searched as text. */
export const parseSearch = (query: string): SearchQuery => {
  let due: DueFilter | null = null;
  const terms: string[] = [];

  for (const word of query.toLocaleLowerCase().split(SEARCH_TERM)) {
    const filter = DUE_TOKEN.exec(word)?.groups?.filter;

    if (filter !== undefined && isDueFilter(filter)) {
      due = filter;
    } else if (word !== "") {
      terms.push(word);
    }
  }

  return { due, terms };
};

export const DUE_FILTER_LABEL: Readonly<Record<DueFilter, string>> = {
  any: "Has a due date",
  none: "No due date",
  overdue: "Overdue",
  today: "Due today",
  week: "Due this week",
};

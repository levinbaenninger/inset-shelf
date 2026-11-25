// The app's quick due choices and chip text (apps/desktop/src/shared/due.ts), in the visitor's time zone and language.

export type DueChoice = "today" | "tomorrow" | "weekend" | "nextWeek";

export const DUE_CHOICES: { choice: DueChoice; label: string }[] = [
  { choice: "today", label: "Today" },
  { choice: "tomorrow", label: "Tomorrow" },
  { choice: "weekend", label: "This weekend" },
  { choice: "nextWeek", label: "Next week" },
];

const SATURDAY = 6;
const SUNDAY = 0;
const MONDAY = 1;
const WEEK = 7;
const DAY_MS = 86_400_000;

const addDays = (date: Date, days: number): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

/** Days from today, by weekday: this weekend is the coming Saturday, or today at a weekend; next week is the coming Monday. */
const DAYS_AHEAD: Record<DueChoice, (weekday: number) => number> = {
  today: () => 0,
  tomorrow: () => 1,
  weekend: (weekday) =>
    weekday === SATURDAY || weekday === SUNDAY ? 0 : SATURDAY - weekday,
  nextWeek: (weekday) => ((MONDAY - weekday + WEEK - 1) % WEEK) + 1,
};

export const dueFor = (choice: DueChoice, now: Date): Date =>
  addDays(now, DAYS_AHEAD[choice](now.getDay()));

const daysBetween = (from: Date, to: Date): number =>
  Math.round(
    (Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) -
      Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) /
      DAY_MS
  );

/** The menu's date beside each choice: "Wed, Nov 25". */
export const menuDate = (day: Date): string =>
  new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    weekday: "short",
  }).format(day);

/** What the Due chip says: Today, Tomorrow, a weekday within the week, else the date. */
export const chipText = (day: Date, now: Date): string => {
  const days = daysBetween(now, day);

  if (days === 0) {
    return "Today";
  }

  if (days === 1) {
    return "Tomorrow";
  }

  return days > 1 && days < WEEK
    ? new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(day)
    : new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        month: "short",
      }).format(day);
};

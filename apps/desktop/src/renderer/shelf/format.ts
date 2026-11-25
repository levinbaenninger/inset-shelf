import { dateText } from "@shared/due";

const time = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/** Today's items show the time; older ones the date, with the year when it isn't this one. */
export const whenText = (iso: string, now = new Date()): string => {
  const date = new Date(iso);

  return sameDay(date, now) ? time.format(date) : dateText(date, now);
};

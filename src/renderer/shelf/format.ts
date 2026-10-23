const time = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

const day = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
});

const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/** Today's items show the time; older ones the date. */
export const whenText = (iso: string, now = new Date()): string => {
  const date = new Date(iso);

  return sameDay(date, now) ? time.format(date) : day.format(date);
};

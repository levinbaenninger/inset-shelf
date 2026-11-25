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

const SIZE_UNITS = ["kilobyte", "megabyte", "gigabyte"] as const;

const SIZES = SIZE_UNITS.map(
  (unit) =>
    new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 1,
      style: "unit",
      unit,
      unitDisplay: "short",
    })
);

/** A file's size as Finder says it: bytes, kB, MB or GB, in powers of 1000. */
export const fileSizeText = (bytes: number): string => {
  if (bytes < 1000) {
    return bytes === 1 ? "1 byte" : `${bytes} bytes`;
  }

  let index = 0;
  let value = bytes / 1000;

  while (value >= 1000 && index < SIZE_UNITS.length - 1) {
    value /= 1000;
    index += 1;
  }

  return SIZES[index]?.format(value) ?? `${bytes} bytes`;
};

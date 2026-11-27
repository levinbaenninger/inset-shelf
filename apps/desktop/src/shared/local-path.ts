/**
 * Checks on paths and names that reach the file system or `open`. Pure, so
 * main, the preload and the tests share them.
 */

const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/u;
const NUL = /\0/u;

/**
 * A path on this computer: POSIX absolute (/Users/…) or a Windows drive path
 * (C:\…). Not a network share (\\host\share, //host/share, file:////host),
 * not a device path (\\?\…), not relative, no NUL.
 */
export const isLocalAbsolutePath = (value: string): boolean => {
  if (value === "" || NUL.test(value)) {
    return false;
  }

  if (/^[\\/]{2}/u.test(value)) {
    return false;
  }

  return value.startsWith("/") || WINDOWS_DRIVE.test(value);
};

/** True when a path climbs out of where it starts: any ".." segment. */
export const hasParentSegment = (value: string): boolean =>
  value.split(/[\\/]/u).includes("..");

/**
 * The bundle a Mac app is opened from: an absolute local path to a
 * directory named *.app, written without "..".
 */
export const isAppBundlePath = (value: string): boolean => {
  if (!isLocalAbsolutePath(value) || hasParentSegment(value)) {
    return false;
  }

  return /\/[^/]+\.app$/iu.test(value.replace(/\/+$/u, ""));
};

/** An app's display name, as `open -a` takes it: no separators, no leading dash, no control characters. */
export const isAppName = (value: string): boolean =>
  value.length > 0 &&
  value.length <= 128 &&
  !value.startsWith("-") &&
  !/[\\/\p{Cc}]/u.test(value) &&
  value !== "." &&
  value !== "..";

/**
 * A name a stored file keeps and is written under when dragged out: one path
 * segment, never "." or "..", no separators or NUL.
 */
export const isSafeFileName = (value: string): boolean =>
  value !== "" && value !== "." && value !== ".." && !/[/\\\0]/u.test(value);

/** The name a dropped file is stored under: separators and NUL replaced; "File" when nothing usable is left. */
export const safeFileName = (value: string): string => {
  const cleaned = value
    .replaceAll(/[/\\\0]/gu, "_")
    .trim()
    .slice(0, 255);

  return isSafeFileName(cleaned) ? cleaned : "File";
};

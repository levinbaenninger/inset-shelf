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
 * The bundle a Mac app is opened from: an absolute POSIX path to a directory
 * named *.app, written without "..". A Windows path is none.
 */
export const isAppBundlePath = (value: string): boolean =>
  value.startsWith("/") &&
  !value.startsWith("//") &&
  !NUL.test(value) &&
  !hasParentSegment(value) &&
  /\/[^/]+\.app\/?$/iu.test(value);

/** An app's display name, as `open -a` takes it: no separators, no leading dash, no control characters. */
export const isAppName = (value: string): boolean =>
  value.length > 0 &&
  value.length <= 128 &&
  !value.startsWith("-") &&
  !/[\\/\p{Cc}]/u.test(value) &&
  value !== "." &&
  value !== "..";

/** Characters a file name can't hold on Windows (":" also starts an NTFS stream, or a drive on "C:name"), and control characters. */
// oxlint-disable-next-line no-control-regex -- control characters are the point
const UNSAFE_NAME_CHARS = /[<>:"|?*\\/\u0000-\u001F\u007F]/u;
const TRAILING_DOTS_AND_SPACES = /[.\s]+$/u;

/**
 * A name a stored file keeps and is written under when dragged out: one path
 * segment that is the same on macOS and Windows, never "." or "..", with none
 * of <>:"/\|?*, control characters, or trailing dots or spaces.
 */
export const isSafeFileName = (value: string): boolean =>
  value !== "" &&
  !UNSAFE_NAME_CHARS.test(value) &&
  !TRAILING_DOTS_AND_SPACES.test(value);

/** The name a dropped file is stored under: unsafe characters replaced with "_", trailing dots and spaces dropped; "File" when nothing usable is left. */
export const safeFileName = (value: string): string => {
  const cleaned = value
    .replaceAll(new RegExp(UNSAFE_NAME_CHARS, "gu"), "_")
    .slice(0, 255)
    .replace(TRAILING_DOTS_AND_SPACES, "")
    .trimStart();

  return isSafeFileName(cleaned) ? cleaned : "File";
};

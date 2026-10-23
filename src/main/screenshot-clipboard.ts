/** A screenshot copied to the clipboard holds a PNG and nothing else; an image copied from an app brings more. */
const SCREENSHOT_TYPES = new Set(["public.png", "public.tiff"]);

export const isScreenshotClipboard = (types: readonly string[]): boolean =>
  types.includes("public.png") &&
  types.every((type) => SCREENSHOT_TYPES.has(type));

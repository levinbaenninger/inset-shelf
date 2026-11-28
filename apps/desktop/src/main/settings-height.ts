/** The tallest the Settings window gets, however tall the display. */
export const MAX_SETTINGS_HEIGHT = 720;

/** The share of the display's work area the Settings window may take. */
const WORK_AREA_SHARE = 0.85;

/**
 * The window's content height: the page's own height, limited to the display
 * the window is on. A taller page scrolls under its header.
 */
export const clampSettingsHeight = (
  wanted: number,
  workAreaHeight: number
): number =>
  Math.max(
    1,
    Math.min(
      Math.ceil(wanted),
      MAX_SETTINGS_HEIGHT,
      Math.floor(workAreaHeight * WORK_AREA_SHARE)
    )
  );

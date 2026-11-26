import {
  APP_NAME_MAX,
  fitText,
  PATH_MAX,
  WINDOW_TITLE_MAX,
  WindowRefSchema,
} from "@shared/shelf";
import type { ShelfImage, WindowId, WindowRef } from "@shared/shelf";

/** What the system reported about a window the user picked, before it is kept. */
export interface CapturedWindow {
  readonly app: string | null;
  readonly appPath: string | null;
  readonly title: string | null;
  readonly url: string | null;
  readonly document: string | null;
  readonly thumb: ShelfImage | null;
}

const fitOrNull = (text: string | null, max: number): string | null =>
  text === null ? null : fitText(text, max);

/** A path cut short points somewhere else, so one that doesn't fit is dropped. */
const wholeOrNull = (text: string | null, max: number): string | null =>
  text !== null && text.length <= max ? text : null;

/**
 * A linked window as the saved shelf can hold it: names cut to fit, a page
 * or file only when it is kept whole. One odd window never makes the shelf
 * file unreadable.
 */
export const windowRef = (
  window: CapturedWindow,
  id: WindowId,
  capturedAt: Date
): WindowRef =>
  WindowRefSchema.parse({
    app: fitOrNull(window.app, APP_NAME_MAX),
    appPath: wholeOrNull(window.appPath, PATH_MAX),
    capturedAt: capturedAt.toISOString(),
    description: "",
    document: wholeOrNull(window.document, PATH_MAX),
    id,
    thumb: window.thumb,
    title: fitOrNull(window.title, WINDOW_TITLE_MAX),
    url: WindowRefSchema.shape.url.safeParse(window.url).success
      ? window.url
      : null,
  });

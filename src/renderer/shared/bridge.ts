import type {
  DrawingContract,
  ScreenshotContract,
  SettingsContract,
  ShelfContract,
  ToastContract,
} from "@shared/contracts";
import type { Client } from "@shared/ipc";

declare global {
  // Each window's preload exposes exactly one of these (see src/preload/expose.ts).
  interface Window {
    readonly insetShelf?: Client<ShelfContract>;
    readonly insetToast?: Client<ToastContract>;
    readonly insetScreenshot?: Client<ScreenshotContract>;
    readonly insetDrawing?: Client<DrawingContract>;
    readonly insetSettings?: Client<SettingsContract>;
    readonly insetFiles?: { readonly pathFor: (file: File) => string };
  }
}

const require = <T>(api: T | undefined, where: string): T => {
  if (api === undefined) {
    throw new Error(`This bridge is only available in the ${where}.`);
  }

  return api;
};

export const shelfBridge = (): Client<ShelfContract> =>
  require(window.insetShelf, "shelf window");

export const screenshotBridge = (): Client<ScreenshotContract> =>
  require(window.insetScreenshot, "screenshot card");

export const toastBridge = (): Client<ToastContract> =>
  require(window.insetToast, "toast");

export const drawingBridge = (): Client<DrawingContract> =>
  require(window.insetDrawing, "drawing window");

/** The path of a dropped or pasted file; empty when it has none, such as an image copied from a page. */
export const filePath = (file: File): string =>
  window.insetFiles?.pathFor(file) ?? "";

export const settingsBridge = (): Client<SettingsContract> =>
  require(window.insetSettings, "settings window");

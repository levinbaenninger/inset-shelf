import type {
  DrawingContract,
  OnboardingContract,
  PickerContract,
  ScreenshotContract,
  SettingsContract,
  ShelfContract,
  ToastContract,
} from "@shared/contracts";
import type { Client } from "@shared/ipc";

/** The shelf's methods as the page sees them: addFiles is only reachable through insetFiles (src/preload/shelf.ts). */
type ShelfClient = Omit<Client<ShelfContract>, "addFiles">;

declare global {
  // Each window's preload exposes exactly one of these (see src/preload/expose.ts).
  interface Window {
    readonly insetShelf?: ShelfClient;
    readonly insetToast?: Client<ToastContract>;
    readonly insetScreenshot?: Client<ScreenshotContract>;
    readonly insetDrawing?: Client<DrawingContract>;
    readonly insetSettings?: Client<SettingsContract>;
    readonly insetPicker?: Client<PickerContract>;
    readonly insetOnboarding?: Client<OnboardingContract>;
    readonly insetDev?: boolean;
    readonly insetFiles?: {
      readonly add: (
        files: readonly File[]
      ) => Promise<{ readonly count: number; readonly ok: boolean } | null>;
    };
  }
}

const require = <T>(api: T | undefined, where: string): T => {
  if (api === undefined) {
    throw new Error(`This bridge is only available in the ${where}.`);
  }

  return api;
};

export const shelfBridge = (): ShelfClient =>
  require(window.insetShelf, "shelf window");

export const screenshotBridge = (): Client<ScreenshotContract> =>
  require(window.insetScreenshot, "screenshot card");

export const toastBridge = (): Client<ToastContract> =>
  require(window.insetToast, "toast");

export const drawingBridge = (): Client<DrawingContract> =>
  require(window.insetDrawing, "drawing window");

/**
 * Adds dropped or pasted files; null when none has a path on disk, such as an
 * image copied from a page. The page never sees or sends the paths.
 */
export const addFiles = async (
  files: readonly File[]
): Promise<{ readonly count: number; readonly ok: boolean } | null> =>
  (await window.insetFiles?.add(files)) ?? null;

export const settingsBridge = (): Client<SettingsContract> =>
  require(window.insetSettings, "settings window");

export const pickerBridge = (): Client<PickerContract> =>
  require(window.insetPicker, "window-link picker");

export const onboardingBridge = (): Client<OnboardingContract> =>
  require(window.insetOnboarding, "onboarding window");

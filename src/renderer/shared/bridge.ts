import type {
  OverlayContract,
  ShelfContract,
  ToastContract,
} from "@shared/contracts";
import type { Client } from "@shared/ipc";

declare global {
  // Each window's preload exposes exactly one of these (see src/preload/expose.ts).
  interface Window {
    readonly insetShelf?: Client<ShelfContract>;
    readonly insetOverlay?: Client<OverlayContract>;
    readonly insetToast?: Client<ToastContract>;
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

export const overlayBridge = (): Client<OverlayContract> =>
  require(window.insetOverlay, "area overlay");

export const toastBridge = (): Client<ToastContract> =>
  require(window.insetToast, "toast");

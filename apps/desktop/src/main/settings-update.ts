import type { IconPlace, Settings } from "@shared/settings";

import type { SettingsWindow } from "./settings-window";

/** What a change made in Settings reaches. */
export interface SettingsReach {
  readonly current: () => Settings;
  /** Writes the change; a failed write keeps it for this run. */
  readonly save: (change: Partial<Settings>) => Promise<void>;
  /** The rest of the app that follows the settings: screenshot cards, recall. */
  readonly follow: () => void;
  readonly placeIcon: (place: IconPlace) => void;
  readonly window: Pick<SettingsWindow, "isOpen" | "open">;
  /** Settings shows the settings as they are now. */
  readonly showView: () => void;
}

/** Saves a change made in Settings, then brings the app in line with it. */
export const updateSettings = async (
  change: Partial<Settings>,
  reach: SettingsReach
): Promise<void> => {
  const before = reach.current().iconIn;

  await reach.save(change);
  reach.follow();

  const { iconIn } = reach.current();

  if (iconIn !== before) {
    // Turning into an accessory can send the app's windows away, so Settings comes back, unless Esc or its × closed it while the change saved.
    const open = reach.window.isOpen();

    reach.placeIcon(iconIn);

    if (open) {
      reach.window.open();
    }
  }

  reach.showView();
};

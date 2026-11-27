import { DEFAULT_SETTINGS } from "@shared/settings";
import type { Settings } from "@shared/settings";
import { describe, expect, it } from "vite-plus/test";

import { updateSettings } from "./settings-update";

/** Settings open on the icon setting, with a write that waits until `written` is called. */
const settingsApp = () => {
  let settings: Settings = { ...DEFAULT_SETTINGS, iconIn: "dockAndMenuBar" };
  let written = (): void => undefined;
  let open = true;
  const opened: string[] = [];

  const window = {
    close: () => {
      open = false;
    },
    isOpen: () => open,
    open: () => {
      open = true;
      opened.push("open");
    },
  };

  return {
    close: window.close,
    isOpen: window.isOpen,
    opened,
    reach: {
      current: () => settings,
      follow: () => undefined,
      placeIcon: () => undefined,
      save: async (change: Partial<Settings>) => {
        settings = { ...settings, ...change };
        await new Promise<void>((resolve) => {
          written = resolve;
        });
      },
      showView: () => undefined,
      window,
    },
    written: () => {
      written();
    },
  };
};

describe(updateSettings, () => {
  it("brings Settings back after the icon moves, while Settings is open", async () => {
    const app = settingsApp();
    const update = updateSettings({ iconIn: "menuBar" }, app.reach);

    app.written();
    await update;

    expect(app.opened).toStrictEqual(["open"]);
  });

  it("leaves Settings closed when Esc closed it while the icon change was saving", async () => {
    const app = settingsApp();
    const update = updateSettings({ iconIn: "menuBar" }, app.reach);

    app.close();
    app.written();
    await update;

    expect(app.isOpen()).toBe(false);
  });
});

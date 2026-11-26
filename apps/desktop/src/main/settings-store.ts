import path from "node:path";

import { readSettings } from "@shared/settings";
import type { Settings } from "@shared/settings";

import type { StoreFs } from "./shelf-store";

export interface SettingsStore {
  readonly current: () => Settings;
  /** Applies a change and writes the whole file; a failed write keeps the change for this run. */
  readonly update: (change: Partial<Settings>) => Promise<Settings>;
}

/** The app's settings, kept in settings.json beside the shelf. */
export const openSettingsStore = async (
  dataDir: string,
  fs: Pick<StoreFs, "readFile" | "writeAtomic">
): Promise<SettingsStore> => {
  const file = path.join(dataDir, "settings.json");

  let settings = readSettings(await fs.readFile(file).catch((): null => null));

  return {
    current: () => settings,
    update: async (change) => {
      settings = { ...settings, ...change };
      await fs.writeAtomic(file, `${JSON.stringify(settings, null, 2)}\n`);

      return settings;
    },
  };
};

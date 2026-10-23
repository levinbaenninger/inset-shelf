import { DEFAULT_SETTINGS } from "@shared/settings";
import { describe, expect, it } from "vitest";

import { openSettingsStore } from "./settings-store";

const memoryFs = (initial: Record<string, string>) => {
  const files = new Map(Object.entries(initial));

  return {
    files,
    readFile: async (file: string): Promise<string> => {
      const text = files.get(file);

      if (text === undefined) {
        throw new Error("ENOENT");
      }

      return await Promise.resolve(text);
    },
    writeAtomic: async (file: string, data: string | Uint8Array) => {
      files.set(file, String(data));
      await Promise.resolve();
    },
  };
};

describe(openSettingsStore, () => {
  it("starts from the defaults without a file", async () => {
    const store = await openSettingsStore("/data", memoryFs({}));

    expect(store.current()).toStrictEqual(DEFAULT_SETTINGS);
  });

  it("writes a change and reads it back", async () => {
    const fs = memoryFs({});
    const first = await openSettingsStore("/data", fs);

    await first.update({ markDoneOnCopy: true });

    const second = await openSettingsStore("/data", fs);

    expect(second.current()).toStrictEqual({
      ...DEFAULT_SETTINGS,
      markDoneOnCopy: true,
    });
  });
});

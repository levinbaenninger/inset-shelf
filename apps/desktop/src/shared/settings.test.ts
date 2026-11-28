import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_SETTINGS, readSettings } from "./settings";

describe(readSettings, () => {
  it("keeps stored values and fills the rest with defaults", () => {
    expect(
      readSettings(JSON.stringify({ markDoneOnCopy: true }))
    ).toStrictEqual({
      ...DEFAULT_SETTINGS,
      markDoneOnCopy: true,
    });
  });

  it("falls back to the defaults for damaged settings", () => {
    expect(readSettings(JSON.stringify({ iconIn: "taskbar" }))).toStrictEqual(
      DEFAULT_SETTINGS
    );
    expect(readSettings("{ broken")).toStrictEqual(DEFAULT_SETTINGS);
  });

  it("turns recall on for settings saved before it existed, and keeps it off once turned off", () => {
    expect(
      readSettings(JSON.stringify({ markDoneOnCopy: true })).recall
    ).toBeTruthy();
    expect(readSettings(JSON.stringify({ recall: false })).recall).toBeFalsy();
  });
});

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

  it("leaves chat lookups and screenshot cards off for a new install", () => {
    expect(readSettings(null)).toMatchObject({
      chatLookups: false,
      screenshotCards: false,
    });
  });

  it("reads settings stored before chat lookups existed as off, keeping the stored values", () => {
    expect(
      readSettings(
        JSON.stringify({
          iconIn: "dock",
          markDoneOnCopy: true,
          screenshotCards: true,
        })
      )
    ).toStrictEqual({
      chatLookups: false,
      iconIn: "dock",
      markDoneOnCopy: true,
      screenshotCards: true,
    });
  });
});

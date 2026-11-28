import { describe, expect, it } from "vite-plus/test";

import { clampSettingsHeight, MAX_SETTINGS_HEIGHT } from "./settings-height";

describe(clampSettingsHeight, () => {
  it("keeps a page that fits", () => {
    expect(clampSettingsHeight(500, 1000)).toBe(500);
  });

  it("limits to 85% of the work area", () => {
    expect(clampSettingsHeight(700, 600)).toBe(510);
  });

  it("limits to a fixed maximum on tall displays", () => {
    expect(clampSettingsHeight(2000, 2000)).toBe(MAX_SETTINGS_HEIGHT);
  });
});

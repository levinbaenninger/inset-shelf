import { describe, expect, it } from "vite-plus/test";

import { shortcutSheet } from "./shortcuts";

const pickSeveral = (mac: boolean) =>
  shortcutSheet(mac)
    .flatMap((group) => group.rows)
    .find((row) => row.label === "Pick several items")?.keys;

describe(shortcutSheet, () => {
  it("writes the clicks that pick several items as each system names them", () => {
    expect([pickSeveral(true), pickSeveral(false)]).toStrictEqual([
      ["⌘-click", "⇧-click"],
      ["Ctrl+click", "Shift+click"],
    ]);
  });
});

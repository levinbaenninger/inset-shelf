import { describe, expect, it } from "vitest";

import { trayMenu, trayTooltip } from "./tray-menu";
import type { TrayItem, TrayModel } from "./tray-menu";

const base: TrayModel = {
  keys: "granted",
  shelfVisible: false,
  shortcutsRegistered: true,
};

const names = (items: readonly TrayItem[]): string[] =>
  items.map((item) => {
    if (item.kind === "separator") {
      return "---";
    }

    return item.kind === "role" ? `[${item.role}]` : item.label;
  });

describe(trayMenu, () => {
  it("lists the app's actions, then About and Quit", () => {
    expect(names(trayMenu(base))).toStrictEqual([
      "Show Inset Shelf",
      "Capture Area",
      "---",
      "[about]",
      "[quit]",
    ]);
  });

  it("offers the permission only while it is missing", () => {
    expect(names(trayMenu({ ...base, keys: "missing" }))).toContain(
      "Turn On Double Shift…"
    );
  });

  it("names the action that the shelf's state allows", () => {
    expect(trayMenu({ ...base, shelfVisible: true })[0]).toMatchObject({
      label: "Hide Inset Shelf",
    });
  });

  it("shows accelerators only when they were registered", () => {
    expect(trayMenu(base)[0]).toMatchObject({ accelerator: "Control+Alt+S" });
    expect(
      trayMenu({ ...base, shortcutsRegistered: false })[0]
    ).not.toHaveProperty("accelerator");
  });
});

describe(trayTooltip, () => {
  it("names the app and its shortcut", () => {
    expect(trayTooltip(true)).toBe("Inset Shelf (⌃⌥S)");
  });
});

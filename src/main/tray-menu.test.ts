import { describe, expect, it } from "vitest";

import { trayMenu, trayTooltip } from "./tray-menu";
import type { TrayItem, TrayModel } from "./tray-menu";

const base: TrayModel = {
  keys: "granted",
  shelfVisible: false,
  shortcutsRegistered: true,
  update: { kind: "idle" },
  version: "0.1.900",
};

const names = (items: readonly TrayItem[]): string[] =>
  items.map((item) => {
    if (item.kind === "separator") {
      return "---";
    }

    if (item.kind === "label") {
      return `(${item.label})`;
    }

    return item.kind === "role" ? `[${item.role}]` : item.label;
  });

describe(trayMenu, () => {
  it("lists the app's actions, the version and its update, then About and Quit", () => {
    expect(names(trayMenu(base))).toStrictEqual([
      "Show Inset Shelf",
      "---",
      "Settings…",
      "---",
      "(Version 0.1.900)",
      "Check for Updates…",
      "---",
      "[about]",
      "[quit]",
    ]);
  });

  it("offers the restart once an update is ready", () => {
    expect(
      trayMenu({ ...base, update: { kind: "ready", version: "0.1.901" } })
    ).toContainEqual({
      action: "restartToUpdate",
      kind: "item",
      label: "Restart to Update to v0.1.901",
    });
  });

  it("shows a download in progress as a disabled line", () => {
    expect(
      names(
        trayMenu({
          ...base,
          update: { kind: "downloading", percent: 42, version: "0.1.901" },
        })
      )
    ).toContain("(Downloading v0.1.901… 42%)");
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

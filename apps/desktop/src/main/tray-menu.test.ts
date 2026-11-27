import { describe, expect, it } from "vite-plus/test";

import { iconClick, trayMenu, trayTooltip } from "./tray-menu";
import type { TrayItem, TrayModel } from "./tray-menu";

const base: TrayModel = {
  mac: true,
  setUpPermissions: false,
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
      "Keyboard Shortcuts",
      "Getting Started",
      "Show Me Around",
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

  it("offers Set Up Permissions… after Settings… on macOS", () => {
    const labels = names(trayMenu({ ...base, setUpPermissions: true }));

    expect(labels.indexOf("Set Up Permissions…")).toBe(
      labels.indexOf("Settings…") + 1
    );
    expect(names(trayMenu(base))).not.toContain("Set Up Permissions…");
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

describe("trayMenu on Windows", () => {
  const windows: TrayModel = { ...base, mac: false };

  it("names each item's keys as the shelf's own menu and shortcut sheet do", () => {
    expect(names(trayMenu(windows)).slice(0, 4)).toStrictEqual([
      "Show Inset Shelf (Ctrl+Alt+S)",
      "---",
      "Settings… (Ctrl+,)",
      "Keyboard Shortcuts (Ctrl+/)",
    ]);
  });

  // Windows draws an accelerator from the key's place on a US keyboard: Ctrl+§ for Ctrl+/ on a Swiss one.
  it("leaves Windows no accelerator to draw", () => {
    expect(
      trayMenu(windows).filter(
        (item) => item.kind === "item" && item.accelerator !== undefined
      )
    ).toStrictEqual([]);
  });

  it("names no keys when they weren't registered", () => {
    expect(
      names(trayMenu({ ...windows, shortcutsRegistered: false })).slice(0, 4)
    ).toStrictEqual([
      "Show Inset Shelf",
      "---",
      "Settings…",
      "Keyboard Shortcuts",
    ]);
  });
});

describe(trayTooltip, () => {
  it("names the app and its shortcut", () => {
    expect(trayTooltip(true)).toBe("Inset Shelf (⌃⌥S)");
  });
});

describe(iconClick, () => {
  const now = 100_000;

  it("shows a hidden shelf", () => {
    expect(
      iconClick({ focused: false, left: null, now, visible: false })
    ).toBe("show");
  });

  it("brings forward a shelf that is visible behind the window in front", () => {
    expect(
      iconClick({
        focused: false,
        left: { at: now - 60_000, toShell: false },
        now,
        visible: true,
      })
    ).toBe("focus");
    expect(iconClick({ focused: false, left: null, now, visible: true })).toBe(
      "focus"
    );
  });

  it("hides the shelf when it is in front", () => {
    expect(iconClick({ focused: true, left: null, now, visible: true })).toBe(
      "hide"
    );
  });

  // Windows hands the taskbar the focus as the icon is pressed, before the click arrives.
  it("hides the shelf that the click on the icon itself took the focus from", () => {
    expect(
      iconClick({
        focused: false,
        left: { at: now - 150, toShell: false },
        now,
        visible: true,
      })
    ).toBe("hide");
  });

  it("hides the shelf that lost the focus to the hidden icons' flyout on the way to the icon", () => {
    expect(
      iconClick({
        focused: false,
        left: { at: now - 2500, toShell: true },
        now,
        visible: true,
      })
    ).toBe("hide");
  });

  it("brings the shelf forward once another app has had the focus a while", () => {
    expect(
      iconClick({
        focused: false,
        left: { at: now - 2500, toShell: false },
        now,
        visible: true,
      })
    ).toBe("focus");
    expect(
      iconClick({
        focused: false,
        left: { at: now - 60_000, toShell: true },
        now,
        visible: true,
      })
    ).toBe("focus");
  });
});

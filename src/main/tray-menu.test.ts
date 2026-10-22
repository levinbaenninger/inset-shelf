import { describe, expect, it } from "vitest";

import { trayMenu, trayTooltip } from "./tray-menu";
import type { TrayModel } from "./tray-menu";

const base: TrayModel = {
  isMac: true,
  keys: "granted",
  selectionCapture: true,
  shelfVisible: false,
  shortcutsRegistered: true,
};

const labels = (model: TrayModel) =>
  trayMenu(model).map((item) =>
    item.kind === "separator" ? "---" : item.label
  );

describe(trayMenu, () => {
  it("offers the shelf, area capture, the double Shift hint and quit", () => {
    expect(labels(base)).toStrictEqual([
      "Show Shelf",
      "Capture Area or Pin",
      "---",
      "⇧ ⇧ saves selected text",
      "---",
      "Quit Inset Shelf",
    ]);
  });

  it("asks for the permission double Shift needs", () => {
    expect(trayMenu({ ...base, keys: "missing" })[3]).toMatchObject({
      action: "turnOnKeys",
      label: "Turn On Double Shift…",
    });
  });

  it("says what double Shift does where selection capture is off", () => {
    expect(
      labels({
        ...base,
        isMac: false,
        keys: "notNeeded",
        selectionCapture: false,
      })[3]
    ).toBe("Shift Shift shows the shelf");
  });

  it("shows accelerators only when they were registered", () => {
    expect(trayMenu(base)[0]).toMatchObject({ accelerator: "Control+Alt+S" });
    expect(
      trayMenu({ ...base, shortcutsRegistered: false })[0]
    ).not.toHaveProperty("accelerator", "Control+Alt+S");
  });
});

describe(trayTooltip, () => {
  it("names both shortcuts", () => {
    expect(trayTooltip(true)).toBe(
      "Inset Shelf: ⌃⌥S shows the shelf, ⌃⌥A captures an area"
    );
  });
});

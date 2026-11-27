import { rect } from "@shared/geometry";
import { describe, expect, it } from "vite-plus/test";

import { isTaskbarWindow } from "./taskbar-window";

const EXPLORER = String.raw`C:\Windows\explorer.exe`;

// A 1920x1080 display with its taskbar along the bottom, 48 high.
const displays = [
  {
    bounds: rect<"screen">(0, 0, 1920, 1080),
    workArea: rect<"screen">(0, 0, 1920, 1032),
  },
];

const window = (
  title: string,
  bounds: ReturnType<typeof rect<"screen">>,
  ownerPath = EXPLORER
) => ({ bounds, ownerPath, title });

describe(isTaskbarWindow, () => {
  it("counts the untitled taskbar", () => {
    expect(
      isTaskbarWindow(
        window("", rect<"screen">(0, 1032, 1920, 48)),
        displays
      )
    ).toBe(true);
  });

  it("counts the hidden icons' flyout, whatever language its title is in", () => {
    expect(
      isTaskbarWindow(
        window("Überlauffenster", rect<"screen">(1500, 880, 300, 140)),
        displays
      )
    ).toBe(true);
  });

  it("counts a flyout over a taskbar that hides itself", () => {
    expect(
      isTaskbarWindow(
        window("Notification Overflow", rect<"screen">(1500, 920, 300, 160)),
        [
          {
            bounds: rect<"screen">(0, 0, 1920, 1080),
            workArea: rect<"screen">(0, 0, 1920, 1080),
          },
        ]
      )
    ).toBe(true);
  });

  it("doesn't count a File Explorer folder window", () => {
    expect(
      isTaskbarWindow(
        window("Downloads", rect<"screen">(300, 200, 1100, 700)),
        displays
      )
    ).toBe(false);
  });

  it("doesn't count a maximized folder window, which ends at the taskbar", () => {
    expect(
      isTaskbarWindow(
        window("Downloads", rect<"screen">(-8, 0, 1936, 1040)),
        displays
      )
    ).toBe(false);
  });

  it("doesn't count a folder window snapped to a quarter of the screen", () => {
    expect(
      isTaskbarWindow(
        window("Downloads", rect<"screen">(960, 516, 960, 516)),
        displays
      )
    ).toBe(false);
  });

  it("doesn't count the desktop", () => {
    expect(
      isTaskbarWindow(
        window("Program Manager", rect<"screen">(0, 0, 1920, 1080)),
        displays
      )
    ).toBe(false);
  });

  it("doesn't count another app's window, even an untitled one", () => {
    expect(
      isTaskbarWindow(
        window("", rect<"screen">(0, 1032, 1920, 48), String.raw`C:\Apps\x.exe`),
        displays
      )
    ).toBe(false);
  });
});

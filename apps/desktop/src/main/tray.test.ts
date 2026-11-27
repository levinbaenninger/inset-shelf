import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createTray } from "./tray";

/** What the fake tray was asked to do, in order. */
const calls: string[] = [];
const listeners = new Map<string, () => void>();
const ignore = (): void => undefined;
const menuEvents = new Map<string, () => void>();

// Electron's native side doesn't load under Node. Only it is faked: a tray and a menu that note what they are asked to do.
// oxlint-disable-next-line anti-slop/no-module-mocking, vitest/prefer-import-in-mock -- createTray builds its own Tray and Menu, and the fake has only what it calls, not Electron's full types.
vi.mock("electron", () => ({
  Menu: {
    buildFromTemplate: (template: readonly { label?: string }[]) => ({
      on: (): void => undefined,
      once: (name: string, listener: () => void): void => {
        menuEvents.set(name, listener);
      },
      template,
    }),
  },
  Tray: class {
    readonly noted = calls;

    readonly heard = listeners;

    destroy(): void {
      this.noted.push("destroy");
    }

    on(name: string, listener: () => void): void {
      this.heard.set(name, listener);
    }

    popUpContextMenu(): void {
      this.noted.push("popUpContextMenu");
    }

    setContextMenu(): void {
      this.noted.push("setContextMenu");
    }

    setImage(): void {
      this.noted.push("setImage");
    }

    setToolTip(text: string): void {
      this.noted.push(`setToolTip ${JSON.stringify(text)}`);
    }
  },
  nativeImage: { createFromPath: () => ({}) },
  nativeTheme: { off: (): void => undefined, on: (): void => undefined },
}));

const windowsTray = () => {
  calls.length = 0;
  menuEvents.clear();
  createTray({
    click: ignore,
    iconPath: () => "tray.png",
    model: () => ({
      mac: false,
      setUpPermissions: false,
      shelfVisible: false,
      shortcutsRegistered: true,
      update: { kind: "idle" },
      version: "0.1.900",
    }),
    run: ignore,
  });
  calls.length = 0;
};

describe(createTray, () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");

  beforeEach(() => {
    Object.defineProperty(process, "platform", { value: "win32" });
  });

  afterEach(() => {
    if (platform !== undefined) {
      Object.defineProperty(process, "platform", platform);
    }
  });

  it("clears its tooltip when its menu shows, and restores it when the menu closes, so the tooltip can't cover the menu", () => {
    windowsTray();

    listeners.get("right-click")?.();

    // Electron doesn't pop the menu up when Windows denies it the foreground: no tooltip is lost before the menu shows.
    expect(calls).toStrictEqual(["popUpContextMenu"]);

    menuEvents.get("menu-will-show")?.();

    expect(calls.at(-1)).toBe('setToolTip ""');

    menuEvents.get("menu-will-close")?.();

    expect(calls.at(-1)).toBe('setToolTip "Inset Shelf (Ctrl+Alt+S)"');
  });

  it("keeps its tooltip when Windows refuses to show the menu", () => {
    windowsTray();

    listeners.get("right-click")?.();

    expect(calls).not.toContain('setToolTip ""');
  });
});

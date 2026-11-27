import { describe, expect, it, vi } from "vite-plus/test";

import { createTray } from "./tray";

/** What the fake tray was asked to do, in order. */
const calls: string[] = [];
const listeners = new Map<string, () => void>();
const ignore = (): void => undefined;
let closeMenu = ignore;

// Electron's native side doesn't load under Node. Only it is faked: a tray and a menu that note what they are asked to do.
// oxlint-disable-next-line anti-slop/no-module-mocking, vitest/prefer-import-in-mock -- createTray builds its own Tray and Menu, and the fake has only what it calls, not Electron's full types.
vi.mock("electron", () => ({
  Menu: {
    buildFromTemplate: (template: readonly { label?: string }[]) => ({
      on: (): void => undefined,
      once: (name: string, listener: () => void): void => {
        if (name === "menu-will-close") {
          closeMenu = listener;
        }
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

describe(createTray, () => {
  it.runIf(process.platform === "win32")(
    "clears its tooltip while its menu is open on Windows, so the tooltip can't cover the menu",
    () => {
      calls.length = 0;
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

      listeners.get("right-click")?.();

      expect(calls).toStrictEqual(['setToolTip ""', "popUpContextMenu"]);

      closeMenu();

      expect(calls.at(-1)).toBe('setToolTip "Inset Shelf (Ctrl+Alt+S)"');
    }
  );
});

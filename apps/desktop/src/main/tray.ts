import { Menu, nativeImage, nativeTheme, Tray } from "electron";
import type { MenuItemConstructorOptions } from "electron";

import { isWindows } from "./caption-buttons";
import { trayMenu, trayTooltip } from "./tray-menu";
import type { TrayAction, TrayItem, TrayModel } from "./tray-menu";

export interface TrayOptions {
  /** Read again when the system theme changes, so the icon can suit the taskbar. */
  readonly iconPath: () => string;
  readonly model: () => TrayModel;
  readonly run: (action: TrayAction) => void;
  /** Windows: a left click on the icon; the menu is on a right-click. */
  readonly click: () => void;
}

export interface ShelfTray {
  readonly refresh: () => void;
  readonly destroy: () => void;
}

const toMenuItem = (
  item: TrayItem,
  run: (action: TrayAction) => void
): MenuItemConstructorOptions => {
  if (item.kind === "separator") {
    return { type: "separator" };
  }

  if (item.kind === "label") {
    return { enabled: false, label: item.label };
  }

  // Windows shows About as a plain message box; Settings shows the same in the app's own look.
  if (item.kind === "role" && item.role === "about" && isWindows) {
    return {
      click: () => {
        run("openSettings");
      },
      label: "About Inset Shelf",
    };
  }

  if (item.kind === "role") {
    return { role: item.role };
  }

  return {
    accelerator: item.accelerator,
    click: () => {
      run(item.action);
    },
    label: item.label,
    registerAccelerator: false,
  };
};

export const createTray = (options: TrayOptions): ShelfTray => {
  const tray = new Tray(nativeImage.createFromPath(options.iconPath()));
  const windows = process.platform === "win32";
  const tooltip = trayTooltip(process.platform === "darwin");

  const updateIcon = (): void => {
    tray.setImage(nativeImage.createFromPath(options.iconPath()));
  };

  const buildMenu = (): Menu =>
    Menu.buildFromTemplate(
      trayMenu(options.model()).map((item) => toMenuItem(item, options.run))
    );

  // Windows pops the menu on a right-click, built then; elsewhere the menu is the icon's.
  const refresh = (): void => {
    if (!windows) {
      tray.setContextMenu(buildMenu());
    }
  };

  tray.setToolTip(tooltip);
  refresh();
  nativeTheme.on("updated", updateIcon);

  if (windows) {
    // A click on a notification-area icon opens its app; the menu is on a right-click.
    tray.on("click", () => {
      options.click();
    });

    // Windows shows the icon's tooltip again while the pointer rests on it, over the menu
    // that opened beside it ("About Inset Shelf" hidden): the menu opens without one. It is
    // cleared as the menu shows, since Electron pops nothing up, and closes nothing, when
    // Windows denies it the foreground.
    tray.on("right-click", () => {
      const menu = buildMenu();

      menu.once("menu-will-show", () => {
        tray.setToolTip("");
      });
      menu.once("menu-will-close", () => {
        tray.setToolTip(tooltip);
      });
      tray.popUpContextMenu(menu);
    });
  }

  return {
    destroy: () => {
      nativeTheme.off("updated", updateIcon);
      tray.destroy();
    },
    refresh,
  };
};

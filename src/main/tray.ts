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

  const updateIcon = (): void => {
    tray.setImage(nativeImage.createFromPath(options.iconPath()));
  };

  const refresh = (): void => {
    tray.setContextMenu(
      Menu.buildFromTemplate(
        trayMenu(options.model()).map((item) => toMenuItem(item, options.run))
      )
    );
  };

  tray.setToolTip(trayTooltip(process.platform === "darwin"));
  refresh();
  nativeTheme.on("updated", updateIcon);

  if (process.platform === "win32") {
    tray.on("click", () => {
      tray.popUpContextMenu();
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

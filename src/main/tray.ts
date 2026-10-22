import { Menu, nativeImage, Tray } from "electron";
import type { MenuItemConstructorOptions } from "electron";

import { trayMenu, trayTooltip } from "./tray-menu";
import type { TrayAction, TrayItem, TrayModel } from "./tray-menu";

export interface TrayOptions {
  readonly iconPath: string;
  readonly model: () => TrayModel;
  readonly run: (action: TrayAction) => void;
}

export interface ShelfTray {
  readonly refresh: () => void;
}

const toMenuItem = (
  item: TrayItem,
  run: (action: TrayAction) => void
): MenuItemConstructorOptions => {
  if (item.kind === "separator") {
    return { type: "separator" };
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
  const tray = new Tray(nativeImage.createFromPath(options.iconPath));

  const refresh = (): void => {
    tray.setContextMenu(
      Menu.buildFromTemplate(
        trayMenu(options.model()).map((item) => toMenuItem(item, options.run))
      )
    );
  };

  tray.setToolTip(trayTooltip(process.platform === "darwin"));
  refresh();

  if (process.platform === "win32") {
    tray.on("click", () => {
      tray.popUpContextMenu();
    });
  }

  return { refresh };
};

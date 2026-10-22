import { Menu, nativeImage, Tray } from "electron";
import type { MenuItemConstructorOptions } from "electron";

import { trayMenu, trayTooltip } from "./tray-menu";
import type { TrayAction, TrayModel } from "./tray-menu";

export interface TrayOptions {
  readonly iconPath: string;
  readonly model: () => TrayModel;
  readonly run: (action: TrayAction) => void;
}

export interface ShelfTray {
  readonly refresh: () => void;
}

export const createTray = (options: TrayOptions): ShelfTray => {
  const tray = new Tray(nativeImage.createFromPath(options.iconPath));

  const refresh = (): void => {
    const template = trayMenu(options.model()).map(
      (item): MenuItemConstructorOptions => {
        if (item.kind === "separator") {
          return { type: "separator" };
        }

        const { action } = item;

        return {
          accelerator: item.accelerator,
          click:
            action === null
              ? undefined
              : () => {
                  options.run(action);
                },
          enabled: item.enabled,
          label: item.label,
          registerAccelerator: false,
        };
      }
    );

    tray.setContextMenu(Menu.buildFromTemplate(template));
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

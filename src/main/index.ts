import { randomUUID } from "node:crypto";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import {
  overlayContract,
  shelfContract,
  toastContract,
} from "@shared/contracts";
import type {
  ActionResult,
  OverlayCommit,
  Permission,
  ShelfCommand,
} from "@shared/contracts";
import {
  areaToImage,
  defaultCrop,
  pinInCrop,
  rect,
  screenToImage,
  size,
} from "@shared/geometry";
import type { Rect } from "@shared/geometry";
import { insetUrl } from "@shared/inset-url";
import { ItemIdSchema, SectionIdSchema } from "@shared/shelf";
import type { ImageItem, ItemId } from "@shared/shelf";
import { AREA_ACCELERATOR, TOGGLE_ACCELERATOR } from "@shared/shortcut";
import {
  app,
  clipboard,
  ClipboardItem,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  systemPreferences,
} from "electron";
import type { MenuItemConstructorOptions } from "electron";

import { appMenuTemplate, HELP_URL } from "./app-menu";
import { captureDisplay, sampleAnchor } from "./capture";
import type { Anchor, CapturedFrame, CaptureProblem } from "./capture";
import { e2eLog } from "./e2e-log";
import { exportFileName } from "./export-name";
import { createDragStaging, exportImage } from "./exports";
import { frontWindowBounds } from "./front-window";
import { serveContract } from "./ipc-kit";
import { createKeyMonitor } from "./key-monitor";
import { createOverlayWindow } from "./overlay-window";
import { handleInsetProtocol, registerInsetScheme } from "./protocol";
import { captureSelection } from "./selection";
import { createShelfController } from "./shelf-controller";
import { itemMenu, sectionMenu } from "./shelf-menus";
import type { MenuChoice, MenuEntry } from "./shelf-menus";
import { failNextWrite, nodeStoreFs, openShelfStore } from "./shelf-store";
import { createShelfWindow } from "./shelf-window";
import { createToastWindow } from "./toast-window";
import { createTray } from "./tray";
import type { ShelfTray } from "./tray";
import type { TrayAction } from "./tray-menu";
import {
  appOrigin,
  pageUrl,
  preloadPath,
  rendererRoot,
  secureSession,
} from "./window-security";

const PRODUCT_NAME = "Inset Shelf";
const APP_ID = "ch.inset.prototype.shelf";

/** Fixed constants: never built from renderer input. */
const MAC_ACCESSIBILITY_SETTINGS =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";

/** Lets the compositor drop hidden Inset windows before the screen is captured; not measured. */
const HIDE_SETTLE_MS = 150;
const KEYS_POLL_MS = 3000;
const FRAME_JPEG_QUALITY = 90;
const TOAST_EXCERPT = 80;

const isMac = process.platform === "darwin";

const delay = async (ms: number): Promise<void> => {
  await sleep(ms);
};

/** Double Shift needs Accessibility on macOS only. */
const keyPermission = (running: boolean, trusted: boolean): Permission => {
  if (!isMac) {
    return "notNeeded";
  }

  return running && trusted ? "granted" : "missing";
};

const logRejected = (channel: string, reason: string): void => {
  console.warn(`Rejected IPC on ${channel}: ${reason}`);
};

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : "Unknown error";

const trayIconPath = (): string => {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, "resources")
    : path.join(app.getAppPath(), "resources");

  return path.join(base, isMac ? "trayTemplate.png" : "tray.png");
};

const problemText = (problem: CaptureProblem): string => {
  if (problem.kind === "screenPermission") {
    return problem.status === "granted-but-empty"
      ? "The screen image came back empty. In System Settings › Privacy & Security › Screen & System Audio Recording, turn Inset Shelf off and on again."
      : "Inset Shelf needs Screen & System Audio Recording access to capture an area. Turn it on in System Settings › Privacy & Security, then quit and reopen Inset Shelf.";
  }

  return problem.kind === "displayNotMatched"
    ? "Couldn't tell which screen is under the pointer. Try again."
    : `The screen couldn't be captured: ${problem.message}`;
};

const excerpt = (text: string): string => {
  const line = text.replaceAll(/\s+/gu, " ").trim();

  return line.length > TOAST_EXCERPT
    ? `${line.slice(0, TOAST_EXCERPT - 1)}…`
    : line;
};

/** What one clipboard item holds, format by format. */
type ClipboardData = ConstructorParameters<typeof ClipboardItem>[0];

type ClipboardSnapshot = readonly ClipboardData[];

const snapshotClipboard = async (): Promise<ClipboardSnapshot> => {
  const items = await clipboard.read();

  return await Promise.all(
    items.map(async (item) =>
      Object.fromEntries(
        await Promise.all(
          item.types.map(
            async (type) => [type, await item.getType(type)] as const
          )
        )
      )
    )
  );
};

const restoreClipboard = async (saved: ClipboardSnapshot): Promise<void> => {
  if (saved.length === 0) {
    clipboard.clear();

    return;
  }

  await clipboard.write(saved.map((data) => new ClipboardItem(data)));
};

const start = async (): Promise<void> => {
  await app.whenReady();

  app.setAboutPanelOptions({
    applicationName: PRODUCT_NAME,
    applicationVersion: app.getVersion(),
    credits: "A prototype for the Inset capture experiments.",
  });
  secureSession();

  const dataDir = app.getPath("userData");

  const store = await openShelfStore(dataDir, {
    fs:
      process.env.INSET_FAIL_NEXT_WRITE === "1"
        ? failNextWrite(nodeStoreFs)
        : nodeStoreFs,
    newSectionId: () => SectionIdSchema.parse(randomUUID()),
    now: () => new Date(),
  });

  const selectionCapture = isMac;

  const trusted = (): boolean =>
    !isMac || systemPreferences.isTrustedAccessibilityClient(false);

  const controller = createShelfController({
    deleteAttachment: store.deleteAttachment,
    env: {
      newItemId: () => ItemIdSchema.parse(randomUUID()),
      newSectionId: () => SectionIdSchema.parse(randomUUID()),
      now: () => new Date(),
    },
    initial: store.initial,
    save: store.save,
    setTimer: (run, ms) => {
      const timer = setTimeout(run, ms);

      return () => {
        clearTimeout(timer);
      };
    },
    status: {
      keys: keyPermission(true, trusted()),
      problem: store.recovered,
      saveError: null,
      selectionCapture,
    },
  });

  const staging = createDragStaging(app.getPath("temp"));

  staging.clear();

  let overlayOpen = false;
  let tray: ShelfTray | null = null;

  const refreshTray = (): void => {
    tray?.refresh();
  };

  const shelf = createShelfWindow({
    otherWindowVisible: () => overlayOpen,
    preload: preloadPath("shelf"),
    url: pageUrl("shelf"),
  });

  /** Docks to the window in front, read before the shelf takes any focus. */
  const showShelf = async (): Promise<void> => {
    shelf.show(await frontWindowBounds());
  };

  const toggleShelf = async (): Promise<void> => {
    if (shelf.isFocused()) {
      shelf.hide();
    } else {
      await showShelf();
    }
  };

  const overlay = createOverlayWindow({
    preload: preloadPath("overlay"),
    url: pageUrl("overlay"),
  });

  const toast = createToastWindow({
    preload: preloadPath("toast"),
    url: pageUrl("toast"),
  });

  // The frozen frame behind the overlay, kept only while the overlay is open.
  let frame: {
    readonly token: string;
    readonly anchor: Anchor;
    readonly captured: CapturedFrame;
    jpeg: Uint8Array | null;
  } | null = null;

  let shelfWasVisible = false;

  handleInsetProtocol({
    attachmentFile: store.attachmentPath,
    frame: (token) => {
      if (frame === null || frame.token !== token) {
        return null;
      }

      frame.jpeg ??= frame.captured.image.toJPEG(FRAME_JPEG_QUALITY);

      return frame.jpeg;
    },
    rendererRoot: rendererRoot(),
  });

  const showItem = (id: ItemId): void => {
    controller.focus(id);
    void showShelf();
  };

  const closeOverlay = (): void => {
    overlayOpen = false;
    frame = null;
    overlay.hide();
    e2eLog("overlayClosed");
  };

  const cancelArea = (): void => {
    if (!overlayOpen) {
      return;
    }

    closeOverlay();

    if (shelfWasVisible) {
      void showShelf();
    }
  };

  const captureArea = async (): Promise<void> => {
    if (overlayOpen) {
      return;
    }

    const anchor = sampleAnchor();

    overlayOpen = true;
    shelfWasVisible = shelf.isVisible();
    shelf.hide();
    toast.hide();
    await delay(HIDE_SETTLE_MS);

    const result = await captureDisplay(anchor.display);

    if (!result.ok) {
      overlayOpen = false;
      controller.setStatus({ problem: problemText(result.problem) });
      void showShelf();

      return;
    }

    controller.setStatus({ problem: null });
    frame = {
      anchor,
      captured: result.frame,
      jpeg: null,
      token: randomUUID().replaceAll("-", ""),
    };
    overlay.show(anchor.display, {
      display: {
        height: anchor.display.bounds.height,
        width: anchor.display.bounds.width,
      },
      frameUrl: insetUrl.frame(frame.token),
    });
    e2eLog("overlayShown", { bounds: anchor.display.bounds });
  };

  const commitArea = async (commit: OverlayCommit): Promise<void> => {
    const current = frame;

    if (current === null) {
      return;
    }

    closeOverlay();

    const { anchor, captured } = current;

    const displaySize = size<"screen">(
      anchor.display.bounds.width,
      anchor.display.bounds.height
    );

    let crop: Rect<"image">;
    let pin: ImageItem["pin"] = null;

    if (commit.kind === "area") {
      crop = areaToImage(
        rect(
          commit.area.x,
          commit.area.y,
          commit.area.width,
          commit.area.height
        ),
        displaySize,
        captured.size
      );
    } else {
      const point = screenToImage(
        {
          x: anchor.display.bounds.x + commit.point.x,
          y: anchor.display.bounds.y + commit.point.y,
        },
        anchor.display.bounds,
        captured.size
      );

      crop = defaultCrop(point, captured.size, captured.ppd);
      pin = pinInCrop(point, crop);
    }

    try {
      const png = captured.image.crop(crop).toPNG();
      const file = await store.writeAttachment(png);

      const id = controller.apply({
        image: {
          file,
          heightPx: crop.height,
          pixelsPerDip: captured.ppd,
          widthPx: crop.width,
        },
        pin,
        source: anchor.display.label,
        type: "addImage",
        via: commit.kind,
      });

      if (id !== null) {
        e2eLog("itemAdded", { itemId: id, kind: "image", via: commit.kind });
        showItem(id);
      }
    } catch (error) {
      controller.setStatus({
        problem: `The area couldn't be saved: ${errorMessage(error)}`,
      });
      void showShelf();
    }
  };

  const keyMonitor = createKeyMonitor();

  let capturingSelection = false;

  const onDoubleTap = async (): Promise<void> => {
    e2eLog("doubleTap");

    if (overlayOpen || capturingSelection) {
      return;
    }

    // Inside the shelf, double Shift only hides it: copying would capture Inset's own text.
    if (!selectionCapture || shelf.isFocused()) {
      void toggleShelf();

      return;
    }

    capturingSelection = true;

    try {
      const result = await captureSelection({
        clear: () => {
          clipboard.clear();
        },
        copy: keyMonitor.copy,
        readText: async () => await clipboard.readText(),
        restore: restoreClipboard,
        snapshot: snapshotClipboard,
        wait: delay,
      });

      e2eLog("selection", {
        restored: result.restored,
        text: result.kind === "text" ? result.text : "",
      });

      if (result.kind === "none") {
        void toggleShelf();

        return;
      }

      const id = controller.apply({
        text: result.text,
        type: "addText",
        via: "selection",
      });

      if (id === null) {
        return;
      }

      e2eLog("itemAdded", { itemId: id, kind: "text", via: "selection" });

      if (shelf.isVisible()) {
        controller.focus(id);
      } else {
        const section = controller
          .view()
          .doc.sections.find(
            (candidate) =>
              candidate.id === controller.view().doc.activeSectionId
          );

        toast.show(
          `Saved to ${section?.name ?? "the shelf"}`,
          excerpt(result.text)
        );
      }

      if (!result.restored) {
        controller.setStatus({
          problem:
            "The clipboard could not be put back after copying your selection.",
        });
      }
    } finally {
      capturingSelection = false;
    }
  };

  keyMonitor.onDoubleTap(() => {
    void onDoubleTap();
  });

  const startKeys = (): boolean => {
    if (!trusted()) {
      return false;
    }

    const started = keyMonitor.start();

    controller.setStatus({ keys: keyPermission(started, true) });

    if (started) {
      e2eLog("keysReady");
    }

    return started;
  };

  if (!startKeys()) {
    const poll = setInterval(() => {
      if (startKeys()) {
        clearInterval(poll);
      }
    }, KEYS_POLL_MS);
  }

  const openKeySettings = (): void => {
    if (isMac) {
      systemPreferences.isTrustedAccessibilityClient(true);
      void shell.openExternal(MAC_ACCESSIBILITY_SETTINGS);
    }
  };

  const copyItem = async (id: ItemId): Promise<ActionResult> => {
    const item = controller.item(id);

    if (item === undefined) {
      return { message: "This item no longer exists.", ok: false };
    }

    try {
      if (item.kind === "text") {
        await clipboard.writeText(item.text);
      } else {
        const file = store.attachmentPath(item.image.file);
        const exported = file === null ? null : exportImage(item, file);

        if (exported === null) {
          return { message: "The image can't be read.", ok: false };
        }

        // The note travels as text next to the image, so a chat box can take both.
        const data: ClipboardData = {
          "image/png": new Blob([exported.png], { type: "image/png" }),
        };

        if (item.note.trim() !== "") {
          data["text/plain"] = new Blob([item.note], { type: "text/plain" });
        }

        await clipboard.write([new ClipboardItem(data)]);
      }

      e2eLog("copied", { itemId: id, kind: item.kind });

      return { ok: true };
    } catch (error) {
      return { message: `Couldn't copy: ${errorMessage(error)}`, ok: false };
    }
  };

  // Set once the shelf's IPC server exists; menus built before then only reach it later.
  let sendCommand: ((command: ShelfCommand) => void) | null = null;

  const runChoice = (choice: MenuChoice): void => {
    switch (choice.kind) {
      case "selectSection": {
        controller.apply({ id: choice.id, type: "selectSection" });
        break;
      }

      case "clearDone": {
        controller.apply({ type: "clearDone" });
        break;
      }

      case "toggleDone": {
        controller.apply({ id: choice.id, type: "toggleDone" });
        break;
      }

      case "copy": {
        void copyItem(choice.id);
        break;
      }

      case "moveTo": {
        controller.apply({
          id: choice.id,
          sectionId: choice.sectionId,
          type: "moveItem",
        });
        break;
      }

      case "edit":
      case "remove":
      case "newSection": {
        // Editing, deleting with undo and starting a section live in the shelf window.
        sendCommand?.(choice);
        break;
      }

      default: {
        break;
      }
    }
  };

  const menuItem = (entry: MenuEntry): MenuItemConstructorOptions => {
    if (entry.kind === "separator") {
      return { type: "separator" };
    }

    if (entry.kind === "submenu") {
      return { label: entry.label, submenu: entry.entries.map(menuItem) };
    }

    return {
      accelerator: entry.accelerator,
      checked: entry.checked,
      click: () => {
        runChoice(entry.choice);
      },
      enabled: entry.enabled,
      label: entry.label,
      registerAccelerator: false,
      type: entry.checked === undefined ? "normal" : "checkbox",
    };
  };

  const nativeMenu = (entries: readonly MenuEntry[]): Menu =>
    Menu.buildFromTemplate(entries.map(menuItem));

  const shelfServer = serveContract(
    shelfContract,
    {
      apply: (op) => {
        controller.apply(op);

        if (op.type === "remove") {
          staging.clear(op.id);
        }
      },
      captureArea: () => {
        void captureArea();
      },
      copy: copyItem,
      dismissProblem: () => {
        controller.setStatus({ problem: null });
      },
      getView: () => controller.view(),
      hide: () => {
        shelf.hide();
      },
      nativeEdit: (action) => {
        if (action === "copy") {
          shelf.webContents.copy();
        } else {
          shelf.webContents.undo();
        }
      },
      openKeySettings,
      showAddMenu: ({ x, y }) => {
        shelf.popup(
          Menu.buildFromTemplate([
            {
              accelerator: AREA_ACCELERATOR,
              click: () => {
                void captureArea();
              },
              label: "Capture Area",
              registerAccelerator: false,
            },
          ]),
          x,
          y
        );
      },
      showItemMenu: ({ id, x, y }) => {
        const item = controller.item(id);

        if (item !== undefined) {
          shelf.popup(nativeMenu(itemMenu(item, controller.view().doc)), x, y);
        }
      },
      showSectionMenu: ({ x, y }) => {
        shelf.popup(nativeMenu(sectionMenu(controller.view().doc)), x, y);
      },
      pasteImage: async (bytes) => {
        const image = nativeImage.createFromBuffer(Buffer.from(bytes));

        if (image.isEmpty()) {
          return {
            message: "The pasted data is not an image Inset can read.",
            ok: false,
          };
        }

        const { height, width } = image.getSize();
        const file = await store.writeAttachment(image.toPNG());

        const id = controller.apply({
          image: { file, heightPx: height, pixelsPerDip: 1, widthPx: width },
          pin: null,
          source: null,
          type: "addImage",
          via: "paste",
        });

        if (id !== null) {
          e2eLog("itemAdded", { itemId: id, kind: "image", via: "paste" });
          controller.focus(id);
        }

        return { ok: true };
      },
      startDrag: (id) => {
        const item = controller.item(id);

        const file =
          item?.kind === "image" ? store.attachmentPath(item.image.file) : null;

        const exported =
          item?.kind === "image" && file !== null
            ? exportImage(item, file)
            : null;

        if (item?.kind !== "image" || exported === null) {
          return;
        }

        shelf.webContents.startDrag({
          file: staging.write(id, exportFileName(item.note), exported.png),
          icon: exported.image.resize({ width: 128 }),
        });
      },
    },
    {
      appOrigin: appOrigin(),
      ipc: ipcMain,
      onRejected: logRejected,
      target: () => shelf.webContents,
    }
  );

  const overlayServer = serveContract(
    overlayContract,
    {
      cancel: cancelArea,
      commit: (commit) => {
        void commitArea(commit);
      },
      getView: () => overlay.view(),
    },
    {
      appOrigin: appOrigin(),
      ipc: ipcMain,
      onRejected: logRejected,
      target: () => overlay.webContents,
    }
  );

  const toastServer = serveContract(
    toastContract,
    { getView: () => toast.view() },
    {
      appOrigin: appOrigin(),
      ipc: ipcMain,
      onRejected: logRejected,
      target: () => toast.webContents,
    }
  );

  sendCommand = (command) => {
    shelfServer.emit("command", command);
  };

  let floatOnTop = true;

  /** Sends a menu choice to the shelf, showing it first, since it acts on the shelf's own state. */
  const commandShelf = async (command: ShelfCommand): Promise<void> => {
    if (!shelf.isFocused()) {
      await showShelf();
    }

    sendCommand(command);
  };

  const refreshAppMenu = (): void => {
    if (!isMac) {
      return;
    }

    const { doc, status } = controller.view();

    Menu.setApplicationMenu(
      Menu.buildFromTemplate(
        appMenuTemplate(
          { doc, floatOnTop, keys: status.keys },
          {
            captureArea: () => {
              void captureArea();
            },
            clearDone: () => {
              controller.apply({ type: "clearDone" });
            },
            closeShelf: shelf.hide,
            copy: () => {
              sendCommand?.({ kind: "copy" });
            },
            find: () => {
              void commandShelf({ kind: "find" });
            },
            newNote: () => {
              void commandShelf({ kind: "newNote" });
            },
            newSection: () => {
              void commandShelf({ kind: "newSection" });
            },
            openHelp: () => {
              void shell.openExternal(HELP_URL);
            },
            selectSection: (id) => {
              controller.apply({ id, type: "selectSection" });
            },
            setFloatOnTop: (on) => {
              floatOnTop = on;
              shelf.setFloatOnTop(on);
              refreshAppMenu();
            },
            turnOnKeys: openKeySettings,
            undo: () => {
              sendCommand?.({ kind: "undo" });
            },
          }
        )
      )
    );
  };

  refreshAppMenu();
  controller.subscribe(() => {
    shelfServer.emit("view", controller.view());
    refreshTray();
    refreshAppMenu();
  });
  // A click on the Dock icon brings the shelf back.
  app.on("activate", () => {
    if (!shelf.isVisible() && !overlayOpen) {
      void showShelf();
    }
  });
  overlay.onView((view) => {
    overlayServer.emit("view", view);
  });
  overlay.onBlur(cancelArea);
  toast.onView((view) => {
    toastServer.emit("view", view);
  });
  shelf.onShown((bounds) => {
    toast.hide();
    e2eLog("shelfShown", { bounds });
    refreshTray();
  });
  shelf.onHidden(() => {
    e2eLog("shelfHidden");
    refreshTray();
  });

  await Promise.all([shelf.load(), overlay.load(), toast.load()]);

  const shortcutsRegistered =
    globalShortcut.register(TOGGLE_ACCELERATOR, () => {
      void toggleShelf();
    }) &&
    globalShortcut.register(AREA_ACCELERATOR, () => {
      void captureArea();
    });

  const run = (action: TrayAction): void => {
    if (action === "toggleShelf") {
      void toggleShelf();
    } else if (action === "captureArea") {
      void captureArea();
    } else {
      openKeySettings();
    }
  };

  tray = createTray({
    iconPath: trayIconPath(),
    model: () => ({
      keys: controller.view().status.keys,
      shelfVisible: shelf.isVisible(),
      shortcutsRegistered,
    }),
    run,
  });

  let quitting = false;

  /**
   * Writes a pending note, then exits. A second app.quit() after a held-back
   * quit closes the windows but does not end the app on macOS when the quit
   * came from the Quit menu item, so the app exits itself.
   */
  const finishQuit = async (): Promise<void> => {
    try {
      await controller.flush();
    } finally {
      globalShortcut.unregisterAll();
      app.exit(0);
    }
  };

  app.on("before-quit", (event) => {
    event.preventDefault();

    if (quitting) {
      return;
    }

    quitting = true;
    keyMonitor.stop();
    staging.clear();
    void finishQuit();
  });

  e2eLog("launch");
  // Like any app's window, the shelf opens when the app starts.
  await showShelf();
};

const startOrExit = async (): Promise<void> => {
  try {
    await start();
  } catch (error) {
    dialog.showErrorBox(
      `${PRODUCT_NAME} couldn't start`,
      `${errorMessage(error)}\n\nOpen ${PRODUCT_NAME} again.`
    );
    app.exit(1);
  }
};

// The instance lock is keyed by userData, so the path must be final before it is taken.
app.setPath(
  "userData",
  process.env.INSET_USER_DATA_DIR ??
    path.join(app.getPath("appData"), PRODUCT_NAME)
);

if (app.requestSingleInstanceLock()) {
  if (process.platform === "win32") {
    app.setAppUserModelId(APP_ID);
  }

  registerInsetScheme();
  app.on("window-all-closed", () => {
    // A tray utility keeps running without windows.
  });
  void startOrExit();
} else {
  app.exit(0);
}

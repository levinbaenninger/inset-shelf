import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
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
import { z } from "zod";

import { captureDisplay, sampleAnchor } from "./capture";
import type { Anchor, CapturedFrame, CaptureProblem } from "./capture";
import { e2eLog } from "./e2e-log";
import { exportFileName } from "./export-name";
import { createDragStaging, exportImage } from "./exports";
import { serveContract } from "./ipc-kit";
import { createKeyMonitor } from "./key-monitor";
import { createOverlayWindow } from "./overlay-window";
import { handleInsetProtocol, registerInsetScheme } from "./protocol";
import { captureSelection } from "./selection";
import { createShelfController } from "./shelf-controller";
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

const BoundsSchema = z.object({
  height: z.number().int().min(1).max(100_000),
  width: z.number().int().min(1).max(100_000),
  x: z.number().int().min(-100_000).max(100_000),
  y: z.number().int().min(-100_000).max(100_000),
});

/** The shelf's last place, kept across launches; a missing or broken file just means the default place. */
const windowState = (file: string) => ({
  read: (): Rect<"screen"> | null => {
    try {
      const parsed = BoundsSchema.safeParse(
        JSON.parse(readFileSync(file, "utf-8"))
      );

      return parsed.success
        ? rect(
            parsed.data.x,
            parsed.data.y,
            parsed.data.width,
            parsed.data.height
          )
        : null;
    } catch {
      return null;
    }
  },
  write: (bounds: Rect<"screen">): void => {
    try {
      writeFileSync(file, JSON.stringify(bounds));
    } catch {
      // The place is a convenience; losing it is harmless.
    }
  },
});

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

  if (isMac) {
    app.dock?.hide();
  }

  // macOS routes Cmd+C/V/X/Z/A through the application menu; Windows needs none.
  Menu.setApplicationMenu(
    isMac
      ? Menu.buildFromTemplate([
          { role: "appMenu" },
          { role: "editMenu" },
          { role: "windowMenu" },
        ])
      : null
  );
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

  const windowFile = windowState(path.join(dataDir, "window.json"));
  let overlayOpen = false;
  let tray: ShelfTray | null = null;

  const refreshTray = (): void => {
    tray?.refresh();
  };

  const shelf = createShelfWindow({
    otherWindowVisible: () => overlayOpen,
    preload: preloadPath("shelf"),
    remember: windowFile.write,
    remembered: windowFile.read(),
    url: pageUrl("shelf"),
  });

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
    shelf.show();
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
      shelf.show();
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
      shelf.show();

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
      shelf.show();
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
      shelf.toggle();

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
        shelf.toggle();

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
      openKeySettings,
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

  controller.subscribe(() => {
    shelfServer.emit("view", controller.view());
    refreshTray();
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
      shelf.toggle();
    }) &&
    globalShortcut.register(AREA_ACCELERATOR, () => {
      void captureArea();
    });

  const run = (action: TrayAction): void => {
    if (action === "toggleShelf") {
      shelf.toggle();
    } else if (action === "captureArea") {
      void captureArea();
    } else if (action === "turnOnKeys") {
      openKeySettings();
    } else {
      app.quit();
    }
  };

  tray = createTray({
    iconPath: trayIconPath(),
    model: () => ({
      isMac,
      keys: controller.view().status.keys,
      selectionCapture,
      shelfVisible: shelf.isVisible(),
      shortcutsRegistered,
    }),
    run,
  });

  let quitting = false;

  // Writes a pending note before the windows may close.
  const finishQuit = async (): Promise<void> => {
    try {
      await controller.flush();
    } finally {
      shelf.allowClose();
      overlay.allowClose();
      toast.allowClose();
      app.quit();
    }
  };

  app.on("before-quit", (event) => {
    if (quitting) {
      return;
    }

    event.preventDefault();
    quitting = true;
    keyMonitor.stop();
    staging.clear();
    void finishQuit();
  });
  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
  });

  e2eLog("launch");
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

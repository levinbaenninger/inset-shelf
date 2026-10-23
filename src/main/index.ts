import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

import {
  drawingContract,
  overlayContract,
  settingsContract,
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
import type { IconPlace, SettingsView } from "@shared/settings";
import {
  ItemIdSchema,
  SectionIdSchema,
  itemsAsList,
  itemTextWithLink,
} from "@shared/shelf";
import type { ImageItem, ItemContext, ItemId, MainOp } from "@shared/shelf";
import { AREA_ACCELERATOR, TOGGLE_ACCELERATOR } from "@shared/shortcut";
import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  shell,
  systemPreferences,
} from "electron";
import type { NativeImage } from "electron";

import { ADDED_FILE_MAX_BYTES, classifyAddedFile } from "./added-file";
import { appMenuTemplate, HELP_URL } from "./app-menu";
import { captureDisplay, sampleAnchor } from "./capture";
import type { Anchor, CapturedFrame, CaptureProblem } from "./capture";
import { createDrawingWindow } from "./drawing-window";
import { e2eLog } from "./e2e-log";
import { exportFileName } from "./export-name";
import { createDragStaging, exportImage } from "./exports";
import { frontWindow } from "./front-window";
import { serveContract } from "./ipc-kit";
import { createKeyMonitor } from "./key-monitor";
import { createOverlayWindow } from "./overlay-window";
import { handleInsetProtocol, registerInsetScheme } from "./protocol";
import { captureSelection } from "./selection";
import { openSettingsStore } from "./settings-store";
import { createSettingsWindow } from "./settings-window";
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

/** The macOS pasteboard type for a file, which Electron reaches through its raw formats. */
const MAC_FILE_URL =
  'electron application/osclipboard;format="public.file-url"';

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

  if (isMac) {
    return path.join(base, "trayTemplate.png");
  }

  return path.join(
    base,
    nativeTheme.shouldUseDarkColorsForSystemIntegratedUI
      ? "tray-on-dark.png"
      : "tray.png"
  );
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

  const settings = await openSettingsStore(dataDir, nodeStoreFs);

  // Not on Linux, where the synthetic copy has never been tried.
  const selectionCapture = isMac || process.platform === "win32";

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

  // The window the shelf last docked to, kept for when Inset itself is in front.
  let lastTarget: Rect<"screen"> | null = null;

  /**
   * Docks to the window in front, read before the shelf takes any focus.
   * After a capture or a drawing, Inset's own window is in front: the shelf
   * goes back beside the window it was docked to.
   */
  const showShelf = async (): Promise<void> => {
    const front = await frontWindow();

    if (front.bounds !== null) {
      lastTarget = front.bounds;
    }

    shelf.show(front.own ? lastTarget : front.bounds);
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

  /** A window closing over the open shelf gives it the keyboard back. */
  const focusShelf = (): boolean => {
    if (!shelf.isVisible()) {
      return false;
    }

    shelf.focus();

    return true;
  };

  const drawing = createDrawingWindow({
    handOff: focusShelf,
    preload: preloadPath("drawing"),
    url: pageUrl("drawing"),
  });

  const toast = createToastWindow({
    preload: preloadPath("toast"),
    url: pageUrl("toast"),
  });

  const settingsWindow = createSettingsWindow({
    handOff: focusShelf,
    preload: preloadPath("settings"),
    url: pageUrl("settings"),
  });

  // The frozen frame behind the overlay, kept only while the overlay is open.
  let frame: {
    readonly token: string;
    readonly anchor: Anchor;
    readonly captured: CapturedFrame;
    readonly context: ItemContext | null;
    jpeg: Uint8Array | null;
  } | null = null;

  let shelfWasVisible = false;

  handleInsetProtocol({
    // Only images are shown in the shelf; other attached files are never served to a page.
    attachmentFile: (file) =>
      file.endsWith(".png") ? store.attachmentPath(file) : null,
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
    // Read before Inset hides or shows anything, while the user's app is still in front.
    const front = frontWindow();

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

    const sampled = await front;

    if (sampled.bounds !== null) {
      lastTarget = sampled.bounds;
    }

    frame = {
      anchor,
      captured: result.frame,
      context: sampled.context,
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

    const { anchor, captured, context } = current;

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
        context,
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
      // Sampled alongside the copy, while the app with the selection is in front.
      const front = frontWindow();

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

      const { context } = await front;

      const id = controller.apply({
        context,
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

  /** Reads one added file into an operation, or says why it can't be added. */
  const prepareFile = async (
    filePath: string
  ): Promise<MainOp | { readonly problem: string }> => {
    const added = classifyAddedFile(filePath);

    try {
      const info = await stat(filePath);

      if (!info.isFile()) {
        return { problem: `${added.name} is a folder, not a file.` };
      }

      if (info.size > ADDED_FILE_MAX_BYTES) {
        return { problem: `${added.name} is larger than 200 MB.` };
      }

      const image =
        added.kind === "image" ? nativeImage.createFromPath(filePath) : null;

      if (image !== null && !image.isEmpty()) {
        const { height, width } = image.getSize();

        return {
          context: null,
          image: {
            file: await store.writeAttachment(image.toPNG()),
            heightPx: height,
            pixelsPerDip: 1,
            widthPx: width,
          },
          pin: null,
          source: null,
          type: "addImage",
          via: "paste",
        };
      }

      return {
        context: null,
        file: {
          bytes: info.size,
          name: added.name,
          stored: await store.copyAttachment(filePath, added.extension),
        },
        type: "addFile",
      };
    } catch {
      return { problem: `${added.name} couldn't be read.` };
    }
  };

  /** Adds files in the order given; the last one added is shown. */
  const addFiles = async (paths: readonly string[]): Promise<ActionResult> => {
    // A file dragged out of the shelf and dropped back in is already there.
    const outside = paths.filter((filePath) => !staging.contains(filePath));
    const prepared = await Promise.all(outside.map(prepareFile));
    let lastId: ItemId | null = null;

    for (const op of prepared) {
      if (!("problem" in op)) {
        lastId = controller.apply(op) ?? lastId;
      }
    }

    if (lastId !== null) {
      e2eLog("itemAdded", { itemId: lastId, kind: "file", via: "added" });
      controller.focus(lastId);
    }

    const problems = prepared.flatMap((op) =>
      "problem" in op ? [op.problem] : []
    );

    return problems.length === 0
      ? { ok: true }
      : { message: problems.join(" "), ok: false };
  };

  /** Drags an image (with its pin drawn in) or a file out of the shelf as a named file. */
  const dragOut = async (id: ItemId): Promise<void> => {
    const item = controller.item(id);

    if (item?.kind === "file") {
      const stored = store.attachmentPath(item.file.stored);

      if (stored !== null) {
        const file = staging.copy(id, item.file.name, stored);

        shelf.webContents.startDrag({
          file,
          icon: await app.getFileIcon(file, { size: "normal" }),
        });
      }

      return;
    }

    const file =
      item?.kind === "image" ? store.attachmentPath(item.image.file) : null;

    const exported =
      item?.kind === "image" && file !== null ? exportImage(item, file) : null;

    if (item?.kind === "image" && exported !== null) {
      shelf.webContents.startDrag({
        file: staging.write(id, exportFileName(item.note), exported.png),
        icon: exported.image.resize({ width: 128 }),
      });
    }
  };

  const pickFiles = async (): Promise<void> => {
    const picked = await dialog.showOpenDialog(shelf.dialogParent, {
      properties: ["openFile", "multiSelections"],
      title: "Attach Files",
    });

    if (!picked.canceled && picked.filePaths.length > 0) {
      const result = await addFiles(picked.filePaths);

      if (!result.ok) {
        controller.setStatus({ problem: result.message });
      }
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
      } else if (item.kind === "file") {
        const stored = store.attachmentPath(item.file.stored);

        if (stored === null) {
          return { message: "The file can't be read.", ok: false };
        }

        // A named copy goes on the clipboard as a file, so it pastes into Finder, Explorer or Mail as itself.
        const file = staging.copy(id, item.file.name, stored);
        const url = pathToFileURL(file).href;

        await clipboard.write([
          new ClipboardItem({
            // On Windows a URI list becomes a file drop list (CF_HDROP).
            ...(isMac
              ? { [MAC_FILE_URL]: new Blob([url]) }
              : {
                  "text/uri-list": new Blob([url], { type: "text/uri-list" }),
                }),
            "text/plain": new Blob([item.file.name], { type: "text/plain" }),
          }),
        ]);
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

      if (settings.current().markDoneOnCopy && !item.done) {
        controller.apply({ id, type: "toggleDone" });
      }

      e2eLog("copied", { itemId: id, kind: item.kind });

      return { ok: true };
    } catch (error) {
      return { message: `Couldn't copy: ${errorMessage(error)}`, ok: false };
    }
  };

  // Set once the shelf's IPC server exists; menus built before then only reach it later.
  let sendCommand: ((command: ShelfCommand) => void) | null = null;

  // The image item open in the drawing window; null for a new drawing.
  let drawingItem: ItemId | null = null;

  const newDrawing = (): void => {
    drawingItem = null;
    drawing.open(null);
  };

  const openImage = (id: ItemId): void => {
    const item = controller.item(id);

    if (item?.kind !== "image") {
      return;
    }

    drawingItem = id;
    drawing.open({
      heightPx: item.image.heightPx,
      pin: item.pin,
      pixelsPerDip: item.image.pixelsPerDip,
      url: insetUrl.attachment(item.image.file),
      widthPx: item.image.widthPx,
    });
  };

  const shelfServer = serveContract(
    shelfContract,
    {
      addFiles: async (paths) => await addFiles(paths),
      apply: (op) => {
        controller.apply(op);

        if (op.type === "remove") {
          staging.clear(op.id);
        }
      },
      attachFiles: () => {
        void pickFiles();
      },
      captureArea: () => {
        void captureArea();
      },
      copy: copyItem,
      copyWithLink: (id) => {
        const item = controller.item(id);

        if (item !== undefined) {
          void clipboard.writeText(itemTextWithLink(item));
        }
      },
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
      newDrawing,
      openImage,
      openKeySettings,
      openLink: (id) => {
        const url = controller.item(id)?.context?.url;

        if (url !== undefined && url !== null && /^https?:\/\//u.test(url)) {
          void shell.openExternal(url);
        }
      },
      openSettings: () => {
        settingsWindow.open();
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
          context: null,
        });

        if (id !== null) {
          e2eLog("itemAdded", { itemId: id, kind: "image", via: "paste" });
          controller.focus(id);
        }

        return { ok: true };
      },
      startDrag: (id) => {
        void dragOut(id);
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

  /** A drawing exported at twice its size, so it stays sharp on Retina displays. */
  const DRAWING_PIXELS_PER_DIP = 2;

  /** Puts the annotated image in place of the old one, which is deleted once the shelf is saved. */
  const saveAnnotation = async (
    id: ItemId,
    image: NativeImage,
    copy: boolean
  ): Promise<ActionResult> => {
    const item = controller.item(id);

    if (item?.kind !== "image") {
      return { message: "This image is no longer on the shelf.", ok: false };
    }

    const { height, width } = image.getSize();

    controller.apply({
      id,
      image: {
        file: await store.writeAttachment(image.toPNG()),
        heightPx: height,
        pixelsPerDip: item.image.pixelsPerDip,
        widthPx: width,
      },
      type: "replaceImage",
    });
    // Copies dragged out earlier show the old picture.
    staging.clear(id);

    if (copy) {
      await copyItem(id);
    }

    drawing.close();
    e2eLog("itemAdded", { itemId: id, kind: "image", via: "annotation" });
    controller.focus(id);
    void showShelf();

    return { ok: true };
  };

  const drawingServer = serveContract(
    drawingContract,
    {
      cancel: () => {
        drawing.close();
      },
      getImage: async () => {
        const item =
          drawingItem === null ? undefined : controller.item(drawingItem);

        const file =
          item?.kind === "image" ? store.attachmentPath(item.image.file) : null;

        return file === null ? null : new Uint8Array(await readFile(file));
      },
      getView: () => drawing.view(),
      setDirty: drawing.setDirty,
      save: async ({ copy, png }) => {
        const image = nativeImage.createFromBuffer(Buffer.from(png));

        if (image.isEmpty()) {
          return { message: "The drawing could not be read.", ok: false };
        }

        if (drawingItem !== null) {
          return await saveAnnotation(drawingItem, image, copy);
        }

        const { height, width } = image.getSize();

        const id = controller.apply({
          context: null,
          image: {
            file: await store.writeAttachment(image.toPNG()),
            heightPx: height,
            pixelsPerDip: DRAWING_PIXELS_PER_DIP,
            widthPx: width,
          },
          pin: null,
          source: null,
          type: "addImage",
          via: "drawing",
        });

        if (copy && id !== null) {
          await copyItem(id);
        }

        drawing.close();

        if (id !== null) {
          e2eLog("itemAdded", { itemId: id, kind: "image", via: "drawing" });
          controller.focus(id);
          void showShelf();
        }

        return { ok: true };
      },
    },
    {
      appOrigin: appOrigin(),
      ipc: ipcMain,
      onRejected: logRejected,
      target: () => drawing.webContents,
    }
  );

  drawing.onView((view) => {
    drawingServer.emit("view", view);
  });
  drawing.onCloseRequest(() => {
    drawingServer.emit("confirmClose", null);
  });

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

  // What the menu shows; a note being typed changes the document but not this.
  let builtMenu = "";

  const refreshAppMenu = (): void => {
    const { doc, status } = controller.view();

    const shown = JSON.stringify([
      doc.sections,
      doc.activeSectionId,
      doc.items.some(
        (item) => item.done && item.sectionId === doc.activeSectionId
      ),
      status.keys,
      floatOnTop,
    ]);

    if (shown === builtMenu) {
      return;
    }

    builtMenu = shown;

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
            closeWindow: () => {
              if (drawing.isFocused()) {
                drawing.requestClose();
              } else if (settingsWindow.isFocused()) {
                settingsWindow.close();
              } else {
                shelf.hide();
              }
            },
            copy: () => {
              sendCommand?.({ kind: "copy" });
            },
            copyAsList: () => {
              const current = controller.view().doc;

              void clipboard.writeText(
                itemsAsList(
                  current.items.filter(
                    (item) => item.sectionId === current.activeSectionId
                  )
                )
              );
            },
            find: () => {
              void commandShelf({ kind: "find" });
            },
            newDrawing,
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
            openSettings: settingsWindow.open,
            redo: () => {
              if (drawing.isFocused()) {
                drawingServer.emit("edit", "redo");
              } else {
                BrowserWindow.getFocusedWindow()?.webContents.redo();
              }
            },
            turnOnKeys: openKeySettings,
            undo: () => {
              if (drawing.isFocused()) {
                drawingServer.emit("edit", "undo");
              } else {
                sendCommand?.({ kind: "undo" });
              }
            },
          },
          isMac
        )
      )
    );

    // Windows gives every window this menu; its shortcuts work with the bar hidden.
    if (!isMac) {
      for (const window of BrowserWindow.getAllWindows()) {
        window.setMenuBarVisibility(false);
      }
    }
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
  // So does opening the app again from Start or a shortcut while it runs.
  app.on("second-instance", () => {
    if (!overlayOpen) {
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

  const shortcutsRegistered =
    globalShortcut.register(TOGGLE_ACCELERATOR, () => {
      void toggleShelf();
    }) &&
    globalShortcut.register(AREA_ACCELERATOR, () => {
      void captureArea();
    });

  const run = (action: TrayAction): void => {
    switch (action) {
      case "toggleShelf": {
        void toggleShelf();
        break;
      }

      case "captureArea": {
        void captureArea();
        break;
      }

      case "turnOnKeys": {
        openKeySettings();
        break;
      }

      case "openSettings": {
        settingsWindow.open();
        break;
      }

      default: {
        break;
      }
    }
  };

  /**
   * Shows the app's icon in the Dock, the menu bar or both. Without the Dock
   * icon the app is an accessory, so it has no menu bar of its own either.
   * Elsewhere the tray is the only icon, so it always stays.
   */
  const placeIcon = (place: IconPlace): void => {
    const wantsTray = !isMac || place !== "dock";

    if (wantsTray && tray === null) {
      tray = createTray({
        iconPath: trayIconPath,
        model: () => ({
          keys: controller.view().status.keys,
          shelfVisible: shelf.isVisible(),
          shortcutsRegistered,
        }),
        run,
      });
    } else if (!wantsTray && tray !== null) {
      tray.destroy();
      tray = null;
    }

    if (isMac) {
      app.setActivationPolicy(place === "menuBar" ? "accessory" : "regular");
    }
  };

  placeIcon(settings.current().iconIn);

  const settingsView = (): SettingsView => ({
    openAtLogin: app.getLoginItemSettings().openAtLogin,
    settings: settings.current(),
    version: app.getVersion(),
  });

  const settingsServer = serveContract(
    settingsContract,
    {
      getView: settingsView,
      setOpenAtLogin: (on) => {
        app.setLoginItemSettings({ openAtLogin: on });
        settingsServer.emit("view", settingsView());
      },
      update: (change) => {
        const before = settings.current().iconIn;

        void (async () => {
          try {
            await settings.update(change);
          } catch (error) {
            console.warn(`Settings not saved: ${errorMessage(error)}`);
          }

          if (settings.current().iconIn !== before) {
            placeIcon(settings.current().iconIn);
            // Turning into an accessory can send the app's windows away.
            settingsWindow.open();
          }

          settingsServer.emit("view", settingsView());
        })();
      },
    },
    {
      appOrigin: appOrigin(),
      ipc: ipcMain,
      onRejected: logRejected,
      target: () => settingsWindow.webContents,
    }
  );

  await Promise.all([
    shelf.load(),
    overlay.load(),
    toast.load(),
    drawing.load(),
    settingsWindow.load(),
  ]);

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

import { randomUUID } from "node:crypto";
import { access, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

import {
  drawingContract,
  screenshotContract,
  settingsContract,
  shelfContract,
  toastContract,
} from "@shared/contracts";
import type { ActionResult, Permission, ShelfCommand } from "@shared/contracts";
import type { Rect } from "@shared/geometry";
import { insetUrl } from "@shared/inset-url";
import type { IconPlace, SettingsView } from "@shared/settings";
import {
  ItemIdSchema,
  SectionIdSchema,
  itemsAsList,
  itemTextWithLink,
} from "@shared/shelf";
import type { ItemContext, ItemId, MainOp, ShelfItem } from "@shared/shelf";
import { TOGGLE_ACCELERATOR } from "@shared/shortcut";
import { desktopApp, desktopLink, isAppLink } from "@shared/web-source";
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
  screen,
  shell,
  systemPreferences,
} from "electron";
import type { NativeImage } from "electron";

import { ADDED_FILE_MAX_BYTES, classifyAddedFile } from "./added-file";
import { appMenuTemplate, HELP_URL } from "./app-menu";
import { chatGptThreadLink } from "./codex-threads";
import { createDrawingWindow } from "./drawing-window";
import { e2eLog } from "./e2e-log";
import { exportFileName } from "./export-name";
import { createDragStaging, exportImage } from "./exports";
import { frontWindow } from "./front-window";
import { serveContract } from "./ipc-kit";
import { createKeyMonitor } from "./key-monitor";
import { openApp } from "./open-app";
import { handleInsetProtocol, registerInsetScheme } from "./protocol";
import { createScreenshotWatcher } from "./screenshot-watcher";
import { createScreenshotWindow } from "./screenshot-window";
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

const KEYS_POLL_MS = 3000;

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

/** The HTML on the clipboard, or "" without any. */
const readClipboardHtml = async (): Promise<string> => {
  const items = await clipboard.read();
  const item = items.find((candidate) => candidate.types.includes("text/html"));

  if (item === undefined) {
    return "";
  }

  const html = await item.getType("text/html");

  return await html.text();
};

const restoreClipboard = async (saved: ClipboardSnapshot): Promise<void> => {
  if (saved.length === 0) {
    clipboard.clear();

    return;
  }

  await clipboard.write(saved.map((data) => new ClipboardItem(data)));
};

/** Opens the chat or page an item came from in its desktop app, else just brings the app forward. */
const openInApp = async (
  name: string,
  context: ItemContext | null
): Promise<void> => {
  const stored = context?.appLink ?? null;

  const link =
    (stored !== null && isAppLink(stored) ? stored : null) ??
    desktopLink(name, context?.url ?? null) ??
    (name === "ChatGPT"
      ? await chatGptThreadLink(context?.title ?? null)
      : null);

  if (link === null) {
    openApp(name);
  } else {
    await shell.openExternal(link);
  }
};

/**
 * The addresses an item may open: the page it came from, the links copied
 * with it, and, for a link written in a Markdown note, any address that
 * appears in its own words.
 */
const itemAddresses = (
  item: ShelfItem | undefined,
  asked?: string
): readonly string[] => {
  if (item === undefined) {
    return [];
  }

  const page = item.context?.url ?? null;

  if (item.kind !== "text") {
    return page === null ? [] : [page];
  }

  const written =
    asked !== undefined && item.text.includes(asked) ? [asked] : [];

  return [
    ...(page === null ? [] : [page]),
    ...item.links.map((link) => link.url),
    ...written,
  ];
};

const pad = (value: number): string => String(value).padStart(2, "0");

/** Named like macOS names its own: "Screenshot 2026-10-23 at 21.03.46.png". */
const screenshotFileName = (when: Date): string =>
  `Screenshot ${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} at ${pad(when.getHours())}.${pad(when.getMinutes())}.${pad(when.getSeconds())}.png`;

/** A path in the folder that no file has yet: " 2", " 3"… before the extension when the name is taken. */
const freePath = async (folder: string, name: string): Promise<string> => {
  const { ext, name: stem } = path.parse(name);

  for (let attempt = 1; attempt < 100; attempt += 1) {
    const candidate = path.join(
      folder,
      attempt === 1 ? name : `${stem} ${attempt}${ext}`
    );

    try {
      // oxlint-disable-next-line no-await-in-loop -- each name is only tried once the one before it is taken.
      await access(candidate);
    } catch {
      return candidate;
    }
  }

  return path.join(folder, `${stem} ${Date.now()}${ext}`);
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

  let tray: ShelfTray | null = null;

  const refreshTray = (): void => {
    tray?.refresh();
  };

  const shelf = createShelfWindow({
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
    e2eLog("drawingShown", { itemId: id });
    drawing.open({
      heightPx: item.image.heightPx,
      pin: item.pin,
      pixelsPerDip: item.image.pixelsPerDip,
      url: insetUrl.attachment(item.image.file),
      widthPx: item.image.widthPx,
    });
  };

  const toast = createToastWindow({
    preload: preloadPath("toast"),
    url: pageUrl("toast"),
  });

  const settingsWindow = createSettingsWindow({
    handOff: focusShelf,
    preload: preloadPath("settings"),
    url: pageUrl("settings"),
  });

  const screenshotCard = createScreenshotWindow({
    preload: preloadPath("screenshot"),
    url: pageUrl("screenshot"),
  });

  // The newest screenshot, held in memory for its card: the file may be moved or deleted meanwhile.
  let shot: {
    readonly seq: number;
    readonly token: string;
    readonly image: NativeImage;
    readonly png: Uint8Array;
    readonly file: string | null;
  } | null = null;

  let shotSeq = 0;

  const screenshots = createScreenshotWatcher((image, file) => {
    if (!settings.current().screenshotCards) {
      return;
    }

    shotSeq += 1;
    shot = {
      file,
      image,
      png: image.toPNG(),
      seq: shotSeq,
      token: randomUUID().replaceAll("-", ""),
    };

    const { height, width } = image.getSize();

    screenshotCard.show(
      {
        heightPx: height,
        imageUrl: insetUrl.shot(shot.token),
        seq: shotSeq,
        widthPx: width,
      },
      shelf.bounds()
    );
    e2eLog("screenshotShown");
  });

  handleInsetProtocol({
    // Only images are shown in the shelf; other attached files are never served to a page.
    attachmentFile: (file) =>
      file.endsWith(".png") ? store.attachmentPath(file) : null,
    shot: (token) => (shot !== null && shot.token === token ? shot.png : null),
    rendererRoot: rendererRoot(),
  });

  const keyMonitor = createKeyMonitor();

  let capturingSelection = false;

  const onDoubleTap = async (): Promise<void> => {
    e2eLog("doubleTap");

    if (capturingSelection) {
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
      const front = frontWindow({ page: true });

      const result = await captureSelection({
        clear: () => {
          screenshots.ignoreClipboard();
          clipboard.clear();
        },
        copy: keyMonitor.copy,
        readHtml: readClipboardHtml,
        readText: async () => await clipboard.readText(),
        restore: async (saved) => {
          screenshots.ignoreClipboard();
          await restoreClipboard(saved);
        },
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
        html: result.html,
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

  // Set once the shelf's IPC server exists; a toast in the shelf, or the native one while it is hidden.
  let notify: (message: string) => void = (message) => {
    toast.show(message, "");
  };

  const pickFiles = async (): Promise<void> => {
    const picked = await dialog.showOpenDialog(shelf.dialogParent, {
      properties: ["openFile", "multiSelections"],
      title: "Attach Files",
    });

    if (!picked.canceled && picked.filePaths.length > 0) {
      const result = await addFiles(picked.filePaths);

      if (result.ok) {
        const count = picked.filePaths.length;

        notify(count === 1 ? "Added 1 file" : `Added ${count} files`);
      } else {
        controller.setStatus({ problem: result.message });
      }
    }
  };

  /** Items as one numbered list, with the first image (pin drawn in) beside the words, as Copper does. */
  const copyList = async (ids: readonly ItemId[]): Promise<ActionResult> => {
    screenshots.ignoreClipboard();

    const items = ids.flatMap((id) => {
      const item = controller.item(id);

      return item === undefined ? [] : [item];
    });

    const list = itemsAsList(items);
    const firstImage = items.find((item) => item.kind === "image");

    const imageFile =
      firstImage?.kind === "image"
        ? store.attachmentPath(firstImage.image.file)
        : null;

    const exported =
      firstImage?.kind === "image" && imageFile !== null
        ? exportImage(firstImage, imageFile)
        : null;

    if (list.count === 0 && exported === null) {
      return { message: "There is nothing to copy.", ok: false };
    }

    try {
      const data: ClipboardData = {};

      if (list.count > 0) {
        data["text/plain"] = new Blob([list.text], { type: "text/plain" });
        data["text/html"] = new Blob([list.html], { type: "text/html" });
      }

      if (exported !== null) {
        data["image/png"] = new Blob([exported.png], { type: "image/png" });
      }

      await clipboard.write([new ClipboardItem(data)]);

      if (settings.current().markDoneOnCopy) {
        for (const item of items) {
          if (!item.done) {
            controller.apply({ id: item.id, type: "toggleDone" });
          }
        }
      }

      e2eLog("copied", { kind: "list" });

      return { ok: true };
    } catch (error) {
      return { message: `Couldn't copy: ${errorMessage(error)}`, ok: false };
    }
  };

  const copyItem = async (id: ItemId): Promise<ActionResult> => {
    screenshots.ignoreClipboard();

    const item = controller.item(id);

    if (item === undefined) {
      return { message: "This item no longer exists.", ok: false };
    }

    try {
      if (item.kind === "text" && item.html !== null) {
        // The copied HTML goes back next to the text, so links and formatting paste too.
        await clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([item.html], { type: "text/html" }),
            "text/plain": new Blob([item.text], { type: "text/plain" }),
          }),
        ]);
      } else if (item.kind === "text") {
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
      copy: copyItem,
      copyList,
      copyWithLink: (id) => {
        screenshots.ignoreClipboard();

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
        } else if (action === "selectAll") {
          shelf.webContents.selectAll();
        } else if (action === "redo") {
          shelf.webContents.redo();
        } else {
          shelf.webContents.undo();
        }
      },
      newDrawing,
      openImage,
      openKeySettings,
      openLink: ({ id, url }) => {
        const item = controller.item(id);
        const fromApp = isMac ? desktopApp(item?.context?.app ?? null) : null;

        // An item from a desktop app (ChatGPT, Claude…) opens there again, at its chat or page when the app has a link for it.
        if (url === undefined && fromApp !== null) {
          void openInApp(fromApp, item?.context ?? null);

          return;
        }

        // Only the item's own page or a link in it opens, and only over http or https.
        const target =
          url === undefined
            ? (item?.context?.url ?? null)
            : itemAddresses(item, url).find((known) => known === url);

        if (
          target !== undefined &&
          target !== null &&
          /^https?:\/\//u.test(target)
        ) {
          void shell.openExternal(target);
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

  /** The card's screenshot, when it is still the newest; null for an older card's request. */
  const currentShot = (seq: number) =>
    shot !== null && shot.seq === seq ? shot : null;

  /** Saves the card's screenshot to the shelf, in the section new items go to, and puts the card away. */
  const addShot = async (seq: number): Promise<ItemId | null> => {
    const current = currentShot(seq);

    if (current === null) {
      return null;
    }

    shot = null;
    screenshotCard.hide();

    const { height, width } = current.image.getSize();

    const { scaleFactor } = screen.getDisplayNearestPoint(
      screen.getCursorScreenPoint()
    );

    const id = controller.apply({
      context: null,
      image: {
        file: await store.writeAttachment(current.png),
        heightPx: height,
        pixelsPerDip: scaleFactor,
        widthPx: width,
      },
      pin: null,
      source: null,
      type: "addImage",
      via: "screenshot",
    });

    if (id !== null) {
      e2eLog("itemAdded", { itemId: id, kind: "image", via: "screenshot" });
    }

    return id;
  };

  const activeSectionName = (): string => {
    const { doc } = controller.view();

    return (
      doc.sections.find((section) => section.id === doc.activeSectionId)
        ?.name ?? "the shelf"
    );
  };

  const screenshotServer = serveContract(
    screenshotContract,
    {
      addToShelf: (seq) => {
        void (async () => {
          const id = await addShot(seq);

          if (id === null) {
            return;
          }

          if (shelf.isVisible()) {
            controller.focus(id);
          }

          notify(`Added to ${activeSectionName()}`);
        })();
      },
      annotate: (seq) => {
        void (async () => {
          const id = await addShot(seq);

          // An open drawing keeps its marks; the screenshot is only saved then.
          if (id === null || drawing.isVisible()) {
            notify(`Added to ${activeSectionName()}`);

            return;
          }

          controller.focus(id);
          openImage(id);
        })();
      },
      copy: (seq) => {
        const current = currentShot(seq);

        if (current === null) {
          return;
        }

        shot = null;
        screenshotCard.hide();
        screenshots.ignoreClipboard();
        void (async () => {
          await clipboard.write([
            new ClipboardItem({
              "image/png": new Blob([current.png], { type: "image/png" }),
            }),
          ]);
          notify("Copied screenshot");
        })();
      },
      dismiss: (seq) => {
        if (currentShot(seq) !== null) {
          shot = null;
          screenshotCard.hide();
        }
      },
      getView: () => screenshotCard.view(),
      hold: (seq) => {
        if (currentShot(seq) !== null) {
          screenshotCard.hold();
        }
      },
      hover: screenshotCard.hover,
      saveToDownloads: (seq) => {
        const current = currentShot(seq);

        if (current === null) {
          return;
        }

        shot = null;
        screenshotCard.hide();
        void (async () => {
          try {
            await writeFile(
              await freePath(
                app.getPath("downloads"),
                screenshotFileName(new Date())
              ),
              current.png
            );
            notify("Saved to Downloads");
          } catch (error) {
            controller.setStatus({
              problem: `The screenshot couldn't be saved: ${errorMessage(error)}`,
            });
          }
        })();
      },
      startDrag: (seq) => {
        const current = currentShot(seq);

        if (current === null) {
          return;
        }

        const file =
          current.file ??
          staging.write(`screenshot-${seq}`, "Screenshot.png", current.png);

        screenshotCard.webContents.startDrag({
          file,
          icon: current.image.resize({ width: 128 }),
        });
      },
    },
    {
      appOrigin: appOrigin(),
      ipc: ipcMain,
      onRejected: logRejected,
      target: () => screenshotCard.webContents,
    }
  );

  screenshotCard.onView((view) => {
    screenshotServer.emit("view", view);
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

  notify = (message) => {
    if (shelf.isVisible()) {
      shelfServer.emit("notice", { message });
    } else {
      toast.show(message, "");
    }
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
            clearDone: () => {
              void commandShelf({ kind: "clearDone" });
            },
            item: (action) => {
              void commandShelf({ action, kind: "item" });
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
            // The shelf knows what is picked: the picked items, else the section's open ones.
            copyAsList: () => {
              void commandShelf({ action: "copyList", kind: "item" });
            },
            find: () => {
              void commandShelf({ kind: "find" });
            },
            selectAll: () => {
              if (shelf.isFocused()) {
                sendCommand?.({ kind: "selectAll" });
              } else {
                // Settings and the drawing's text field keep their own Select All.
                BrowserWindow.getFocusedWindow()?.webContents.selectAll();
              }
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
              } else if (shelf.isFocused()) {
                sendCommand?.({ kind: "redo" });
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
    if (!shelf.isVisible()) {
      void showShelf();
    }
  });
  // So does opening the app again from Start or a shortcut while it runs.
  app.on("second-instance", () => {
    void showShelf();
  });
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

  const shortcutsRegistered = globalShortcut.register(
    TOGGLE_ACCELERATOR,
    () => {
      void toggleShelf();
    }
  );

  const run = (action: TrayAction): void => {
    switch (action) {
      case "toggleShelf": {
        void toggleShelf();
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
      fitHeight: settingsWindow.fitHeight,
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

          if (settings.current().screenshotCards) {
            screenshots.start();
          } else {
            screenshots.stop();
            screenshotCard.hide();
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
    toast.load(),
    screenshotCard.load(),
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
    screenshots.stop();
    staging.clear();
    void finishQuit();
  });

  if (settings.current().screenshotCards) {
    screenshots.start();
  }

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

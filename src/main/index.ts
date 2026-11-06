import { randomUUID } from "node:crypto";
import { access, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import {
  drawingContract,
  pickerContract,
  screenshotContract,
  settingsContract,
  shelfContract,
  toastContract,
} from "@shared/contracts";
import type {
  ActionResult,
  NoticeTone,
  Permission,
  PickerView,
  ShelfCommand,
} from "@shared/contracts";
import type { Rect } from "@shared/geometry";
import { insetUrl } from "@shared/inset-url";
import type { IconPlace, SettingsView } from "@shared/settings";
import { ItemIdSchema, SectionIdSchema, itemText } from "@shared/shelf";
import type {
  ItemContext,
  ItemId,
  MainOp,
  Pin,
  ShelfItem,
  WindowRef,
} from "@shared/shelf";
import { TOGGLE_ACCELERATOR } from "@shared/shortcut";
import { desktopLink, isAppLink, openingApp } from "@shared/web-source";
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
import type { NativeImage, WebContents } from "electron";

import { ADDED_FILE_MAX_BYTES, classifyAddedFile } from "./added-file";
import { appMenuTemplate, HELP_URL } from "./app-menu";
import { chatGptThreadLink } from "./codex-threads";
import { createCopyCommands } from "./copy-commands";
import { createCopyGate } from "./copy-gate";
import type { ClipboardContents } from "./copy-gate";
import { copySource } from "./copy-source";
import { createDrawingWindow } from "./drawing-window";
import { e2eLog } from "./e2e-log";
import { exportFileName } from "./export-name";
import { createDragStaging, exportImage } from "./exports";
import { frontWindow } from "./front-window";
import { serveContract } from "./ipc-kit";
import { createKeyMonitor } from "./key-monitor";
import { menuEntryForKey } from "./menu-keys";
import { openApp, openAppAt } from "./open-app";
import { createPickerWindow } from "./picker-window";
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
import { updateNotice } from "./update-state";
import { createUpdater } from "./updater";
import { canListWindows, createWindowLinker } from "./window-links";
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

const MAC_SCREEN_SETTINGS =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";

const KEYS_POLL_MS = 3000;

const TOAST_EXCERPT = 80;

const isMac = process.platform === "darwin";

const openHelp = (): void => {
  void shell.openExternal(HELP_URL);
};

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

const snapshotClipboard = async (): Promise<readonly ClipboardContents[]> => {
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

/** Opens the chat or page an item came from in its desktop app, else (macOS only) just brings the app forward. */
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

  if (link !== null) {
    await shell.openExternal(link);
  } else if (isMac) {
    openApp(name);
  }
};

/** The note a new window link starts as: the windows' titles, which the user can then edit. */
const linkText = (windows: readonly WindowRef[]): string =>
  windows.map((window) => window.title ?? window.app ?? "Window").join(" · ");

/** Pages with a menu open, which then take every key themselves (src/renderer/lib/menu-keys.ts). */
const withMenuOpen = new WeakSet<WebContents>();

const setMenuOpen = (contents: WebContents, open: boolean): void => {
  if (open) {
    withMenuOpen.add(contents);
  } else {
    withMenuOpen.delete(contents);
  }

  contents.setIgnoreMenuShortcuts(open);
};

/**
 * Runs the app menu's entry for a key press in this page (item 8): on
 * Windows the frameless windows have no menu bar to take the keys from.
 * Preventing the event also keeps it from the page and the menu. While a
 * menu is open in the page, the keys are the menu's.
 */
const answerMenuKeys = (contents: WebContents): void => {
  contents.on("before-input-event", (event, input) => {
    if (withMenuOpen.has(contents)) {
      return;
    }

    const menu = Menu.getApplicationMenu();
    const entry = menu === null ? null : menuEntryForKey(menu.items, input);

    if (entry !== null) {
      event.preventDefault();
      // Electron types click as Function. It is an arrow function taking (event, focusedWindow, focusedWebContents).
      entry.click.call(
        undefined,
        undefined,
        BrowserWindow.fromWebContents(contents) ?? undefined,
        contents
      );
    }
  });
};

/**
 * Reopens a linked window: its page in the browser, its file in its app,
 * else its app brought forward. Every target was read by main when the
 * window was linked, never sent by a page.
 */
const reopenWindow = (window: WindowRef): void => {
  if (window.url !== null && /^https?:\/\//u.test(window.url)) {
    void shell.openExternal(window.url);
  } else if (window.document !== null) {
    void shell.openPath(window.document);
  } else if (window.appPath !== null) {
    if (isMac) {
      openAppAt(window.appPath);
    } else {
      void shell.openPath(window.appPath);
    }
  } else if (window.app !== null && isMac) {
    openApp(window.app);
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

/** Named like the system names its own: "Screenshot 2026-10-23 at 21.03.46.png" on macOS, "Screenshot 2026-10-23 210346.png" on Windows. */
const screenshotFileName = (when: Date): string => {
  const day = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
  const time = [when.getHours(), when.getMinutes(), when.getSeconds()].map(pad);

  return isMac
    ? `Screenshot ${day} at ${time.join(".")}.png`
    : `Screenshot ${day} ${time.join("")}.png`;
};

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

  // Item 8: Windows has no menu bar for the frameless shelf to take the menu's
  // keys from, so every window reads them itself and runs the entry.
  if (!isMac) {
    app.on("browser-window-created", (_event, window) => {
      answerMenuKeys(window.webContents);
    });
  }

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
      floatOnTop: true,
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

  // A page that reloads or crashes with a menu open never says it closed.
  const forgetMenu = (): void => {
    setMenuOpen(shelf.webContents, false);
  };

  shelf.webContents.on("did-start-loading", forgetMenu);
  shelf.webContents.on("render-process-gone", forgetMenu);

  // The window the shelf last docked to, kept for when Inset itself is in front.
  let lastTarget: Rect<"screen"> | null = null;

  /**
   * Docks to the window in front, read before the shelf takes any focus.
   * After a capture or a drawing, Inset's own window is in front: the shelf
   * goes back beside the window it was docked to.
   */
  const showShelf = async (
    options: { readonly dock?: boolean } = {}
  ): Promise<void> => {
    // From the notification area, the window in front is a part of the taskbar.
    if (options.dock === false) {
      shelf.show(null);

      return;
    }

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

  const openImage = (id: ItemId, pinMode = false): void => {
    const item = controller.item(id);

    if (item?.kind !== "image") {
      return;
    }

    drawingItem = id;
    e2eLog("drawingShown", { itemId: id });
    drawing.open({
      heightPx: item.image.heightPx,
      pinMode,
      pins: item.pins,
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

  // Every copy goes through this gate: it waits for the disk, and copies nothing when the save failed.
  const gate = createCopyGate({
    clipboard,
    flush: controller.flush,
    onWrite: screenshots.ignoreClipboard,
    toItem: (data) => new ClipboardItem(data),
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
      const capture = captureSelection({
        clear: gate.clearForSelection,
        copy: keyMonitor.copy,
        readHtml: readClipboardHtml,
        readSource: async () => await copySource(await clipboard.read()),
        readText: async () => await clipboard.readText(),
        restore: gate.restore,
        snapshot: snapshotClipboard,
        wait: delay,
      });

      const copiedFrom = async (): Promise<string | null> => {
        try {
          const copied = await capture;

          return copied.kind === "text" ? copied.source : null;
        } catch {
          return null;
        }
      };

      // Sampled alongside the copy, while the app with the selection is in front.
      const front = frontWindow({ copiedFrom: copiedFrom(), page: true });

      const result = await capture;

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
          pins: [],
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
  let notify: (message: string, tone?: NoticeTone) => void = (
    message,
    tone
  ) => {
    toast.show(message, "", tone);
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

  const copies = createCopyCommands({
    exportImage: (item) => {
      const file = store.attachmentPath(item.image.file);
      const exported = file === null ? null : exportImage(item, file);

      return exported === null
        ? null
        : { png: exported.png, widthPx: exported.image.getSize().width };
    },
    gate,
    item: controller.item,
    mac: isMac,
    onCopied: (items, kind) => {
      if (settings.current().markDoneOnCopy) {
        for (const item of items) {
          if (!item.done) {
            controller.apply({ id: item.id, type: "toggleDone" });
          }
        }
      }

      const [first] = items;

      e2eLog(
        "copied",
        kind === "list" || first === undefined
          ? { kind: "list" }
          : { itemId: first.id, kind: first.kind }
      );
    },
    stageFile: (item) => {
      const stored = store.attachmentPath(item.file.stored);

      return stored === null
        ? null
        : staging.copy(item.id, item.file.name, stored);
    },
  });

  // The window-link picker: New Window Link… makes a note, Link Window… adds to an item.
  const picker = createPickerWindow({
    handOff: focusShelf,
    preload: preloadPath("picker"),
    url: pageUrl("picker"),
  });

  const linker = createWindowLinker({
    now: () => new Date(),
    ownSourceIds: () =>
      new Set(
        BrowserWindow.getAllWindows().map((window) => window.getMediaSourceId())
      ),
    writeAttachment: store.writeAttachment,
  });

  let pickerTarget: ItemId | null = null;

  let pickerView: PickerView = {
    linking: false,
    seq: 0,
    state: { kind: "loading" },
    target: { kind: "new" },
  };

  // Set once the picker's IPC server exists.
  let showPickerView: ((view: PickerView) => void) | null = null;

  const setPickerView = (patch: Partial<PickerView>): void => {
    pickerView = { ...pickerView, ...patch };
    showPickerView?.(pickerView);
  };

  const listWindows = async (): Promise<void> => {
    const { seq } = pickerView;

    if (!canListWindows()) {
      setPickerView({ state: { kind: "permission" } });

      return;
    }

    setPickerView({ state: { kind: "loading" } });

    try {
      const candidates = await linker.list();

      // A newer opening started over meanwhile.
      if (pickerView.seq === seq) {
        setPickerView({ state: { candidates, kind: "ready" } });
      }
    } catch (error) {
      setPickerView({
        state: {
          kind: "failed",
          message: `The open windows couldn't be listed: ${errorMessage(error)}`,
        },
      });
    }
  };

  const openPicker = (target: ItemId | null): void => {
    const item = target === null ? undefined : controller.item(target);

    pickerTarget = item === undefined ? null : item.id;
    setPickerView({
      linking: false,
      seq: pickerView.seq + 1,
      state: { kind: "loading" },
      target:
        item === undefined
          ? { kind: "new" }
          : { kind: "item", label: excerpt(itemText(item)) },
    });
    picker.open();
    void listWindows();
  };

  const chooseWindows = async (
    ids: readonly string[]
  ): Promise<ActionResult> => {
    setPickerView({ linking: true });

    try {
      const windows = await linker.capture(ids);

      if (windows.length === 0) {
        setPickerView({ linking: false });

        return {
          message: "Those windows are gone. Refresh the list and pick again.",
          ok: false,
        };
      }

      const target =
        pickerTarget === null ? undefined : controller.item(pickerTarget);

      picker.close();

      if (target === undefined) {
        const id = controller.apply({
          context: null,
          html: null,
          text: linkText(windows),
          type: "addText",
          via: "typed",
          windows: [...windows],
        });

        await showShelf();

        if (id !== null) {
          e2eLog("itemAdded", { itemId: id, kind: "text", via: "windowLink" });
          controller.focus(id, true);
        }
      } else {
        controller.apply({
          id: target.id,
          type: "attachWindows",
          windows: [...windows],
        });
        notify(
          windows.length === 1
            ? "Linked 1 window"
            : `Linked ${windows.length} windows`
        );
      }

      return { ok: true };
    } catch (error) {
      setPickerView({ linking: false });

      return {
        message: `The windows couldn't be linked: ${errorMessage(error)}`,
        ok: false,
      };
    }
  };

  const pickerServer = serveContract(
    pickerContract,
    {
      cancel: () => {
        picker.close();
      },
      choose: chooseWindows,
      getView: () => pickerView,
      openScreenSettings: () => {
        if (isMac) {
          void shell.openExternal(MAC_SCREEN_SETTINGS);
        }
      },
      refresh: () => {
        void listWindows();
      },
    },
    {
      appOrigin: appOrigin(),
      ipc: ipcMain,
      onRejected: logRejected,
      target: () => picker.webContents,
    }
  );

  showPickerView = (view) => {
    pickerServer.emit("view", view);
  };

  // Set once the shelf's IPC server exists; menus built before then only reach it later.
  let sendCommand: ((command: ShelfCommand) => void) | null = null;

  /** Window › Float on Top; the menu bar and the shelf's ⋯ show the status. */
  const setFloatOnTop = (on: boolean): void => {
    shelf.setFloatOnTop(on);
    controller.setStatus({ floatOnTop: on });
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
      copy: copies.copy,
      copyDetails: copies.copyDetails,
      copyList: copies.copyList,
      copyWithLink: copies.copyWithLink,
      linkWindows: (id) => {
        openPicker(id);
      },
      newWindowLink: () => {
        openPicker(null);
      },
      reopenWindow: ({ id, windowId }) => {
        const windows = controller.item(id)?.windows ?? [];

        for (const window of windows) {
          if (windowId === undefined || window.id === windowId) {
            reopenWindow(window);
          }
        }
      },
      dismissProblem: () => {
        controller.setStatus({ problem: null });
      },
      getView: () => controller.view(),
      hide: () => {
        shelf.hide();
      },
      menuOpen: (open) => {
        setMenuOpen(shelf.webContents, open);
      },
      nativeEdit: (action) => {
        if (action === "copy") {
          gate.copySelection(shelf.webContents);
        } else if (action === "selectAll") {
          shelf.webContents.selectAll();
        } else if (action === "redo") {
          shelf.webContents.redo();
        } else {
          shelf.webContents.undo();
        }
      },
      newDrawing,
      openHelp,
      openImage: (id) => {
        openImage(id);
      },
      openPins: (id) => {
        openImage(id, true);
      },
      openKeySettings,
      openLink: ({ id, url }) => {
        const item = controller.item(id);
        const fromApp = openingApp(item?.context ?? null, isMac);

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
          pins: [],
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
      setFloatOnTop,
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

  /** Shows the shelf with the saved image; when Copy and Save could not copy, it says why there. */
  const showSaved = async (copied: ActionResult | null): Promise<void> => {
    await showShelf();

    if (copied !== null && !copied.ok) {
      notify(copied.message, "failed");
    }
  };

  /** A drawing exported at twice its size, so it stays sharp on Retina displays. */
  const DRAWING_PIXELS_PER_DIP = 2;

  /**
   * Puts the annotated image in place of the old one, which is deleted once
   * the shelf is saved, and keeps its pins; without new marks (`image`
   * null) only the pins change.
   */
  const saveAnnotation = async (
    id: ItemId,
    image: NativeImage | null,
    pins: readonly Pin[],
    copy: boolean
  ): Promise<ActionResult> => {
    const item = controller.item(id);

    if (item?.kind !== "image") {
      return { message: "This image is no longer on the shelf.", ok: false };
    }

    if (image !== null) {
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
    }

    controller.apply({ id, pins: [...pins], type: "setPins" });
    // Copies dragged out earlier show the old picture and pins.
    staging.clear(id);

    const copied = copy ? await copies.copy(id) : null;

    drawing.close();
    e2eLog("itemAdded", { itemId: id, kind: "image", via: "annotation" });
    controller.focus(id);
    void showSaved(copied);

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
      save: async ({ copy, pins, png }) => {
        if (png === null) {
          return drawingItem === null
            ? { message: "There is nothing to save.", ok: false }
            : await saveAnnotation(drawingItem, null, pins, copy);
        }

        const image = nativeImage.createFromBuffer(Buffer.from(png));

        if (image.isEmpty()) {
          return { message: "The drawing could not be read.", ok: false };
        }

        if (drawingItem !== null) {
          return await saveAnnotation(drawingItem, image, pins, copy);
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
          pins,
          source: null,
          type: "addImage",
          via: "drawing",
        });

        const copied = copy && id !== null ? await copies.copy(id) : null;

        drawing.close();

        if (id !== null) {
          e2eLog("itemAdded", { itemId: id, kind: "image", via: "drawing" });
          controller.focus(id);
          void showSaved(copied);
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
      pins: [],
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

        void (async () => {
          const copied = await copies.copyScreenshot(current.png);

          if (!copied.ok) {
            // The card stays, so the screenshot isn't lost.
            notify(copied.message, "failed");

            return;
          }

          if (shot === current) {
            shot = null;
            screenshotCard.hide();
          }

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

  notify = (message, tone = "done") => {
    if (shelf.isVisible()) {
      shelfServer.emit("notice", { message, tone });
    } else {
      toast.show(message, "", tone);
    }
  };

  /** Sends a menu choice to the shelf, showing it first, since it acts on the shelf's own state. */
  const commandShelf = async (command: ShelfCommand): Promise<void> => {
    if (!shelf.isFocused()) {
      await showShelf();
    }

    sendCommand(command);
  };

  const updater = createUpdater();

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
      status.floatOnTop,
      updater.state(),
    ]);

    if (shown === builtMenu) {
      return;
    }

    builtMenu = shown;

    Menu.setApplicationMenu(
      Menu.buildFromTemplate(
        appMenuTemplate(
          {
            doc,
            floatOnTop: status.floatOnTop,
            keys: status.keys,
            update: updater.state(),
          },
          {
            checkForUpdates: updater.check,
            clearDone: () => {
              void commandShelf({ kind: "clearDone" });
            },
            item: (action) => {
              void commandShelf({ action, kind: "item" });
            },
            closeWindow: () => {
              if (drawing.isFocused()) {
                drawing.requestClose();
              } else if (picker.isFocused()) {
                picker.close();
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
            field: (field) => {
              void commandShelf({ field, kind: "field" });
            },
            newWindowLink: () => {
              openPicker(null);
            },
            showShortcuts: () => {
              void commandShelf({ kind: "shortcuts" });
            },
            newSection: () => {
              void commandShelf({ kind: "newSection" });
            },
            openHelp,
            selectSection: (id) => {
              controller.apply({ id, type: "selectSection" });
            },
            setFloatOnTop,
            openSettings: settingsWindow.open,
            restartToUpdate: updater.restart,
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
  updater.subscribe((next, previous) => {
    refreshTray();
    refreshAppMenu();

    const notice = updateNotice(previous, next);

    if (notice !== null) {
      notify(notice);
    }
  });
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
      // The tray's menu takes the keyboard while it is open, so the shelf is never in front then: Hide goes by what is on screen.
      case "toggleShelf": {
        if (shelf.isVisible()) {
          shelf.hide();
        } else {
          void showShelf({ dock: isMac });
        }

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

      case "showShortcuts": {
        void commandShelf({ kind: "shortcuts" });
        break;
      }

      case "checkForUpdates": {
        updater.check();
        break;
      }

      case "restartToUpdate": {
        updater.restart();
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
          update: updater.state(),
          version: app.getVersion(),
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
    picker.load(),
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

  updater.start();
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

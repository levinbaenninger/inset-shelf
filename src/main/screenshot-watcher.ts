import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";

import { app, clipboard, nativeImage } from "electron";
import type { NativeImage } from "electron";
import { z } from "zod";

import { isScreenshotClipboard } from "./screenshot-clipboard";

/**
 * Prints the clipboard's types, as JSON, each time it changes; it stops on
 * its own once Inset Shelf is gone (its parent becomes launchd).
 */
const CLIPBOARD_SCRIPT = `
ObjC.import("AppKit");
ObjC.bindFunction("getppid", ["int", []]);
function run() {
  var board = $.NSPasteboard.generalPasteboard;
  var out = $.NSFileHandle.fileHandleWithStandardOutput;
  var last = board.changeCount;
  while ($.getppid() !== 1) {
    delay(0.3);
    var count = board.changeCount;
    if (count !== last) {
      last = count;
      // Each item's own types: the board's list adds converted and legacy names.
      var items = board.pasteboardItems.js;
      var types = [];
      for (var i = 0; i < items.length; i++) types = types.concat(ObjC.deepUnwrap(items[i].types) || []);
      out.writeData($(JSON.stringify(types) + "\\n").dataUsingEncoding($.NSUTF8StringEncoding));
    }
  }
}
`;

const IMAGE_FILE = /\.(?:png|jpe?g|heic|tiff?)$/iu;

/** A file only just written, not one renamed or touched long after. */
const FRESH_MS = 15_000;

/** macOS marks its screenshots, whatever their name in the user's language. */
const SCREEN_CAPTURE_MARK = "com.apple.metadata:kMDItemIsScreenCapture";

/** Windows reports a file as it is made, before it is written; it is read again until it decodes. */
const LOAD_ATTEMPTS = 20;
const LOAD_RETRY_MS = 150;

/** Windows makes the Screenshots folder with the first screenshot saved; until then it is looked for again. */
const FOLDER_RETRY_MS = 60_000;

const isMac = process.platform === "darwin";

/** The Screenshots folder's entry among the user's folders, where Snipping Tool and Win+PrtScn save. */
const WINDOWS_FOLDERS =
  "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders";

const WINDOWS_SCREENSHOTS = "{B7BEDE81-DF94-4682-A7D8-57A52620B86F}";

/** Prints the folder in UTF-8 with its %USERPROFILE% expanded, or nothing when the entry is missing. */
const WINDOWS_FOLDER_SCRIPT = `[Console]::OutputEncoding = [Text.Encoding]::UTF8; (Get-ItemProperty -Path '${WINDOWS_FOLDERS}' -Name '${WINDOWS_SCREENSHOTS}' -ErrorAction SilentlyContinue).'${WINDOWS_SCREENSHOTS}'`;

const run = async (
  command: string,
  args: readonly string[]
): Promise<string> => {
  try {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });

    child.stdout.setEncoding("utf-8");

    let output = "";

    for await (const chunk of child.stdout) {
      output += String(chunk);
    }

    return output.trim();
  } catch {
    return "";
  }
};

const screenshotSetting = async (key: string): Promise<string> =>
  await run("/usr/bin/defaults", ["read", "com.apple.screencapture", key]);

/** Where macOS saves screenshots as files, or null when they go to the clipboard. */
const macScreenshotFolder = async (): Promise<string | null> => {
  const target = await screenshotSetting("target");

  if (target !== "" && target !== "file") {
    return null;
  }

  const location = await screenshotSetting("location");

  if (location === "") {
    return path.join(homedir(), "Desktop");
  }

  return location.startsWith("~")
    ? path.join(homedir(), location.slice(1))
    : location;
};

/** Where Windows saves screenshots, wherever the user moved the Screenshots folder. */
const windowsScreenshotFolder = async (): Promise<string> => {
  const folder = await run(
    path.join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe"
    ),
    ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_FOLDER_SCRIPT]
  );

  return folder === ""
    ? path.join(app.getPath("pictures"), "Screenshots")
    : folder;
};

const screenshotFolder = async (): Promise<string | null> =>
  isMac ? await macScreenshotFolder() : await windowsScreenshotFolder();

/** The image in a file once it decodes, or null when it never does. */
const loadWritten = async (
  file: string,
  attempts: number
): Promise<NativeImage | null> => {
  const image = nativeImage.createFromPath(file);

  if (!image.isEmpty()) {
    return image;
  }

  if (attempts <= 1) {
    return null;
  }

  await sleep(LOAD_RETRY_MS);

  return await loadWritten(file, attempts - 1);
};

/** The PNG on the clipboard as an image, or null. */
const readClipboardImage = async (): Promise<NativeImage | null> => {
  try {
    const items = await clipboard.read();

    const item = items.find((candidate) =>
      candidate.types.includes("image/png")
    );

    if (item === undefined) {
      return null;
    }

    const blob = await item.getType("image/png");

    const image = nativeImage.createFromBuffer(
      Buffer.from(await blob.arrayBuffer())
    );

    return image.isEmpty() ? null : image;
  } catch {
    return null;
  }
};

const isScreenCapture = async (file: string): Promise<boolean> => {
  const attributes = await run("/usr/bin/xattr", [file]);

  return attributes.split("\n").includes(SCREEN_CAPTURE_MARK);
};

/** One line from the clipboard watcher: the clipboard's types. */
const TypesSchema = z.array(z.string());

const parseTypes = (line: string): readonly string[] | null => {
  try {
    const parsed = TypesSchema.safeParse(JSON.parse(line));

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

export interface ScreenshotWatcher {
  readonly start: () => void;
  readonly stop: () => void;
  /** The app is about to write the clipboard itself; that change is no screenshot. */
  readonly ignoreClipboard: () => void;
}

const IGNORE_MS = 1500;

/** A new screenshot in the file, or null for any other file. */
const readScreenshotFile = async (
  file: string
): Promise<NativeImage | null> => {
  try {
    const info = await stat(file);

    if (!info.isFile() || Date.now() - info.birthtimeMs > FRESH_MS) {
      return null;
    }
  } catch {
    return null;
  }

  // On Windows every image in the Screenshots folder is one.
  if (isMac && !(await isScreenCapture(file))) {
    return null;
  }

  return await loadWritten(file, isMac ? 1 : LOAD_ATTEMPTS);
};

/**
 * Notices new screenshots. On macOS: copied to the clipboard (as macOS does
 * when screenshots go there) or saved to the screenshot folder. On Windows:
 * saved to the Screenshots folder, as Snipping Tool (Win+Shift+S) and
 * Win+PrtScn do unless told not to.
 */
export const createScreenshotWatcher = (
  onScreenshot: (image: NativeImage, file: string | null) => void
): ScreenshotWatcher => {
  let running = false;
  let child: ChildProcess | null = null;
  let folder: FSWatcher | null = null;
  let retry: NodeJS.Timeout | undefined;
  let ignoreUntil = 0;
  // Files shown, and files being read: Windows reports one file several times.
  const seen = new Set<string>();
  const reading = new Set<string>();

  const onClipboard = async (line: string): Promise<void> => {
    const types = parseTypes(line);

    if (
      Date.now() < ignoreUntil ||
      types === null ||
      !isScreenshotClipboard(types)
    ) {
      return;
    }

    const image = await readClipboardImage();

    if (image !== null) {
      onScreenshot(image, null);
    }
  };

  const onFile = async (dir: string, name: string): Promise<void> => {
    const file = path.join(dir, name);

    if (
      name.startsWith(".") ||
      !IMAGE_FILE.test(name) ||
      seen.has(file) ||
      reading.has(file)
    ) {
      return;
    }

    reading.add(file);

    try {
      const image = await readScreenshotFile(file);

      if (image !== null && running) {
        seen.add(file);
        onScreenshot(image, file);
      }
    } finally {
      reading.delete(file);
    }
  };

  const watchFolder = async (): Promise<void> => {
    const dir = await screenshotFolder();

    if (dir === null || !running) {
      return;
    }

    try {
      folder = watch(dir, (_event, name) => {
        if (name !== null) {
          void onFile(dir, name);
        }
      });
      folder.on("error", () => {
        folder?.close();
        folder = null;
      });
    } catch {
      // No access to the folder (macOS asks once for Desktop and Documents): only the clipboard is watched.
      // On Windows the folder may not be there yet.
      folder = null;

      if (!isMac) {
        retry = setTimeout(() => {
          void watchFolder();
        }, FOLDER_RETRY_MS);
      }
    }
  };

  const watchClipboard = (): void => {
    child = spawn(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", CLIPBOARD_SCRIPT],
      { stdio: ["ignore", "pipe", "ignore"] }
    );
    child.on("exit", () => {
      child = null;
    });

    if (child.stdout !== null) {
      createInterface({ input: child.stdout }).on("line", (line) => {
        void onClipboard(line);
      });
    }
  };

  return {
    ignoreClipboard: () => {
      ignoreUntil = Date.now() + IGNORE_MS;
    },
    start: () => {
      if (
        running ||
        (process.platform !== "darwin" && process.platform !== "win32")
      ) {
        return;
      }

      running = true;

      if (isMac) {
        watchClipboard();
      }

      void watchFolder();
    },
    stop: () => {
      running = false;
      clearTimeout(retry);
      child?.kill();
      child = null;
      folder?.close();
      folder = null;
    },
  };
};

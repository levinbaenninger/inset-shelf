import { execFileSync, spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { z } from "zod";

import { SHELF_MAX_HEIGHT_DIP } from "../../src/shared/geometry.ts";
import { ShelfDocSchema } from "../../src/shared/shelf.ts";
import type { ShelfDoc } from "../../src/shared/shelf.ts";

// Drives Inset Shelf on the real macOS desktop: real Shift taps, real clicks
// and drags, the real clipboard. Keys are only sent while the test's own
// source app is in front.

const root = path.resolve(import.meta.dirname, "../..");
const mode = process.argv[2] === "packaged" ? "packaged" : "dev";

const packagedApp = path.join(
  root,
  "release/mac-arm64/Inset Shelf.app/Contents/MacOS/Inset Shelf"
);

const processName = mode === "packaged" ? "Inset Shelf" : "Electron";

// The Quit item names the bundle: Electron in dev.
const quitLabel = `Quit ${processName}`;
const work = mkdtempSync(path.join(tmpdir(), "inset-shelf-e2e-"));
const bin = path.join(work, "bin");
const userData = path.join(work, "userData");
const logFile = path.join(work, "events.jsonl");
const sourceBundleId = "ch.inset.e2e.source";
const sourceApp = path.join(bin, "source.app");
const CLIPBOARD_SENTINEL = "inset-shelf-e2e-clipboard";

const EventSchema = z.object({
  bounds: z
    .object({
      height: z.number(),
      width: z.number(),
      x: z.number(),
      y: z.number(),
    })
    .optional(),
  event: z.string(),
  itemId: z.string().optional(),
  kind: z.string().optional(),
  restored: z.boolean().optional(),
  t: z.number(),
  text: z.string().optional(),
  via: z.string().optional(),
  windows: z.number(),
});

type AppEvent = z.infer<typeof EventSchema>;

const WindowSchema = z.object({
  height: z.number(),
  layer: z.number(),
  owner: z.string(),
  width: z.number(),
  x: z.number(),
  y: z.number(),
});

interface Result {
  readonly check: string;
  readonly ok: boolean;
  readonly detail: string;
}

const results: Result[] = [];

const record = (check: string, ok: boolean, detail = ""): void => {
  results.push({ check, detail, ok });
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${check}${detail === "" ? "" : `  (${detail})`}`
  );
};

const osa = (...lines: string[]): string =>
  execFileSync(
    "osascript",
    lines.flatMap((line) => ["-e", line]),
    {
      encoding: "utf-8",
    }
  ).trim();

const jxa = (source: string): string =>
  execFileSync("osascript", ["-l", "JavaScript", "-e", source], {
    encoding: "utf-8",
  }).trim();

const frontmost = (): string =>
  osa(
    'tell application "System Events" to get name of first process whose frontmost is true'
  );

const input = (...args: string[]): void => {
  execFileSync(path.join(bin, "input"), args);
};

const pbcopy = (text: string): void => {
  execFileSync("pbcopy", { input: text });
};

const pbpaste = (): string => execFileSync("pbpaste", { encoding: "utf-8" });

const events = (): AppEvent[] =>
  existsSync(logFile)
    ? readFileSync(logFile, "utf-8")
        .split("\n")
        .filter(Boolean)
        .map((line) => EventSchema.parse(JSON.parse(line)))
    : [];

const waitFor = async (
  name: string,
  after: number,
  deadline = Date.now() + 8000
): Promise<AppEvent | undefined> => {
  const hit = events()
    .slice(after)
    .find((event) => event.event === name);

  if (hit !== undefined || Date.now() > deadline) {
    return hit;
  }

  await delay(100);

  return await waitFor(name, after, deadline);
};

const shelfDoc = (): ShelfDoc | null => {
  const file = path.join(userData, "shelf.json");

  return existsSync(file)
    ? ShelfDocSchema.parse(JSON.parse(readFileSync(file, "utf-8")))
    : null;
};

const windows = () =>
  execFileSync(path.join(bin, "windows"), { encoding: "utf-8" })
    .split("\n")
    .filter(Boolean)
    .map((line) => WindowSchema.parse(JSON.parse(line)));

const processElements = `Application("System Events").processes.byName(${JSON.stringify(processName)}).windows().flatMap((w) => w.entireContents())`;

/** Chromium exposes web content to accessibility clients only after this is set; setting it again rebuilds the tree, so once per launch. */
let webAccessibility = false;

const enableWebAccessibility = (): void => {
  if (webAccessibility) {
    return;
  }

  webAccessibility = true;
  jxa(`const p = Application("System Events").processes.byName(${JSON.stringify(processName)});
    try { p.attributes.byName("AXManualAccessibility").value = true; } catch {}
    "ok";`);
};

/** The last match: lists add new items at the bottom, where the shelf keeps the view. */
const elementCentre = (role: string, name: string): string =>
  jxa(`const hit = ${processElements}.findLast((e) => {
      try { return e.role() === ${JSON.stringify(role)} && (e.name() === ${JSON.stringify(name)} || e.description() === ${JSON.stringify(name)}); } catch { return false; }
    });
    hit ? (() => { const [x, y] = hit.position(); const [w, h] = hit.size(); return Math.round(x + w / 2) + " " + Math.round(y + h / 2); })() : "";`);

const clickElement = async (
  role: string,
  name: string,
  attempts = 10
): Promise<boolean> => {
  const found = elementCentre(role, name);

  if (found !== "") {
    const [x = "0", y = "0"] = found.split(" ");

    input("click", x, y);

    return true;
  }

  if (attempts <= 1) {
    return false;
  }

  await delay(500);

  return await clickElement(role, name, attempts - 1);
};

const isFocused = (role: string, name: string): boolean =>
  jxa(`const hit = ${processElements}.findLast((e) => {
      try { return e.role() === ${JSON.stringify(role)} && (e.name() === ${JSON.stringify(name)} || e.description() === ${JSON.stringify(name)}); } catch { return false; }
    });
    hit ? String(hit.focused()) : "false";`) === "true";

/** Typing before the field has focus would send the keys to the app in front instead. */
const waitForFocus = async (
  role: string,
  name: string,
  attempts = 10
): Promise<boolean> => {
  if (isFocused(role, name)) {
    return true;
  }

  if (attempts <= 1) {
    return false;
  }

  await delay(200);

  return await waitForFocus(role, name, attempts - 1);
};

const windowText = (): string =>
  jxa(`${processElements}.map((e) => {
      try { return String(e.value() ?? "") + " " + String(e.name() ?? ""); } catch { return ""; }
    }).join(" ")`);

/** The tree fills in after a window first shows, so a missing text is retried for a few seconds. */
const windowShows = async (text: string, attempts = 10): Promise<boolean> => {
  if (windowText().includes(text)) {
    return true;
  }

  if (attempts <= 1) {
    return false;
  }

  await delay(500);

  return await windowShows(text, attempts - 1);
};

const trayItem = (item: string): void => {
  osa(
    `tell application "System Events" to tell process "${processName}" to click menu bar item 1 of menu bar 2`,
    "delay 0.4",
    `tell application "System Events" to tell process "${processName}" to click menu item "${item}" of menu 1 of menu bar item 1 of menu bar 2`
  );
};

/** Opens the shelf from the tray unless it is on screen already. */
const showShelfFromTray = (): void => {
  const open = windows().some(
    (window) => window.owner === processName && window.width >= 300
  );

  if (!open) {
    trayItem("Show Inset Shelf");
  }
};

let source: ChildProcess | undefined;

/** A just-launched app answers Cmd+C only once its text view has keyboard focus. */
const sourceReady = async (attempts = 15): Promise<boolean> => {
  const ready =
    frontmost() === "source" &&
    // macOS may add a small helper window, so every window of the app is searched.
    jxa(`const area = Application("System Events").processes.byName("source").windows().flatMap((w) => w.entireContents()).find((e) => { try { return e.role() === "AXTextArea"; } catch { return false; } });
      area ? String(area.focused()) : "false";`) === "true";

  if (ready || attempts <= 1) {
    return ready;
  }

  await delay(200);

  return await sourceReady(attempts - 1);
};

const stopSource = (): void => {
  source?.kill("SIGKILL");
  source = undefined;
};

/** Opens the source app in front with this text, all of it selected or none. */
const showSource = async (
  text: string,
  selection: "all" | "none"
): Promise<boolean> => {
  stopSource();
  source = spawn(
    path.join(sourceApp, "Contents/MacOS/source"),
    [text, selection],
    {
      stdio: "ignore",
    }
  );
  await delay(1200);
  osa(`tell application id "${sourceBundleId}" to activate`);
  await delay(300);

  // A click on the title bar makes the window key, as a person would, without touching the selection.
  const [x = "0", y = "0"] = osa(
    'tell application "System Events" to get position of window 1 of process "source"'
  ).split(", ");

  input("click", String(Number(x) + 120), String(Number(y) + 12));

  return await sourceReady();
};

/** Keys go out only while the test's own source app, or the app under test, is in front. */
const guardedKeys = (
  send: () => void,
  allowed: readonly string[] = ["source"]
): boolean => {
  const front = frontmost();

  if (!allowed.includes(front)) {
    console.log(`  skipped keys: ${front} is in front`);

    return false;
  }

  send();

  return true;
};

const typeIntoShelf = (text: string): boolean =>
  guardedKeys(() => {
    osa(
      `tell application "System Events" to keystroke ${JSON.stringify(text)}`
    );
    osa('tell application "System Events" to key code 36');
  }, ["source", processName]);

const swift = (name: string, out: string): void => {
  execFileSync("swiftc", [
    "-O",
    path.join(root, "scripts/e2e", `${name}.swift`),
    "-o",
    out,
  ]);
};

const buildHelpers = (): void => {
  mkdirSync(path.join(sourceApp, "Contents/MacOS"), { recursive: true });
  writeFileSync(
    path.join(sourceApp, "Contents/Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${sourceBundleId}</string><key>CFBundleExecutable</key><string>source</string><key>CFBundleName</key><string>source</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`
  );

  swift("input", path.join(bin, "input"));
  swift("windows", path.join(bin, "windows"));
  swift("source", path.join(sourceApp, "Contents/MacOS/source"));
};

const launch = (env: Record<string, string> = {}): ChildProcess => {
  webAccessibility = false;

  const command =
    mode === "packaged"
      ? packagedApp
      : path.join(root, "node_modules/.bin/electron");

  const args =
    mode === "packaged" ? [] : [path.join(root, "out/main/index.js")];

  return spawn(command, args, {
    env: {
      ...process.env,
      ...env,
      INSET_E2E_LOG: logFile,
      INSET_USER_DATA_DIR: userData,
    },
    stdio: "ignore",
  });
};

const exited = async (app: ChildProcess): Promise<boolean> => {
  if (app.exitCode !== null) {
    return true;
  }

  await Promise.race([once(app, "exit"), delay(8000)]);

  return app.exitCode !== null || app.signalCode !== null;
};

const assertNoRunningInstance = (): void => {
  const found = spawnSync(
    "pgrep",
    [
      "-fl",
      mode === "packaged"
        ? "Inset Shelf.app/Contents/MacOS/Inset Shelf$"
        : "Electron.*out/main/index.js",
    ],
    {
      encoding: "utf-8",
    }
  ).stdout.trim();

  if (found !== "") {
    throw new Error(`stop the running instance first:\n${found}`);
  }
};

const items = (): ShelfDoc["items"] => shelfDoc()?.items ?? [];

const checkLaunch = async (): Promise<void> => {
  const launched = await waitFor("launch", 0, Date.now() + 15_000);
  const shown = await waitFor("shelfShown", 0);
  const keys = events().some((event) => event.event === "keysReady");

  record(
    "launch opens the shelf",
    launched !== undefined && shown !== undefined
  );
  record("double Shift is listening", keys);
};

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const sourceBounds = (): Box => {
  const [x = 0, y = 0, width = 0, height = 0] = osa(
    'tell application "System Events" to get {position, size} of window 1 of process "source"'
  )
    .split(", ")
    .map(Number);

  return { height, width, x, y };
};

const checkShelfStaysInFront = async (): Promise<void> => {
  trayItem("Hide Inset Shelf");
  await waitFor("shelfHidden", 0);
  await showSource("A window from another app", "none");

  const target = sourceBounds();
  const mark = events().length;

  trayItem("Show Inset Shelf");

  const shown = await waitFor("shelfShown", mark);
  const bounds = shown?.bounds;

  record("tray opens the shelf", shown !== undefined, JSON.stringify(bounds));
  const height = Math.min(target.height, SHELF_MAX_HEIGHT_DIP);

  record(
    "the shelf docks beside the window in front, centred on its height",
    bounds !== undefined &&
      bounds.x === target.x + target.width + 8 &&
      Math.abs(bounds.y - (target.y + (target.height - height) / 2)) <= 1 &&
      bounds.height === height,
    `window ${JSON.stringify(target)}`
  );
  await delay(500);

  const menus = osa(
    `tell application "System Events" to get name of every menu bar item of menu bar 1 of process "${processName}"`
  );

  record(
    "the app has a regular menu bar",
    ["File", "Edit", "View", "Window", "Help"].every((name) =>
      menus.includes(name)
    ),
    menus
  );

  // Back to the other app with a click, as a person would.
  input("click", String(target.x + 120), String(target.y + 12));
  await delay(600);

  const list = windows();

  const shelf = list.find(
    (window) => window.owner === processName && window.width >= 300
  );

  const other = list.find((window) => window.owner === "source");

  record(
    "shelf stays visible when another app comes to the front",
    frontmost() === "source" &&
      shelf !== undefined &&
      !events()
        .slice(mark)
        .some((event) => event.event === "shelfHidden"),
    frontmost()
  );
  record(
    "shelf floats above normal windows",
    shelf !== undefined && other !== undefined && shelf.layer > other.layer,
    `shelf layer ${shelf?.layer}, other ${other?.layer}`
  );
};

const checkComposer = async (): Promise<void> => {
  enableWebAccessibility();

  const clicked = await clickElement("AXTextArea", "New note in Inbox");

  record("note field found", clicked);
  record(
    "clicking the note field focuses it",
    await waitForFocus("AXTextArea", "New note in Inbox")
  );
  typeIntoShelf("Ask about step four");
  await delay(800);
  record(
    "Return adds a typed note",
    items().some(
      (item) =>
        item.kind === "text" &&
        item.text === "Ask about step four" &&
        item.via === "typed"
    )
  );
  typeIntoShelf("# Prompts");
  await delay(800);

  const doc = shelfDoc();
  const prompts = doc?.sections.find((section) => section.name === "Prompts");

  record(
    "# Prompts makes the section active",
    prompts !== undefined && doc?.activeSectionId === prompts.id
  );
  typeIntoShelf("# Inbox");
  await delay(600);
};

const checkSelection = async (): Promise<void> => {
  const text = "Selected sentence for the shelf";

  if (!(await showSource(text, "all"))) {
    record("source app in front for the selection", false, frontmost());

    return;
  }

  pbcopy(CLIPBOARD_SENTINEL);

  const mark = events().length;

  guardedKeys(() => {
    input("double-shift");
  });

  const added = await waitFor("itemAdded", mark);

  record(
    "double Shift saves the selection",
    added?.via === "selection" &&
      items().some((item) => item.kind === "text" && item.text === text)
  );

  const saved = items().find(
    (item) => item.kind === "text" && item.text === text
  );

  record(
    "the selection keeps the app and window it came from",
    saved?.context?.app === "source" && saved.context.title === "Source",
    JSON.stringify(saved?.context ?? null)
  );
  record(
    "the clipboard is put back",
    pbpaste() === CLIPBOARD_SENTINEL,
    pbpaste().slice(0, 40)
  );

  const right = events().length;

  guardedKeys(() => {
    input("double-shift", "right");
  });
  record(
    "right Shift works the same",
    (await waitFor("selection", right)) !== undefined
  );
};

const checkNoFalseTaps = async (): Promise<void> => {
  await showSource("", "none");

  const mark = events().length;

  guardedKeys(() => {
    input("capitals");
  });
  await delay(800);
  record(
    "typing capitals is not a double Shift",
    !events()
      .slice(mark)
      .some((event) => event.event === "doubleTap")
  );
};

const checkToggle = async (): Promise<void> => {
  await showSource("Nothing selected here", "none");

  const before = events().length;

  guardedKeys(() => {
    input("double-shift");
  });
  const shown = await waitFor("shelfShown", before, Date.now() + 4000);

  const toggled =
    shown !== undefined ||
    events()
      .slice(before)
      .some((event) => event.event === "shelfHidden");

  record("double Shift with nothing selected toggles the shelf", toggled);
  record(
    "nothing selected adds no item",
    !events()
      .slice(before)
      .some((event) => event.event === "itemAdded")
  );
};

const ownWindow = (width: number, height: number) =>
  windows().find(
    (window) =>
      window.owner === processName &&
      window.width === width &&
      window.height === height
  );

const menuItem = (menu: string, item: string): void => {
  osa(
    `tell application "System Events" to tell process "${processName}" to click menu item "${item}" of menu "${menu}" of menu bar 1`
  );
};

/** Finds the typed note with search, selects it, then copies it with Edit › Copy from the menu bar. */
const checkCopy = async (): Promise<void> => {
  enableWebAccessibility();
  showShelfFromTray();
  pbcopy(CLIPBOARD_SENTINEL);
  await clickElement("AXTextField", "Search the shelf");
  await delay(300);
  guardedKeys(() => {
    osa('tell application "System Events" to keystroke "step four"');
  }, ["source", processName]);
  await delay(500);

  const found = await windowShows("Ask about step four");
  const others = windowText().includes("Progress indicator");

  record("search narrows the list to matching items", found && !others);

  const mark = events().length;
  const selected = await clickElement("AXButton", "Ask about step four");

  await delay(400);
  osa(
    `tell application "System Events" to tell process "${processName}" to click menu item "Copy" of menu "Edit" of menu bar 1`
  );

  const copied = await waitFor("copied", mark);

  record(
    "Edit › Copy puts the selected item on the clipboard",
    selected && copied !== undefined && pbpaste() === "Ask about step four",
    pbpaste().slice(0, 40)
  );
};

const checkDrawing = async (): Promise<void> => {
  const mark = events().length;

  menuItem("File", "New Drawing…");
  await delay(1000);

  const editor = ownWindow(760, 560);

  record(
    "File › New Drawing opens the editor above the shelf",
    editor !== undefined && editor.layer > 3,
    JSON.stringify(editor ?? null)
  );

  if (editor === undefined || frontmost() !== processName) {
    return;
  }

  input(
    "drag",
    String(editor.x + 200),
    String(editor.y + 200),
    String(editor.x + 420),
    String(editor.y + 320)
  );
  await delay(300);
  guardedKeys(() => {
    osa('tell application "System Events" to key code 36 using command down');
  }, [processName]);

  const added = await waitFor("itemAdded", mark);

  record(
    "⌘↩ saves the drawing into the shelf",
    added?.via === "drawing" &&
      items().some((item) => item.id === added.itemId),
    added?.via ?? "nothing added"
  );
  record("the editor closes after saving", ownWindow(760, 560) === undefined);
};

/** The settings window's width (src/main/settings-window.ts). */
const SETTINGS_WIDTH = 420;

const checkSettings = async (): Promise<void> => {
  osa(
    `tell application "System Events" to tell process "${processName}" to click menu item "Settings…" of menu 1 of menu bar item 2 of menu bar 1`
  );
  await delay(1000);

  const settings = windows().find(
    (window) => window.owner === processName && window.width === SETTINGS_WIDTH
  );

  record(
    "Settings… opens the settings window above the shelf",
    settings !== undefined && settings.layer > 3,
    JSON.stringify(settings ?? null)
  );
  guardedKeys(() => {
    osa('tell application "System Events" to keystroke "w" using command down');
  }, [processName]);
  await delay(600);

  const own = windows().filter((window) => window.owner === processName);

  record(
    "⌘W closes Settings and leaves the shelf open",
    own.every((window) => window.width !== SETTINGS_WIDTH) &&
      own.some((window) => window.width === 340),
    own.map((window) => `${window.width}x${window.height}`).join(", ")
  );
};

const checkRestart = async (app: ChildProcess): Promise<ChildProcess> => {
  const before = items().length;

  trayItem(quitLabel);
  const quit = await exited(app);

  record(
    "tray Quit exits",
    quit,
    quit
      ? ""
      : spawnSync("pgrep", ["-fl", "out/main/index.js|Inset Shelf.app"], {
          encoding: "utf-8",
        }).stdout.trim()
  );

  const next = launch({ INSET_FAIL_NEXT_WRITE: "1" });

  await waitFor("launch", events().length, Date.now() + 15_000);
  await delay(800);
  record(
    "items survive a restart",
    items().length === before,
    `${items().length} of ${before}`
  );

  return next;
};

const checkFailedWrite = async (): Promise<void> => {
  if (!(await showSource("Saved after a failed write", "all"))) {
    record("source app in front for the failed write", false, frontmost());

    return;
  }

  const before = items().length;

  guardedKeys(() => {
    input("double-shift");
  });
  await delay(1500);
  enableWebAccessibility();
  showShelfFromTray();
  await delay(800);
  record(
    "a failed write is shown",
    await windowShows("Not saved to disk"),
    "banner"
  );
  record(
    "the item stays in the shelf meanwhile",
    await windowShows("Saved after a failed write")
  );
  record(
    "the failed write leaves the file as it was",
    items().length === before
  );
};

const main = async (): Promise<void> => {
  if (process.platform !== "darwin") {
    throw new Error("This test drives the macOS desktop.");
  }

  assertNoRunningInstance();

  if (mode === "dev") {
    execFileSync("pnpm", ["build"], { cwd: root, stdio: "ignore" });
  }

  mkdirSync(bin, { recursive: true });
  buildHelpers();

  const clipboardBefore = pbpaste();
  let app = launch();

  try {
    await checkLaunch();
    await checkShelfStaysInFront();
    await checkComposer();
    await checkSelection();
    await checkNoFalseTaps();
    await checkToggle();
    await checkCopy();
    await checkDrawing();
    await checkSettings();
    app = await checkRestart(app);
    await checkFailedWrite();
  } finally {
    stopSource();
    trayItem(quitLabel);
    await exited(app);
    pbcopy(clipboardBefore);
  }

  writeFileSync(
    path.join(work, "results.json"),
    JSON.stringify({ events: events(), mode, results }, null, 2)
  );
  console.log(
    `\n${results.filter((result) => result.ok).length}/${results.length} passed. Artifacts: ${work}`
  );
  process.exitCode = results.every((result) => result.ok) ? 0 : 1;
};

await main();

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

// Drives Inset Shelf on the real macOS desktop: real Shift taps, real clicks
// and drags, the real clipboard. Keys are only sent while the test's own
// source app is in front.

const root = path.resolve(import.meta.dirname, "../..");
const mode = process.argv[2] === "packaged" ? "packaged" : "dev";

/** `reopen`, `say-why`, `say-why-failed` or `recall` runs only that trial (README.md, Testing). */
const only = process.argv[3] ?? "";

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
  count: z.number().optional(),
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

/**
 * The parts of shelf.json the checks read. Its own schema: src/shared/shelf.ts
 * imports its neighbours without a file extension, which Node can't load.
 */
const ShelfFileSchema = z.looseObject({
  activeSectionId: z.string(),
  items: z.array(
    z.looseObject({
      context: z
        .looseObject({
          app: z.string().nullable(),
          title: z.string().nullable(),
        })
        .nullable()
        .optional(),
      description: z.string().optional(),
      done: z.boolean(),
      id: z.string(),
      kind: z.string(),
      text: z.string().optional(),
      via: z.string().optional(),
    })
  ),
  sections: z.array(z.looseObject({ id: z.string(), name: z.string() })),
});

type ShelfDoc = z.infer<typeof ShelfFileSchema>;

const shelfDoc = (): ShelfDoc | null => {
  const file = path.join(userData, "shelf.json");

  return existsSync(file)
    ? ShelfFileSchema.parse(JSON.parse(readFileSync(file, "utf-8")))
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

/** The tray items that only show or hide the shelf, and the state each leaves. */
const SHELF_TOGGLES: Readonly<Record<string, boolean>> = {
  "Hide Inset Shelf": false,
  "Show Inset Shelf": true,
};

const shelfOnScreen = (): boolean =>
  windows().some(
    (window) => window.owner === processName && window.width >= 300
  );

const trayItem = (item: string): void => {
  try {
    osa(
      `tell application "System Events" to tell process "${processName}" to click menu bar item 1 of menu bar 2`,
      "delay 0.4",
      `tell application "System Events" to tell process "${processName}" to click menu item "${item}" of menu 1 of menu bar item 1 of menu bar 2`
    );
  } catch (error) {
    const visible = SHELF_TOGGLES[item];

    if (visible === undefined) {
      throw error;
    }

    // A menu bar hider or a full menu bar leaves the tray out of reach: the global shortcut shows and hides the shelf too.
    console.log(`  tray out of reach: "${item}" with the shortcut`);

    if (
      shelfOnScreen() !== visible &&
      !guardedKeys(toggleKeys, ["source", processName])
    ) {
      throw error;
    }

    // The shortcut hides only a shelf with the keyboard: the first press on an unfocused one focuses it.
    if (!visible) {
      execFileSync("sleep", ["0.6"]);

      if (shelfOnScreen()) {
        guardedKeys(toggleKeys, ["source", processName]);
      }
    }
  }
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

/**
 * Quits from the tray, else from the app's own menu: the tray's item isn't
 * reachable when macOS hides it in a full menu bar. A quit that reaches
 * neither stops the process, so no test instance is left running.
 */
const quitApp = (app: ChildProcess): void => {
  try {
    trayItem(quitLabel);

    return;
  } catch {
    // The tray's menu bar isn't there: the app menu next.
  }

  try {
    osa(
      `tell application "System Events" to tell process "${processName}" to click menu item "${quitLabel}" of menu 1 of menu bar item 2 of menu bar 1`
    );
  } catch {
    app.kill();
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

/** Opens the source app in front with this text, all of it selected or none, in a window with this title, full screen if asked. */
const showSource = async (
  text: string,
  selection: "all" | "none",
  window: { readonly title?: string; readonly fullScreen?: boolean } = {}
): Promise<boolean> => {
  stopSource();
  source = spawn(
    path.join(sourceApp, "Contents/MacOS/source"),
    [
      text,
      selection,
      window.title ?? "Source",
      ...(window.fullScreen === true ? ["fullscreen"] : []),
    ],
    {
      stdio: "ignore",
    }
  );
  await delay(window.fullScreen === true ? 2500 : 1200);
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

const elementValue = (role: string, name: string): string =>
  jxa(`const hit = ${processElements}.findLast((e) => {
      try { return e.role() === ${JSON.stringify(role)} && (e.name() === ${JSON.stringify(name)} || e.description() === ${JSON.stringify(name)}); } catch { return false; }
    });
    hit ? String(hit.value() ?? "") : "";`);

/** The global shortcut, as a keyboard sends it. */
const toggleKeys = (): void => {
  osa(
    'tell application "System Events" to keystroke "s" using {control down, option down}'
  );
};

/**
 * Hidden with the global shortcut while an item has the keyboard and shown
 * with it again, the shelf opens with the caret in the note field: the next
 * key typed lands there.
 */
const checkReopenCaret = async (): Promise<void> => {
  enableWebAccessibility();

  const note = "Reopen check item";

  showShelfFromTray();
  await clickElement("AXTextArea", "New note in Inbox");
  await waitForFocus("AXTextArea", "New note in Inbox");
  typeIntoShelf(note);
  await delay(800);

  // A click on the item's words gives it the keyboard, as a person reading it would.
  const onItem = await clickElement("AXButton", note);

  await delay(400);
  record(
    "an item has the keyboard before the shelf is hidden",
    onItem && !isFocused("AXTextArea", "New note in Inbox")
  );

  const hiding = events().length;

  guardedKeys(toggleKeys, [processName]);

  const hidden = await waitFor("shelfHidden", hiding);

  await delay(600);

  // The keys go to the shelf's shortcut only from the test's own app.
  if (frontmost() !== "source") {
    await showSource("", "none");
  }

  const showing = events().length;

  guardedKeys(toggleKeys);

  const shown = await waitFor("shelfShown", showing);

  await delay(800);
  guardedKeys(() => {
    osa('tell application "System Events" to keystroke "q"');
  }, [processName]);
  await delay(400);

  const typed = elementValue("AXTextArea", "New note in Inbox");

  record(
    "hidden with the shortcut from an item and shown with it again, the next key lands in the note field",
    hidden !== undefined && shown !== undefined && typed.includes("q"),
    `note field: ${JSON.stringify(typed)}, front: ${frontmost()}`
  );
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

  // Once the capture notice has gone: while it shows, a Double Shift on the same text opens its why field.
  await delay(3000);

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

  let viaTray = true;

  try {
    trayItem(quitLabel);
  } catch {
    // The tray is out of reach: the check fails, and the app quits from its menu so the run goes on.
    viaTray = false;
    quitApp(app);
  }

  const quit = await exited(app);

  record(
    "tray Quit exits",
    viaTray && quit,
    quit
      ? viaTray
        ? ""
        : "the tray is out of reach on this desktop; quit from the app menu"
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

// Files pasted onto the shelf (src/main/index.ts noticeAdded): the notice comes once the disk holds them and names what was refused.

/** A file and a folder on the clipboard, as Finder's Copy puts them there. */
const copyFileAndFolder = () => {
  const file = path.join(work, "Offer 2026-114.pdf");
  const folder = path.join(work, "Quotes");

  writeFileSync(file, "%PDF-1.4\n");
  mkdirSync(folder, { recursive: true });
  jxa(`ObjC.import("AppKit");
    const board = $.NSPasteboard.generalPasteboard;
    board.clearContents;
    board.writeObjects($([$.NSURL.fileURLWithPath(${JSON.stringify(file)}), $.NSURL.fileURLWithPath(${JSON.stringify(folder)})]));
    "";`);

  return { folder: path.basename(folder) };
};

/**
 * Pastes a file and a folder into the shelf. On a good disk the notice says
 * "Added 1 of 2." and names the folder; with `failing` (INSET_FAIL_NEXT_WRITE=1)
 * it says no Added at all, and the banner says the save failed.
 */
const checkAddedNotice = async (failing: boolean): Promise<void> => {
  const { folder } = copyFileAndFolder();
  const before = items().length;

  enableWebAccessibility();
  showShelfFromTray();
  await delay(800);
  menuItem("Edit", "Paste");

  if (failing) {
    record(
      "a paste whose save fails says so",
      await windowShows("Not saved to disk")
    );
    record(
      "a paste whose save fails never says Added",
      !windowText().includes("Added 1")
    );

    return;
  }

  record(
    "pasted files are confirmed once saved, naming the folder refused",
    await windowShows(`Added 1 of 2. ${folder} is a folder, not a file.`)
  );
  record(
    "the file became one item",
    items().length === before + 1,
    `${items().length - before} added`
  );
};

// The screenshot card's save path (src/main/screenshot-saves.ts), on a disk that refuses the first write.

/** A screenshot of a corner of the screen, to the clipboard: the card shows it. */
const takeScreenshot = (): void => {
  execFileSync("screencapture", ["-c", "-x", "-R0,0,320,200"]);
};

/**
 * Run with `INSET_FAIL_NEXT_WRITE=1`: Add to Shelf on the card reads
 * Saving…, the failed write keeps the card with Retry and Copy in view,
 * Retry adds the screenshot once, and the card goes.
 */
const checkScreenshotCard = async (): Promise<void> => {
  const mark = events().length;
  const before = items().length;

  takeScreenshot();
  record(
    "a screenshot shows its card",
    (await waitFor("screenshotShown", mark)) !== undefined
  );
  enableWebAccessibility();

  if (!(await clickElement("AXButton", "Add to Shelf"))) {
    record("the card offers Add to Shelf", false);

    return;
  }

  record("a failed save offers Retry on the card", await windowShows("Retry"));
  record(
    "the failed card keeps Copy and Save to Downloads in view",
    (await windowShows("Copy")) && (await windowShows("Save to Downloads"))
  );
  // The card stays past its usual 12 seconds while it holds a failed save.
  await delay(13_000);
  record("the failed card outlasts its time", await windowShows("Retry", 2));

  const retried = events().length;

  await clickElement("AXButton", "Retry");

  const added = await waitFor("itemAdded", retried);

  await delay(1500);
  record(
    "Retry adds the screenshot once",
    items().length === before + 1,
    `${items().length - before} added${added === undefined ? ", no itemAdded event" : ""}`
  );
  record("the card goes once it is saved", !windowText().includes("Retry"));
};

// Say why (src/shared/pill.ts): a second Double Shift opens a field in the capture notice; Return saves it.

/** What the source app's text view holds now. */
const sourceText = (): string =>
  jxa(`const area = Application("System Events").processes.byName("source").windows().flatMap((w) => w.entireContents()).find((e) => { try { return e.role() === "AXTextArea"; } catch { return false; } });
    area ? String(area.value()) : "";`);

const itemWith = (text: string) =>
  items().filter((item) => item.kind === "text" && item.text === text);

const RETURN = "36";
const ESCAPE = "53";

/**
 * One say-why trial: capture, Double Shift again, type a why and Return,
 * then type into the source. Passes only when the why reached the item and
 * no key leaked either way: none into the source while the field had the
 * keyboard, none into the field after it gave it back.
 */
const sayWhyTrial = async (
  n: number,
  window: { readonly fullScreen?: boolean } = {}
): Promise<string | null> => {
  const text = `Why trial ${n} sentence`;

  if (!(await showSource(text, "all", window))) {
    return `the source app is not in front (${frontmost()})`;
  }

  const mark = events().length;

  guardedKeys(() => {
    input("double-shift");
  });

  if ((await waitFor("itemAdded", mark)) === undefined) {
    return "the capture added no item";
  }

  const second = events().length;

  guardedKeys(() => {
    input("double-shift");
  });

  const opened = await waitFor("whyOpened", second, Date.now() + 3000);

  if (opened === undefined) {
    const fellBack = events()
      .slice(second)
      .some((event) => event.event === "whyFallback");

    return fellBack
      ? "the field didn't get the keyboard: the shelf opened at the description"
      : "the field never opened";
  }

  if (frontmost() !== "source") {
    return `the app in front changed to ${frontmost()}`;
  }

  guardedKeys(() => {
    input("type", "because");
    input("key", RETURN);
  });

  if ((await waitFor("whySaved", second, Date.now() + 3000)) === undefined) {
    return "Return saved nothing";
  }

  await delay(400);

  const [saved, ...duplicates] = itemWith(text);

  if (saved?.description !== "because" || duplicates.length > 0) {
    return `the item holds ${JSON.stringify(saved?.description)}, ${duplicates.length} duplicates`;
  }

  if (sourceText() !== text) {
    return `a key leaked into the source: ${JSON.stringify(sourceText())}`;
  }

  guardedKeys(() => {
    input("type", "x");
  });
  await delay(400);

  if (!sourceText().includes("x")) {
    return `the keyboard didn't come back: the source holds ${JSON.stringify(sourceText())}`;
  }

  return itemWith(text)[0]?.description === "because"
    ? null
    : "a key after Return reached the field";
};

/**
 * Say why on a disk that refuses the why's write (INSET_FAIL_NEXT_WRITE=2:
 * the capture's write lands, the why's fails): Return gives the keyboard
 * back at once, so a key pressed with it reaches the source while the notice
 * offers the words again. A second Double Shift then writes them, once,
 * without opening the field or taking a key.
 */
const checkSayWhyFailed = async (): Promise<void> => {
  await hideShelf();

  const text = "Why trial failing disk sentence";

  if (!(await showSource(text, "all"))) {
    record("say why on a failing disk", false, `front: ${frontmost()}`);

    return;
  }

  const mark = events().length;

  guardedKeys(() => {
    input("double-shift");
  });
  await waitFor("itemAdded", mark);

  const second = events().length;

  guardedKeys(() => {
    input("double-shift");
  });
  await waitFor("whyOpened", second, Date.now() + 3000);
  // The x replaces the selection, so the second Double Shift below copies nothing.
  guardedKeys(() => {
    input("type", "because");
    input("key", RETURN);
    input("type", "x");
  });

  const refused = await waitFor("whyNotSaved", second, Date.now() + 5000);

  await delay(400);
  record(
    "say why: a failed write still gives the keyboard back on Return, and nothing is on disk",
    refused !== undefined &&
      sourceText().includes("x") &&
      itemWith(text)[0]?.description === "",
    JSON.stringify({
      description: itemWith(text)[0]?.description,
      refused: refused !== undefined,
      source: sourceText(),
    })
  );

  // The notice offers the words again: Double Shift takes the offer.
  const third = events().length;

  guardedKeys(() => {
    input("double-shift");
  });

  const saved = await waitFor("whySaved", third, Date.now() + 5000);

  await delay(400);
  guardedKeys(() => {
    input("type", "y");
  });
  await delay(400);
  record(
    "say why: Double Shift after a failed write saves the words once and takes no key",
    saved !== undefined &&
      itemWith(text)[0]?.description === "because" &&
      sourceText().includes("y") &&
      !events()
        .slice(third)
        .some((event) => event.event === "whyOpened"),
    JSON.stringify({
      description: itemWith(text)[0]?.description,
      source: sourceText(),
    })
  );
};

const SAY_WHY_TRIALS = 20;

const checkSayWhy = async (): Promise<void> => {
  // The notice that offers the why field shows only while the shelf is hidden.
  await hideShelf();

  const failures: string[] = [];

  for (let n = 1; n <= SAY_WHY_TRIALS; n += 1) {
    // oxlint-disable-next-line no-await-in-loop -- one trial at a time on the one desktop.
    const failed = await sayWhyTrial(n);

    if (failed !== null) {
      failures.push(`${n}: ${failed}`);
    }
  }

  record(
    `say why: Return saves the why and gives the keyboard back, ${SAY_WHY_TRIALS - failures.length} of ${SAY_WHY_TRIALS}`,
    failures.length === 0,
    failures.join("; ")
  );

  // Esc: the capture stays, nothing is saved, the keyboard comes back.
  const escText = "Why trial Esc sentence";

  if (await showSource(escText, "all")) {
    const mark = events().length;

    guardedKeys(() => {
      input("double-shift");
    });
    await waitFor("itemAdded", mark);

    const second = events().length;

    guardedKeys(() => {
      input("double-shift");
    });
    await waitFor("whyOpened", second, Date.now() + 3000);
    guardedKeys(() => {
      input("type", "nope");
      input("key", ESCAPE);
    });
    await delay(400);
    guardedKeys(() => {
      input("type", "x");
    });
    await delay(400);
    record(
      "say why: Esc saves nothing and gives the keyboard back",
      itemWith(escText)[0]?.description === "" && sourceText().includes("x"),
      JSON.stringify({
        description: itemWith(escText)[0]?.description,
        source: sourceText(),
      })
    );
  }

  // A key pressed right after Return, while the words are written, lands in the source.
  const burstText = "Why trial burst sentence";

  if (await showSource(burstText, "all")) {
    const mark = events().length;

    guardedKeys(() => {
      input("double-shift");
    });
    await waitFor("itemAdded", mark);

    const second = events().length;

    guardedKeys(() => {
      input("double-shift");
    });
    await waitFor("whyOpened", second, Date.now() + 3000);
    guardedKeys(() => {
      input("type", "because");
      input("key", RETURN);
      input("type", "z");
    });
    await waitFor("whySaved", second, Date.now() + 5000);
    await delay(400);
    record(
      "say why: a key pressed with Return reaches the source, and the words are saved",
      sourceText().includes("z") &&
        itemWith(burstText)[0]?.description === "because",
      JSON.stringify({
        description: itemWith(burstText)[0]?.description,
        source: sourceText(),
      })
    );
  }

  // Unused: a capture with no second Double Shift costs nothing.
  const plainText = "Why trial unused sentence";

  if (await showSource(plainText, "all")) {
    const mark = events().length;

    guardedKeys(() => {
      input("double-shift");
    });
    await waitFor("itemAdded", mark);
    await delay(3000);
    guardedKeys(() => {
      input("type", "x");
    });
    await delay(400);
    record(
      "say why: an unused notice takes no key",
      itemWith(plainText)[0]?.description === "" &&
        sourceText().includes("x") &&
        !events()
          .slice(mark)
          .some((event) => event.event === "whyOpened"),
      sourceText()
    );
  }

  // The shelf shown and hidden once leaves the whole app hidden.
  showShelfFromTray();
  await delay(800);
  trayItem("Hide Inset Shelf");
  await delay(800);

  const hidden = await sayWhyTrial(SAY_WHY_TRIALS + 1);

  record(
    "say why: works after the shelf hid the app",
    hidden === null,
    hidden ?? ""
  );

  const fullScreen = await sayWhyTrial(SAY_WHY_TRIALS + 2, {
    fullScreen: true,
  });

  record(
    "say why: works over a full-screen app",
    fullScreen === null,
    fullScreen ?? ""
  );
};

// Context recall (src/shared/recall.ts): a pill when open items came from the window in front.

const RECALL_SECTION = "8d4c6a3e-2f1b-4c5d-9e8f-7a6b5c4d3e21";

const recallItem = (n: number, title: string, done: boolean) => ({
  color: null,
  context: { app: "source", appLink: null, title, url: null },
  createdAt: "2026-11-25T09:00:00.000Z",
  description: "",
  done,
  due: null,
  html: null,
  id: `8d4c6a3e-2f1b-4c5d-9e8f-7a6b5c4d3e${String(30 + n)}`,
  kind: "text",
  links: [],
  sectionId: RECALL_SECTION,
  steps: [],
  text: `${title} item ${n}`,
  via: "selection",
  windows: [],
});

/** One open and one done item from "Recall A", one open item each from "Recall B" and "Recall C". */
const seedRecallShelf = (): void => {
  writeFileSync(
    path.join(userData, "shelf.json"),
    `${JSON.stringify({
      activeSectionId: RECALL_SECTION,
      items: [
        recallItem(1, "Recall A", false),
        recallItem(2, "Recall A", true),
        recallItem(3, "Recall B", false),
        recallItem(4, "Recall C", false),
      ],
      schemaVersion: 3,
      sections: [{ id: RECALL_SECTION, name: "Inbox" }],
    })}\n`
  );
};

const recallsSince = (mark: number) =>
  events()
    .slice(mark)
    .filter((event) => event.event === "recallShown");

/** The value of the shelf's search field, read through accessibility. */
const searchValue = (): string =>
  jxa(`const hit = ${processElements}.findLast((e) => {
      try { return e.role() === "AXTextField" && (e.name() === "Search the shelf" || e.description() === "Search the shelf"); } catch { return false; }
    });
    hit ? String(hit.value()) : "";`);

const hideShelf = async (): Promise<void> => {
  if (
    windows().some(
      (window) => window.owner === processName && window.width >= 300
    )
  ) {
    trayItem("Hide Inset Shelf");
    await delay(800);
  }
};

/** Front-window helper processes (get-windows) that start within `ms`. */
const helpersWithin = async (ms: number): Promise<number> => {
  let seen = 0;

  for (let waited = 0; waited < ms; waited += 200) {
    const found = spawnSync("pgrep", ["-f", "get-windows/main"], {
      encoding: "utf-8",
    }).stdout.trim();

    seen += found === "" ? 0 : 1;
    // oxlint-disable-next-line no-await-in-loop -- sampling the process list over time.
    await delay(200);
  }

  return seen;
};

const checkRecall = async (app: ChildProcess): Promise<ChildProcess> => {
  await hideShelf();
  await showSource("Somewhere else", "none", { title: "Elsewhere" });
  await delay(2000);

  const mark = events().length;

  await showSource("Back where the items came from", "none", {
    title: "Recall A",
  });

  const shown = await waitFor("recallShown", mark, Date.now() + 6000);

  record(
    "recall: bringing the window back shows the pill once, counting open items only",
    shown?.count === 1 && recallsSince(mark).length === 1,
    JSON.stringify(shown ?? null)
  );
  record(
    "recall: the app in front stays in front",
    frontmost() === "source",
    frontmost()
  );

  const pill = ownWindow(260, 44);

  if (pill === undefined) {
    record("recall: the pill's window is on screen", false);
  } else {
    const opened = events().length;

    input(
      "click",
      String(pill.x + pill.width - 80),
      String(pill.y + pill.height / 2)
    );

    const shelf = await waitFor("shelfShown", opened, Date.now() + 4000);

    enableWebAccessibility();
    await delay(800);
    record(
      "recall: a click on the pill opens the shelf filtered to from:here",
      shelf !== undefined && searchValue() === "from:here",
      searchValue()
    );
    await hideShelf();
  }

  const back = events().length;

  await showSource("Somewhere else", "none", { title: "Elsewhere" });
  await delay(2000);
  await showSource("Back again", "none", { title: "Recall A" });
  await delay(3000);
  record(
    "recall: no second pill on a quick return",
    recallsSince(back).length === 0
  );

  const open = events().length;

  showShelfFromTray();
  await delay(800);
  await showSource("With the shelf open", "none", { title: "Recall B" });
  await delay(3000);
  record(
    "recall: no pill while the shelf is open",
    recallsSince(open).length === 0
  );
  await hideShelf();

  // Recall off in the settings file: no pill, and no front-window reads at all.
  quitApp(app);
  await exited(app);
  writeFileSync(
    path.join(userData, "settings.json"),
    `${JSON.stringify({ recall: false })}\n`
  );

  const next = launch();

  await waitFor("launch", events().length, Date.now() + 15_000);
  await delay(1500);
  await hideShelf();

  const off = events().length;

  await showSource("Recall is off", "none", { title: "Recall C" });

  const helpers = await helpersWithin(30_000);

  record(
    "recall: off in the settings, no pill and no front-window reads in 30 s",
    recallsSince(off).length === 0 && helpers === 0,
    `${helpers} samples saw a helper`
  );

  return next;
};

/** Trials that start on a disk refusing one write: the card's and the failed paste's the first, the why's the second (the capture's lands). */
const failingWrite = (trial: string) => {
  if (trial === "card" || trial === "added-failed") {
    return { INSET_FAIL_NEXT_WRITE: "1" };
  }

  return trial === "say-why-failed" ? { INSET_FAIL_NEXT_WRITE: "2" } : {};
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
  // The first-run onboarding is done: the run starts with the shelf, as an installed app does.
  mkdirSync(userData, { recursive: true });
  writeFileSync(
    path.join(userData, "onboarding.json"),
    `${JSON.stringify({ status: "finished", step: { kind: "done" }, version: 2 })}\n`
  );
  // The tutorial is done too: no examples on the shelf, no checklist, no hint over the strokes the test draws.
  writeFileSync(
    path.join(userData, "tutorial.json"),
    `${JSON.stringify({
      celebrated: true,
      checklistClosed: true,
      collapsed: false,
      done: [],
      examples: [],
      examplesSeeded: true,
      seen: [],
      tips: false,
      version: 1,
    })}\n`
  );
  buildHelpers();

  if (only === "recall") {
    seedRecallShelf();
  }

  const clipboardBefore = pbpaste();

  // The card's trial and the failed paste start on a disk that refuses the first write.
  let app = launch(failingWrite(only));

  try {
    await checkLaunch();

    if (only === "reopen") {
      await showSource("", "none");
      await checkReopenCaret();
    } else if (only === "say-why") {
      await checkSayWhy();
    } else if (only === "say-why-failed") {
      await checkSayWhyFailed();
    } else if (only === "recall") {
      app = await checkRecall(app);
    } else if (only === "card") {
      await checkScreenshotCard();
    } else if (only === "added" || only === "added-failed") {
      await checkAddedNotice(only === "added-failed");
    } else {
      await checkShelfStaysInFront();
      await checkComposer();
      await checkSelection();
      await checkSayWhy();
      await checkNoFalseTaps();
      await checkToggle();
      await checkCopy();
      await checkDrawing();
      await checkSettings();
      await checkReopenCaret();
      app = await checkRestart(app);
      await checkFailedWrite();
    }
  } finally {
    stopSource();
    quitApp(app);
    await exited(app);
    // pbcopy("") leaves an empty text item, which the app reads as a held clipboard: clear it instead.
    if (clipboardBefore === "") {
      jxa('ObjC.import("AppKit"); $.NSPasteboard.generalPasteboard.clearContents; ""');
    } else {
      pbcopy(clipboardBefore);
    }
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

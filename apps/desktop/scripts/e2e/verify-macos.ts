import { execFileSync, spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { SHELF_MAX_HEIGHT_DIP } from "../../src/shared/geometry.ts";

// Drives Inset Shelf on the real macOS desktop: real Shift taps, real clicks
// and drags, the real clipboard. Keys are only sent while the test's own
// source app is in front.

const root = path.resolve(import.meta.dirname, "../..");
const mode = process.argv[2] === "packaged" ? "packaged" : "dev";

/** A trial name (`reopen`, `say-why`, `recall`, `card`, `code`, `switch`, …: see `main`) runs only that trial (README.md, Testing). */
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

// The source app lives under the repo, not in the temp folder: Launch Services
// lists an app in a temp folder too, but never opens a scheme with it. Its
// folder is the run's own, straight under release, so removing it leaves nothing.
const sourceHome = path.join(root, "release", path.basename(work));
const sourceApp = path.join(sourceHome, "source.app");

// The scheme the source app opens files by, as an editor does (E2E_EDITORS in src/main/e2e-log.ts).
const sourceScheme = "inset-e2e-source";

// Each address the source app was asked to open, one per line (scripts/e2e/source.swift).
const sourceOpened = path.join(sourceHome, "opened.txt");

const lsregister =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

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
          code: z
            .looseObject({
              file: z.string(),
              line: z.number().nullable(),
              root: z.string().nullable(),
            })
            .nullable()
            .optional(),
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

/** The global shortcut, as a keyboard sends it. */
const toggleKeys = (): void => {
  osa(
    'tell application "System Events" to keystroke "s" using {control down, option down}'
  );
};

/** The tray items that only show or hide the shelf, and the state each leaves. */
const SHELF_TOGGLES = {
  "Hide Inset Shelf": false,
  "Show Inset Shelf": true,
} satisfies Readonly<Record<string, boolean>>;

const shelfOnScreen = (): boolean =>
  windows().some(
    (window) => window.owner === processName && window.width >= 300
  );

/** True when the tray took the click; false when the shelf was shown or hidden with the shortcut instead. */
const trayItem = (item: string): boolean => {
  try {
    osa(
      `tell application "System Events" to tell process "${processName}" to click menu bar item 1 of menu bar 2`,
      "delay 0.4",
      `tell application "System Events" to tell process "${processName}" to click menu item "${item}" of menu 1 of menu bar item 1 of menu bar 2`
    );

    return true;
  } catch (error) {
    const visible = Object.entries(SHELF_TOGGLES).find(
      ([label]) => label === item
    )?.[1];

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

    return false;
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

/** Opens the source app in front with this text, all of it selected or none, in a window with this title, full screen if asked, naming a file if given. */
const showSource = async (
  text: string,
  selection: "all" | "none",
  window: {
    readonly title?: string;
    readonly fullScreen?: boolean;
    readonly document?: string;
  } = {}
): Promise<boolean> => {
  stopSource();
  source = spawn(
    path.join(sourceApp, "Contents/MacOS/source"),
    [
      text,
      selection,
      window.title ?? "Source",
      window.fullScreen === true ? "fullscreen" : "window",
      ...(window.document === undefined ? [] : [window.document]),
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
    `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${sourceBundleId}</string><key>CFBundleExecutable</key><string>source</string><key>CFBundleName</key><string>source</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleURLTypes</key><array><dict><key>CFBundleTypeRole</key><string>Editor</string><key>CFBundleURLName</key><string>${sourceBundleId}</string><key>CFBundleURLSchemes</key><array><string>${sourceScheme}</string></array></dict></array></dict></plist>`
  );

  swift("input", path.join(bin, "input"));
  swift("windows", path.join(bin, "windows"));
  swift("source", path.join(sourceApp, "Contents/MacOS/source"));
  // The scheme counts as registered only once Launch Services knows the bundle; the run's end forgets it.
  execFileSync(lsregister, ["-f", sourceApp]);
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

  const viaTray = trayItem("Show Inset Shelf");

  const shown = await waitFor("shelfShown", mark);
  const bounds = shown?.bounds;

  record(
    "tray opens the shelf",
    viaTray && shown !== undefined,
    viaTray
      ? JSON.stringify(bounds)
      : "the tray is out of reach on this desktop; shown with the shortcut"
  );
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

/**
 * A capture from an editor keeps the file its window names and the project
 * folder its title names, and a window that names no file keeps none
 * (src/shared/code-editors.ts; the source app is an editor under the test).
 * The paths are compared here and never written to the results.
 */
const waitUntil = async (test: () => boolean, ms = 8000): Promise<boolean> => {
  for (let waited = 0; waited < ms; waited += 200) {
    if (test()) {
      return true;
    }

    // oxlint-disable-next-line no-await-in-loop -- polling the disk and the screen.
    await delay(200);
  }

  return test();
};

/** The addresses the source app was asked to open, oldest first. */
const openedInSource = (): readonly string[] =>
  existsSync(sourceOpened)
    ? readFileSync(sourceOpened, "utf-8").split("\n").filter(Boolean)
    : [];

/** The file an address of the source app's scheme names, or null for any other address. */
const fileOfAddress = (address: string): string | null => {
  try {
    const url = new URL(address);

    return url.protocol === `${sourceScheme}:` && url.host === "file"
      ? decodeURIComponent(url.pathname)
      : null;
  } catch {
    return null;
  }
};

/** Clicks the code item's source line, "a.ts · proj", in the shelf: the only button that names the file. */
const clickCodeLine = async (attempts = 10): Promise<boolean> => {
  const found = jxa(`const hit = ${processElements}.findLast((e) => {
      try { return e.role() === "AXButton" && [e.name(), e.description()].some((t) => (t ?? "").includes("a.ts")); } catch { return false; }
    });
    hit ? (() => { const [x, y] = hit.position(); const [w, h] = hit.size(); return Math.round(x + w / 2) + " " + Math.round(y + h / 2); })() : "";`);

  if (found !== "") {
    const [x = "0", y = "0"] = found.split(" ");

    input("click", x, y);

    return true;
  }

  if (attempts <= 1) {
    return false;
  }

  await delay(500);

  return await clickCodeLine(attempts - 1);
};

/**
 * The way back (src/main/open-code.ts): a click on a code item's source line
 * opens its file in the editor it came from, through the address the
 * editor's scheme takes, here the source app's own. A file that is gone
 * opens nothing and brings the editor forward. No other editor is touched.
 */
const checkCodeWayBack = async (file: string): Promise<void> => {
  // Without its scheme the app would show the file in Finder, and leave that window open.
  const handler = jxa(`ObjC.import("AppKit");
    const app = $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL($.NSURL.URLWithString(${JSON.stringify(`${sourceScheme}://file/a`)}));
    app.isNil() ? "" : ObjC.unwrap(app.path);`);

  record(
    "the stand-in editor takes its scheme",
    handler === sourceApp,
    handler === "" ? "no app takes it" : handler
  );

  if (handler !== sourceApp) {
    return;
  }

  enableWebAccessibility();
  rmSync(sourceOpened, { force: true });
  showShelfFromTray();

  const clicked = await clickCodeLine();

  await waitUntil(() => openedInSource().length > 0);

  const asked = openedInSource();

  record("the code item's source line is a button", clicked);
  record(
    "a click on it opens its file in the editor it came from, by the editor's address",
    asked.length === 1 && asked.map(fileOfAddress).every((at) => at === file),
    `${asked.length} address(es)`
  );

  // Gone, and with the editor quit: only the bring-forward can start it again.
  rmSync(file);
  stopSource();
  rmSync(sourceOpened, { force: true });
  await delay(800);
  showShelfFromTray();

  const clickedGone = await clickCodeLine();

  await waitUntil(() => frontmost() === "source", 6000);
  // A wrong open would start the editor too, and its record could land just after.
  await delay(1000);
  record(
    "a file that is gone opens nothing",
    clickedGone && openedInSource().length === 0
  );
  record(
    "and brings its editor forward",
    frontmost() === "source",
    frontmost()
  );

  try {
    osa(`tell application id "${sourceBundleId}" to quit`);
  } catch {
    // Already gone.
  }
};

const checkCodePlace = async (): Promise<void> => {
  // Under the run's own folder in the repo, in the home folder: the only place
  // the shelf looks for a code file (src/main/quiet-disk.ts). The repo must not
  // be in a folder macOS asks about, Documents say.
  const code = path.join(sourceHome, "code");

  mkdirSync(path.join(code, "proj", "src"), { recursive: true });

  const project = path.join(realpathSync(code), "proj");
  const file = path.join(project, "src", "a.ts");

  writeFileSync(file, "export const answer = 42;\n");

  const capture = async (text: string, document?: string) => {
    if (await showSource(text, "all", { document, title: "a.ts — proj" })) {
      const mark = events().length;

      guardedKeys(() => {
        input("double-shift");
      });
      await waitFor("itemAdded", mark);
    } else {
      record("source app in front for the code place", false, frontmost());
    }

    // The event comes with the item in memory; the shelf file is written after it.
    const saved = () =>
      items().find((item) => item.kind === "text" && item.text === text);

    await waitUntil(() => saved() !== undefined, 4000);

    return saved();
  };

  const inFile = await capture("Code place sentence in a file", file);

  record(
    "a capture from an editor keeps the file its window names",
    inFile?.context?.code?.file === file
  );
  record(
    "and the project folder its title names",
    inFile?.context?.code?.root === project
  );
  record("and no line", inFile?.context?.code?.line === null);

  // Once the capture notice has gone, as in checkSelection.
  await delay(3000);

  const noFile = await capture("Code place sentence in no file");

  record(
    "a window that names no file keeps no place in the code",
    noFile?.context?.app === "source" && noFile.context.code === null
  );

  await checkCodeWayBack(file);
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

  const trayNote = viaTray
    ? ""
    : "the tray is out of reach on this desktop; quit from the app menu";

  record(
    "tray Quit exits",
    viaTray && quit,
    quit
      ? trayNote
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

/** A file and a folder on the clipboard, as Finder's Copy puts them there: a file URL each, and the path list beside them. */
const copyFileAndFolder = () => {
  const file = path.join(work, "Offer 2026-114.pdf");
  const folder = path.join(work, "Quotes");

  writeFileSync(file, "%PDF-1.4\n");
  mkdirSync(folder, { recursive: true });
  jxa(`ObjC.import("AppKit");
    const board = $.NSPasteboard.generalPasteboard;
    board.clearContents;
    board.writeObjects($([$.NSURL.fileURLWithPath(${JSON.stringify(file)}), $.NSURL.fileURLWithPath(${JSON.stringify(folder)})]));
    board.setPropertyListForType($([${JSON.stringify(file)}, ${JSON.stringify(folder)}]), "NSFilenamesPboardType");
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

  const confirmed = await windowShows(
    `Added 1 of 2. ${folder} is a folder, not a file.`
  );

  record(
    "pasted files are confirmed once saved, naming the folder refused",
    confirmed,
    // What the app's windows read instead, and how many it had: a missing notice is told from a notice not read.
    confirmed
      ? ""
      : `${windows().filter((window) => window.owner === processName).length} windows; read: ${windowText().replaceAll(/\s+/gu, " ").slice(-400)}`
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

/** Clicks a button inside the screenshot card's window only, not a same-named one in the shelf. */
const clickInCard = async (name: string, attempts = 10): Promise<boolean> => {
  const card = windows().find(
    (window) => window.owner === processName && window.layer === 4
  );

  const found =
    card === undefined
      ? ""
      : jxa(`const card = Application("System Events").processes.byName(${JSON.stringify(processName)}).windows().find((w) => { const [x, y] = w.position(); return x === ${card.x} && y === ${card.y}; });
    const hit = card ? card.entireContents().find((e) => { try { return e.role() === "AXButton" && (e.name() === ${JSON.stringify(name)} || e.description() === ${JSON.stringify(name)}); } catch { return false; } }) : undefined;
    hit ? (() => { const [x, y] = hit.position(); const [w, h] = hit.size(); return Math.round(x + w / 2) + " " + Math.round(y + h / 2); })() : "";`);

  if (found !== "") {
    const [x = "0", y = "0"] = found.split(" ");

    input("click", x, y);

    return true;
  }

  if (attempts <= 1) {
    return false;
  }

  await delay(500);

  return await clickInCard(name, attempts - 1);
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

  // The shelf's failed-write banner has a Retry too: only the card's is pressed here.
  if (!(await clickInCard("Retry"))) {
    record("the failed card's Retry can be pressed", false);

    return;
  }

  const added = await waitFor("itemAdded", retried);

  await delay(1500);
  record(
    "Retry adds the screenshot once",
    items().length === before + 1,
    `${items().length - before} added${added === undefined ? ", no itemAdded event" : ""}`
  );
  record("the card goes once it is saved", !windowText().includes("Retry"));
};

// Seeded shelves for the attachment trials: a v4 doc written before launch.

const SEED_SECTION = "6b1f2a3c-4d5e-4f60-8a7b-9c0d1e2f3a01";

const seedId = (n: number): string =>
  `6b1f2a3c-4d5e-4f60-8a7b-9c0d1e2f3${String(100 + n).padStart(3, "0")}`;

/** A typed note, made `createdAt` ago: the screenshot card names an item made in the last two minutes. */
const seedText = (
  n: number,
  text: string,
  attachments: readonly unknown[] = [],
  createdAt = new Date()
) => ({
  attachments,
  color: null,
  context: null,
  createdAt: createdAt.toISOString(),
  description: "",
  done: false,
  due: null,
  html: null,
  id: seedId(n),
  kind: "text",
  links: [],
  sectionId: SEED_SECTION,
  steps: [],
  text,
  via: "typed",
  windows: [],
});

const seedShelf = (seeded: readonly unknown[]): void => {
  writeFileSync(
    path.join(userData, "shelf.json"),
    `${JSON.stringify({
      activeSectionId: SEED_SECTION,
      items: seeded,
      schemaVersion: 4,
      sections: [{ id: SEED_SECTION, name: "Inbox" }],
    })}\n`
  );
};

/** Every picture the shelf file holds: image items and attached images. */
const picturesInDoc = (): number =>
  items().reduce(
    (sum, item) =>
      sum +
      (item.kind === "image" ? 1 : 0) +
      z
        .array(z.looseObject({ kind: z.string() }))
        .catch([])
        .parse(item.attachments)
        .filter((attachment) => attachment.kind === "image").length,
    0
  );

/** The shelf's own window: the one of the app that is 300 pt or wider and taller than a card. */
const shelfWindow = () =>
  windows().find(
    (window) =>
      window.owner === processName &&
      window.width >= 300 &&
      window.height >= 400 &&
      window.layer !== 4
  );

/** Runs `body` on the shelf window's accessibility elements as `els`. */
const inShelf = (body: string): string => {
  const shelf = shelfWindow();

  if (shelf === undefined) {
    return "";
  }

  return jxa(`const w = Application("System Events").processes.byName(${JSON.stringify(processName)}).windows().find((w) => { const [x, y] = w.position(); return x === ${shelf.x} && y === ${shelf.y}; });
    const els = w ? w.entireContents() : [];
    ${body}`);
};

/**
 * The screenshots the shelf window shows: an image item's picture is a
 * button named "Select: Screenshot", an attached one's tile a button named
 * as macOS names a screenshot ("Screenshot 2026-11-26 at 10.33.02 · Picture").
 */
const shelfScreenshots = (): number =>
  Number(
    inShelf(
      `String(els.filter((e) => { try { return e.role() === "AXButton" && /^(Select: Screenshot|Screenshot \\d{4}-)/u.test(e.name() ?? ""); } catch { return false; } }).length)`
    ) || "0"
  );

/** The buttons in the shelf window whose name starts with `prefix`: an attachment's tile is named "<name> · Picture" or "<name> · PDF". */
const shelfButtons = (prefix: string): number =>
  Number(
    inShelf(
      `String(els.filter((e) => { try { return e.role() === "AXButton" && (e.name() ?? "").startsWith(${JSON.stringify(prefix)}); } catch { return false; } }).length)`
    ) || "0"
  );

/** A screenshot of the shelf window alone, kept with the run's artifacts. */
const shelfShot = (name: string): void => {
  const shelf = shelfWindow();

  if (shelf !== undefined) {
    execFileSync("screencapture", [
      "-x",
      `-R${shelf.x},${shelf.y},${shelf.width},${shelf.height}`,
      path.join(work, `${name}.png`),
    ]);
  }
};

/** Role and name of every element in the shelf window, for the log when a check fails. */
const shelfTree = (): string =>
  inShelf(
    `els.map((e) => { try { return e.role() + ":" + (e.name() || e.description() || "") + ":" + e.size().join("x") + ":" + e.subrole(); } catch { return ""; } }).filter((s) => s.length > 6).join(" | ")`
  );

/** The window of a just-closed run's userData: its shelf.json's mtime, to see whether a launch wrote it. */
const shelfMtime = (): number => {
  const file = path.join(userData, "shelf.json");

  return existsSync(file) ? statSync(file).mtimeMs : 0;
};

/** A picture as the shelf file holds it: an image item, or an attached image. */
const StoredPictureSchema = z.looseObject({
  image: z.looseObject({ file: z.string() }),
  kind: z.literal("image"),
});

/** For each picture file the shelf file names: whether the data folder holds it. */
const picturesOnDisk = (): boolean[] =>
  items()
    .flatMap((item) => [
      item,
      ...z.array(z.unknown()).catch([]).parse(item.attachments),
    ])
    .flatMap((each) => {
      const picture = StoredPictureSchema.safeParse(each);

      return picture.success ? [picture.data.image.file] : [];
    })
    .map((file) => existsSync(path.join(userData, "attachments", file)));

const SWITCH_TARGET = "Card target note";

/**
 * One direction of the card's destination switch on a disk that refuses the
 * first write: `first` fails, then the other button is pressed. The shelf
 * file and the shelf window then hold the screenshot once.
 */
const switchDirection = async (
  first: "shelf" | "item",
  app: ChildProcess
): Promise<ChildProcess> => {
  const label = `switch ${first === "shelf" ? "Add to Shelf → Add to “…”" : "Add to “…” → Add to Shelf"}`;
  const itemButton = `Add to “${SWITCH_TARGET}”`;
  const before = shelfMtime();

  await delay(1500);
  record(
    `${label}: launch left the shelf file unwritten, so the failing write is the card's`,
    shelfMtime() === before
  );

  const mark = events().length;

  takeScreenshot();
  await waitFor("screenshotShown", mark);
  enableWebAccessibility();

  const offered = await clickInCard(
    first === "shelf" ? "Add to Shelf" : itemButton
  );

  record(`${label}: the card offers both destinations`, offered);

  if (!offered) {
    return app;
  }

  const failedButton =
    first === "shelf" ? "Retry" : `Retry adding to “${SWITCH_TARGET}”`;

  const failed = await waitUntil(
    () => windowText().includes(failedButton),
    8000
  );

  record(`${label}: the first save fails and the card offers Retry`, failed);

  const switched = await clickInCard(
    first === "shelf" ? itemButton : "Add to Shelf"
  );

  record(
    `${label}: the other destination can be pressed after the failure`,
    switched
  );

  const target = (): number =>
    z
      .array(z.unknown())
      .catch([])
      .parse(items().find((item) => item.id === seedId(1))?.attachments).length;

  const settled = await waitUntil(
    () =>
      picturesInDoc() === 1 &&
      (first === "shelf" ? target() === 1 : target() === 0),
    10_000
  );

  record(
    `${label}: the shelf file holds the screenshot once, where the second press put it`,
    settled,
    `pictures ${picturesInDoc()}, on the note ${target()}, items ${items().length}`
  );
  record(
    `${label}: the card goes once it is saved`,
    await waitUntil(() => !windowText().includes(failedButton), 4000)
  );

  // The screenshot took its picture file along when it changed place: the file the shelf names is the one written for the first add.
  const pictures = picturesOnDisk();

  record(
    `${label}: the picture file the shelf file names is on disk`,
    pictures.length === 1 && pictures.every(Boolean),
    `${pictures.length} named, on disk: ${pictures.join(", ")}`
  );

  showShelfFromTray();
  await waitUntil(() => shelfWindow() !== undefined, 4000);
  await delay(1200);

  const shown = shelfScreenshots();

  record(
    `${label}: the shelf window shows the screenshot once`,
    shown === 1,
    `${shown} pictures; banner ${windowText().includes("Not saved to disk") ? "still says Not saved" : "gone"}`
  );

  if (shown !== 1) {
    console.log(`DEBUG shelf tree: ${shelfTree()}`);
  }

  shelfShot(`switch-${first}`);

  return app;
};

/** C1: both directions, each on a fresh launch whose first write fails. */
const checkSwitch = async (app: ChildProcess): Promise<ChildProcess> => {
  let current = await switchDirection("shelf", app);

  quitApp(current);
  await exited(current);
  seedShelf([seedText(1, SWITCH_TARGET)]);
  current = launch({ INSET_FAIL_NEXT_WRITE: "1" });
  await waitFor("launch", events().length, Date.now() + 15_000);
  await hideShelf();

  return await switchDirection("item", current);
};

// The v3 upgrade (src/shared/shelf.ts upgradeV3): the file becomes v4 the first time the shelf changes (README.md, Attachments).

const V3_FIXTURE = path.join(root, "src/shared/fixtures/shelf-v3.json");

/** A 1×1 PNG: the fixture's pictures need real bytes, not their sizes. */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64"
);

const attachmentsDir = (): string => path.join(userData, "attachments");

/** Every picture, drawing's marks and file the fixture names. */
const v3Files = (): string[] => [
  ...new Set(
    readFileSync(V3_FIXTURE, "utf-8").match(/[0-9a-f-]{36}\.(?:png|json|pdf)/gu)
  ),
];

/** Each file's own bytes, so a swap or a rewrite shows. */
const v3Bytes = (name: string): Buffer => {
  if (name.endsWith(".png")) {
    return Buffer.concat([TINY_PNG, Buffer.from(name)]);
  }

  return Buffer.from(
    name.endsWith(".json") ? '{"strokes":[]}' : `%PDF-1.4\n%${name}\n`
  );
};

/** The fixture as shelf.json, and its files in the data folder. */
const seedV3 = (): void => {
  mkdirSync(attachmentsDir(), { recursive: true });

  for (const name of v3Files()) {
    writeFileSync(path.join(attachmentsDir(), name), v3Bytes(name));
  }

  writeFileSync(
    path.join(userData, "shelf.json"),
    readFileSync(V3_FIXTURE, "utf-8")
  );
};

/** The fixture's files that are gone or differ from their seeded bytes. */
const changedFiles = (): string[] =>
  v3Files().flatMap((name) => {
    const file = path.join(attachmentsDir(), name);

    return existsSync(file) && readFileSync(file).equals(v3Bytes(name))
      ? []
      : [name];
  });

/** Every item's main words, as the shelf shows them, by section. */
const V3_WORDS = {
  Inbox: ["Call about the", "Floor plan, level 3"],
  "Office move": ["The quote is here.", "Login screen: two things to fix"],
} as const;

/** Picks a section from the View menu and reads whether the shelf shows each word. */
const sectionShows = async (
  section: keyof typeof V3_WORDS
): Promise<string[]> => {
  menuItem("View", section);
  await delay(800);

  const missing: string[] = [];

  for (const words of V3_WORDS[section]) {
    // oxlint-disable-next-line no-await-in-loop -- one read at a time, the tree fills in after a switch.
    if (!(await windowShows(words, 4))) {
      missing.push(words);
    }
  }

  return missing;
};

/** The fixture's items, as the app should write them: each as it was, with no attachments. */
const upgradedItems = (): unknown[] =>
  z
    .object({ items: z.array(z.looseObject({})) })
    .parse(JSON.parse(readFileSync(V3_FIXTURE, "utf-8")))
    .items.map((item) => ({ ...item, attachments: [] }));

const schemaVersion = (): number | null =>
  z
    .looseObject({ schemaVersion: z.number().nullable().catch(null) })
    .parse(JSON.parse(readFileSync(path.join(userData, "shelf.json"), "utf-8")))
    .schemaVersion;

/**
 * C2: a v3 shelf opens with every item, still v3 on disk; the first change
 * writes it as v4 with every item as it was and no file lost; a relaunch on
 * the v4 file keeps them all.
 */
const checkUpgrade = async (app: ChildProcess): Promise<ChildProcess> => {
  const seeded = readFileSync(path.join(userData, "shelf.json"), "utf-8");

  enableWebAccessibility();
  showShelfFromTray();
  await delay(1500);

  // The active section, before anything changes: opening alone writes nothing.
  const first = await sectionShows("Office move");

  record(
    "upgrade: opening alone leaves the file as it was (v3)",
    readFileSync(path.join(userData, "shelf.json"), "utf-8") === seeded,
    `schemaVersion ${schemaVersion() ?? "unreadable"}`
  );
  record(
    "upgrade: every picture, drawing's marks and file is kept on launch",
    changedFiles().length === 0,
    changedFiles().join(", ")
  );
  shelfShot("upgrade-office-move-v3");

  // The first change: picking the other section, which the shelf file keeps as the active one.
  const second = await sectionShows("Inbox");

  record(
    "upgrade: a v3 shelf shows every item, in both sections",
    first.length === 0 && second.length === 0,
    [...first, ...second].join(", ")
  );
  shelfShot("upgrade-inbox");

  const written = await waitUntil(() => schemaVersion() === 4, 6000);

  const doc = z
    .object({
      activeSectionId: z.string(),
      items: z.array(z.looseObject({ id: z.string() })),
    })
    .parse(
      JSON.parse(readFileSync(path.join(userData, "shelf.json"), "utf-8"))
    );

  const expected = upgradedItems();

  const kept = expected.filter((item) =>
    doc.items.some((saved) => isDeepStrictEqual(saved, item))
  ).length;

  record(
    "upgrade: the first change (the active section) writes the file as v4",
    written &&
      doc.activeSectionId !==
        z.object({ activeSectionId: z.string() }).parse(JSON.parse(seeded))
          .activeSectionId,
    `schemaVersion ${schemaVersion() ?? "unreadable"}`
  );
  record(
    "upgrade: every v3 item is written as it was, with no attachments",
    kept === expected.length && doc.items.length === expected.length,
    `${kept} of ${expected.length} equal, ${doc.items.length} items`
  );
  record(
    "upgrade: no file is lost by the write",
    changedFiles().length === 0,
    changedFiles().join(", ")
  );

  // A relaunch on the v4 file: the launch's tidy-up deletes files no shelf names.
  quitApp(app);
  await exited(app);

  const next = launch();

  await waitFor("launch", events().length, Date.now() + 15_000);
  enableWebAccessibility();
  showShelfFromTray();
  await delay(1500);

  const after = [
    ...(await sectionShows("Office move")),
    ...(await sectionShows("Inbox")),
  ];

  shelfShot("upgrade-inbox-v4");
  record(
    "upgrade: after a relaunch on the v4 file every item shows and every file is kept",
    after.length === 0 && changedFiles().length === 0,
    [...after, ...changedFiles()].join(", ")
  );

  return next;
};

// Attachments on an existing item (src/main/attachments.ts), on a seeded note.

const ATTACH_TARGET = "Attach target note";

/** The seeded note's attachments as the shelf file holds them. */
const targetAttachments = () =>
  z
    .array(
      z.looseObject({
        file: z.looseObject({ name: z.string() }).optional(),
        id: z.string(),
        image: z.looseObject({ file: z.string() }).optional(),
        kind: z.string(),
        name: z.string().optional(),
        scene: z.unknown().optional(),
      })
    )
    .catch([])
    .parse(items().find((item) => item.id === seedId(1))?.attachments);

/** A 64×48 PNG on the clipboard; screenshot cards are off in these trials, so it raises no card. */
const copyPicture = (): void => {
  const file = path.join(work, "picture.png");

  writeFileSync(file, TINY_PNG);
  execFileSync("sips", ["-z", "48", "64", file], { stdio: "ignore" });
  jxa(`ObjC.import("AppKit");
    const board = $.NSPasteboard.generalPasteboard;
    board.clearContents;
    const data = $.NSData.dataWithContentsOfFile(${JSON.stringify(file)});
    board.setDataForType(data, "public.png");
    "";`);
};

/** Opens the seeded note's row with a click, then its details with the open row's Show details. */
const openTargetDetails = async (): Promise<boolean> => {
  enableWebAccessibility();
  showShelfFromTray();
  await waitUntil(() => shelfWindow() !== undefined, 4000);
  await delay(800);

  if (!(await clickElement("AXButton", ATTACH_TARGET))) {
    return false;
  }

  await delay(600);

  return (
    (await clickElement("AXButton", "Show details")) &&
    (await windowShows("Back to the list"))
  );
};

/** Opens details' Add menu and picks `entry`; a menu item's name ends with its shortcut ("Paste Image ⌘V"). */
const addMenu = async (entry: string): Promise<boolean> => {
  if (!(await clickElement("AXPopUpButton", "Add a field", 4))) {
    return false;
  }

  await delay(500);

  const found = jxa(`const hit = ${processElements}.find((e) => {
      try { return e.role() === "AXMenuItem" && (e.name() === ${JSON.stringify(entry)} || e.name().startsWith(${JSON.stringify(`${entry} `)})); } catch { return false; }
    });
    hit ? (() => { const [x, y] = hit.position(); const [w, h] = hit.size(); return Math.round(x + w / 2) + " " + Math.round(y + h / 2); })() : "";`);

  if (found === "") {
    return false;
  }

  input("click", ...found.split(" "));

  return true;
};

/**
 * C3: a picture pasted with ⌘V while the note's row is open becomes a new
 * item, as README.md (Attachments) says the list does; in details, Add ›
 * Paste Image and ⌘V each attach it to the note.
 */
const checkPasteImage = async (): Promise<void> => {
  enableWebAccessibility();
  showShelfFromTray();
  await delay(1000);

  const opened = await clickElement("AXButton", ATTACH_TARGET);

  await delay(600);
  record(
    "paste: the note's row opens on a click",
    opened && (await windowShows("Show details", 4))
  );
  copyPicture();

  const before = items().length;
  const mark = events().length;

  guardedKeys(() => {
    osa('tell application "System Events" to keystroke "v" using command down');
  }, [processName]);

  const added = await waitFor("itemAdded", mark, Date.now() + 6000);

  record(
    "paste: ⌘V on an open row adds the picture as a new item (README: in the list ⌘V adds a new item)",
    added?.via === "paste" &&
      items().length === before + 1 &&
      targetAttachments().length === 0,
    `${items().length - before} added, ${targetAttachments().length} on the note`
  );
  shelfShot("paste-open-row");

  record("paste: details open from the open row", await openTargetDetails());

  const pasted = await addMenu("Paste Image");

  record(
    "paste: Add › Paste Image in details attaches the clipboard's picture to the note",
    pasted &&
      (await waitUntil(
        () =>
          targetAttachments().length === 1 &&
          targetAttachments()[0]?.kind === "image",
        6000
      )),
    JSON.stringify(targetAttachments().map((each) => each.name))
  );

  guardedKeys(() => {
    osa('tell application "System Events" to keystroke "v" using command down');
  }, [processName]);
  record(
    "paste: ⌘V in details attaches it too",
    await waitUntil(
      () =>
        targetAttachments().length === 2 &&
        targetAttachments().every((each) => each.kind === "image"),
      6000
    ),
    `${targetAttachments().length} on the note`
  );
  record(
    "paste: details show both pictures",
    await waitUntil(() => shelfButtons("Pasted image") === 2, 3000),
    `${shelfButtons("Pasted image")} tiles`
  );
  shelfShot("paste-details");
};

/** A file the native dialogs and Finder show: under the run's own temporary folder, never Desktop or Documents. */
const attachableFile = (name: string): string => {
  const folder = path.join(work, "files");

  mkdirSync(folder, { recursive: true });

  const file = path.join(folder, name);

  writeFileSync(file, `%PDF-1.4\n% ${name}\n`);

  return file;
};

/** C4: Add › Attach Files… opens the system's open panel; a file picked in it is attached to the note. */
const checkAttachFiles = async (): Promise<void> => {
  const file = attachableFile("Quote 2026-114.pdf");

  record("attach: details open from the open row", await openTargetDetails());
  record("attach: Add lists Attach Files…", await addMenu("Attach Files…"));

  const panel = await waitUntil(() => windowText().includes("Cancel"), 6000);

  record(
    "attach: the open panel shows, with the app in front",
    panel && frontmost() === processName,
    frontmost()
  );

  if (!panel) {
    return;
  }

  // Go to the file by its path, as a person can with ⇧⌘G, then Open.
  guardedKeys(() => {
    osa(
      'tell application "System Events" to keystroke "g" using {command down, shift down}'
    );
  }, [processName]);
  await delay(900);
  guardedKeys(() => {
    osa(
      `tell application "System Events" to keystroke ${JSON.stringify(file)}`
    );
  }, [processName]);
  await delay(900);
  guardedKeys(() => {
    osa('tell application "System Events" to key code 36');
  }, [processName]);
  await delay(1200);
  guardedKeys(() => {
    osa('tell application "System Events" to key code 36');
  }, [processName]);

  const attached = await waitUntil(
    () =>
      targetAttachments().some(
        (each) =>
          each.kind === "file" && each.file?.name === path.basename(file)
      ),
    8000
  );

  record(
    "attach: the picked file is attached to the note, on disk",
    attached && targetAttachments().length === 1,
    JSON.stringify(
      targetAttachments().map((each) => each.file?.name ?? each.kind)
    )
  );
  record("attach: the open panel is gone", !windowText().includes("Cancel"));
  record(
    "attach: details show the file's tile",
    await waitUntil(() => shelfButtons("Quote 2026-114") === 1, 3000),
    `${shelfButtons("Quote 2026-114")} tiles`
  );
  shelfShot("attach-details");
};

/** A 400×300 picture attached to the seeded note, its file in the data folder. */
const seedAttachedPicture = () => {
  const name = "6b1f2a3c-4d5e-4f60-8a7b-9c0d1e2f3a90.png";
  const file = path.join(attachmentsDir(), name);

  mkdirSync(attachmentsDir(), { recursive: true });
  writeFileSync(file, TINY_PNG);
  execFileSync("sips", ["-z", "300", "400", file], { stdio: "ignore" });

  return {
    addedAt: "2026-10-26T09:05:00.000Z",
    id: "6b1f2a3c-4d5e-4f60-8a7b-9c0d1e2f3a91",
    image: { file: name, heightPx: 300, pixelsPerDip: 1, widthPx: 400 },
    kind: "image",
    name: "Seeded picture",
    pins: [],
  };
};

/** Clicks a picture's tile and gives the drawing window it opened, once the app says it showed. */
const openPicture = async (tile: string): Promise<Box | undefined> => {
  const frame = (window: Box): string =>
    `${window.x},${window.y},${window.width},${window.height}`;

  const others = new Set(
    windows()
      .filter((window) => window.owner === processName)
      .map(frame)
  );

  const mark = events().length;

  if (!(await clickElement("AXButton", tile, 4))) {
    return undefined;
  }

  if ((await waitFor("drawingShown", mark, Date.now() + 6000)) === undefined) {
    return undefined;
  }

  await delay(1000);

  return windows().find(
    (window) => window.owner === processName && !others.has(frame(window))
  );
};

/** C5: a click on an attached picture in details opens it to draw on; Save puts the drawing on the attachment. */
/** The file of the note's first attachment's picture, or "". */
const attachedPicture = (): string => targetAttachments()[0]?.image?.file ?? "";

/** Whether the note's first attachment keeps drawing marks. */
const attachedScene = (): boolean =>
  targetAttachments()[0]?.scene !== undefined;

/** A stored picture's bytes, or null when there is none. */
const storedPicture = (name: string): Buffer | null => {
  const file = path.join(attachmentsDir(), name);

  return name !== "" && existsSync(file) ? readFileSync(file) : null;
};

const checkAnnotate = async (): Promise<void> => {
  const old = attachedPicture();

  record("annotate: details open from the open row", await openTargetDetails());

  const editor = await openPicture("Seeded picture · Picture");

  record(
    "annotate: a click on the picture opens it in the drawing window",
    editor !== undefined,
    JSON.stringify(editor ?? null)
  );

  if (editor === undefined || frontmost() !== processName) {
    return;
  }

  // A cross through the middle, several strokes each way, so the tile's crop shows it.
  const cx = editor.x + editor.width / 2;
  const cy = editor.y + editor.height / 2;

  for (const offset of [-6, 0, 6]) {
    input(
      "drag",
      String(cx - 90),
      String(cy - 70 + offset),
      String(cx + 90),
      String(cy + 70 + offset)
    );
    input(
      "drag",
      String(cx - 90),
      String(cy + 70 + offset),
      String(cx + 90),
      String(cy - 70 + offset)
    );
  }

  await delay(500);

  const saved = await clickElement("AXButton", "Save", 4);

  const changed = await waitUntil(
    () => attachedPicture() !== old && attachedScene(),
    8000
  );

  const now = attachedPicture();

  record(
    "annotate: Save keeps the drawing on the attachment: a new picture, with its marks kept",
    saved && changed && targetAttachments().length === 1,
    `${old} → ${now}, scene ${attachedScene() ? "kept" : "none"}`
  );

  const drawn = storedPicture(now);

  record(
    "annotate: the new picture is on disk and differs from the old one",
    drawn !== null && !drawn.equals(storedPicture(old) ?? Buffer.alloc(0))
  );
  record(
    "annotate: the drawing window closes after Save",
    await waitUntil(
      () =>
        !windows().some(
          (window) =>
            window.owner === processName &&
            window.x === editor.x &&
            window.y === editor.y &&
            window.width === editor.width
        ),
      4000
    )
  );
  await delay(1000);
  shelfShot("annotate-details");

  if (drawn !== null) {
    writeFileSync(path.join(work, "annotated.png"), drawn);
  }
};

// Finder, driven only through `open` and System Events: an Apple Event to Finder itself asks for Automation access.

/** A folder for one trial's Finder window, named for this run with its random token: no window of another run or of the user is titled so, which is what `inFinderWindow` goes by. */
const finderFolder = (name: string): string =>
  path.join(work, `${name} ${path.basename(work)}`);

/** The trial's Finder window, as it stood when it was last looked at; or why Finder's front window is not that window. */
type FinderLook =
  | { readonly ok: true; readonly frame: Box; readonly out: string }
  | { readonly ok: false; readonly why: string };

const FinderAnswerSchema = z.union([
  z.object({
    frame: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    out: z.string(),
  }),
  z.object({ refused: z.string() }),
]);

/**
 * Looks at Finder's front window and runs `then` only when it is the trial's
 * own: Finder is the app in front, and that window's title is the folder's
 * name. The name carries this run's random token (`finderFolder`), so no
 * other window has it. A Finder window gives accessibility no path (its
 * AXDocument and AXProxy are null on macOS 27), and asking Finder itself
 * would need Automation access, which raises a prompt. The look and `then`
 * are one script: milliseconds lie between them, where two scripts would
 * leave a window time to come in front.
 *
 * `then` is the body of a JXA function with the window as `w` and System
 * Events as `se`; what it returns is `out`.
 */
const inFinderWindow = (folder: string, then = ""): FinderLook => {
  try {
    const own = path.basename(folder);

    const answer = FinderAnswerSchema.parse(
      JSON.parse(
        jxa(`const se = Application("System Events");
    const finder = se.processes.byName("Finder");
    const own = ${JSON.stringify(own)};
    const titled = (w) => {
      try { return String(w.name() ?? ""); } catch { return ""; }
    };
    const [w] = finder.windows();
    const at = w === undefined ? "" : titled(w);
    JSON.stringify(
      !finder.frontmost() ? { refused: "Finder is not in front" }
      : w === undefined ? { refused: "Finder has no window" }
      : at !== own ? { refused: "Finder's front window is " + (at === "" ? "untitled" : "“" + at + "”") }
      : { frame: [...w.position(), ...w.size()], out: String((() => { ${then} })() ?? "") }
    )`)
      )
    );

    if ("refused" in answer) {
      return { ok: false, why: answer.refused };
    }

    const [x, y, width, height] = answer.frame;

    return { frame: { height, width, x, y }, ok: true, out: answer.out };
  } catch (error) {
    return {
      ok: false,
      why: `Finder's windows can't be read: ${String(error)}`,
    };
  }
};

/** ⌘ and a key, for `inFinderWindow`: it goes out in the script that saw the trial's window in front. */
const finderCommand = (key: string): string =>
  `se.keystroke(${JSON.stringify(key)}, { using: "command down" });`;

/** The centres of the entries selected in the window, as list rows or icons, for `inFinderWindow`; the sidebar's rows are never selected here. */
const FINDER_SELECTED = `const all = w.entireContents();
    const rows = all.filter((e) => { try { return e.role() === "AXRow" && e.selected(); } catch { return false; } });
    const icons = all.filter((e) => { try { return e.role() === "AXImage" && e.size()[0] >= 32 && e.selected(); } catch { return false; } });
    return (rows.length > 0 ? rows : icons).map((e) => { const [x, y] = e.position(); const [ww, h] = e.size(); return Math.round(x + Math.min(ww / 2, 120)) + " " + Math.round(y + h / 2); }).join("\\n");`;

/** Opens the trial's folder in a Finder window and waits until that window is in front. When `open` fails or the window never comes, it says why. */
const finderWindow = async (folder: string): Promise<FinderLook> => {
  const opened = spawnSync("open", [folder], { encoding: "utf-8" });

  if (opened.status !== 0) {
    return {
      ok: false,
      why: `open failed: ${String(opened.error ?? opened.stderr).trim()}`,
    };
  }

  let look = inFinderWindow(folder);

  await waitUntil(() => {
    look = inFinderWindow(folder);

    return look.ok;
  }, 6000);

  return look;
};

/**
 * Closes the trial's Finder window: ⌘W goes out only in the script that sees
 * that window in front. When another window is in front, no key is sent, the
 * window stays open and `trial` fails with what was in front.
 */
const closeFinderWindow = async (
  folder: string,
  trial: string
): Promise<void> => {
  let look = inFinderWindow(folder, `w.actions.byName("AXRaise").perform();`);

  if (look.ok) {
    await delay(300);
    look = inFinderWindow(folder, finderCommand("w"));
  }

  if (!look.ok) {
    record(
      `${trial}: its Finder window closes`,
      false,
      `${look.why}; no key was sent`
    );
  }

  await delay(500);
};

/**
 * C7: a file and a folder dragged together from Finder onto the note's open
 * row: the file is attached to the note, the folder refused with why, and no
 * new item is made.
 */
const checkFinderDrop = async (): Promise<void> => {
  const folder = finderFolder("Drop here");

  mkdirSync(path.join(folder, "Quotes"), { recursive: true });
  writeFileSync(path.join(folder, "Quotes", "inside.txt"), "inside\n");
  writeFileSync(path.join(folder, "Drop offer.pdf"), "%PDF-1.4\n");
  enableWebAccessibility();
  showShelfFromTray();
  await delay(1000);

  // An open row's words are no longer a button: its place is read before the click opens it.
  await windowShows(ATTACH_TARGET, 6);

  const row = elementCentre("AXButton", ATTACH_TARGET);
  const opened = await clickElement("AXButton", ATTACH_TARGET);

  await delay(600);

  const open = opened && row !== "" && (await windowShows("Show details", 4));

  record("drop: the note's row is open before the drop", open, row);

  if (!open) {
    console.log(`DEBUG shelf tree: ${shelfTree()}`);
    shelfShot("finder-drop-row");
  }

  const finder = await finderWindow(folder);

  if (!finder.ok) {
    record("drop: a Finder window shows the folder", false, finder.why);

    return;
  }

  // ⌘A, and then the read of what it selected, each go only to the window that shows the trial's folder.
  let selected = inFinderWindow(folder, finderCommand("a"));

  if (selected.ok) {
    await delay(500);
    selected = inFinderWindow(folder, FINDER_SELECTED);
  }

  const entries = selected.ok ? selected.out.split("\n").filter(Boolean) : [];

  record(
    "drop: Finder shows and selects the file and the folder",
    entries.length === 2,
    selected.ok
      ? `${entries.length} entries`
      : `${selected.why}; no key or drag was sent since`
  );

  // Not the trial's window any more: nothing is dragged from it and nothing is closed.
  if (!selected.ok) {
    return;
  }

  const [from] = entries;
  const before = items().length;
  const mark = events().length;

  if (from === undefined || row === "") {
    await closeFinderWindow(folder, "drop");

    return;
  }

  // The drag starts where the trial's window showed its entries a moment ago, in the script that saw it in front.
  input("drag", ...from.split(" "), ...row.split(" "));

  const attached = await waitUntil(
    () =>
      targetAttachments().some(
        (each) => each.kind === "file" && each.file?.name === "Drop offer.pdf"
      ),
    8000
  );

  await delay(600);

  // A drop that only partly lands says what was refused, names the item, and offers Undo (src/renderer/shelf/shelf-app.tsx attachDropped).
  const notice = windowText().replaceAll(/\s+/gu, " ");

  record(
    "drop: the file is attached to the note on disk, and only the file",
    attached && targetAttachments().length === 1,
    JSON.stringify(
      targetAttachments().map((each) => each.file?.name ?? each.kind)
    )
  );
  record(
    "drop: no new item is made",
    items().length === before &&
      !events()
        .slice(mark)
        .some((event) => event.event === "itemAdded"),
    `${items().length - before} added`
  );
  record(
    "drop: the notice names the folder refused and offers Undo",
    notice.includes("Quotes is a folder, not a file.") &&
      notice.includes("Undo"),
    /Quotes is a folder[^.]*\./u.exec(notice)?.[0] ?? "no notice"
  );
  shelfShot("finder-drop");
  await closeFinderWindow(folder, "drop");
};

/** A PNG's width and height, as sips reads them. */
const pictureSize = (file: string): string =>
  execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", file], {
    encoding: "utf-8",
  })
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .join(" ");

/**
 * C6: an attached picture dragged from details onto a Finder window lands
 * there as a file named after it.
 */
const checkDragOut = async (): Promise<void> => {
  const folder = finderFolder("Dragged out");

  mkdirSync(folder, { recursive: true });
  record("drag out: details open from the open row", await openTargetDetails());

  const tile = elementCentre("AXButton", "Seeded picture · Picture");
  const finder = await finderWindow(folder);

  record(
    "drag out: the tile and a Finder window are on screen",
    tile !== "" && finder.ok,
    `${tile} ${finder.ok ? JSON.stringify(finder.frame) : finder.why}`
  );

  // No window of the trial's is in front: there is none to drop on or to close.
  if (!finder.ok) {
    return;
  }

  if (tile === "") {
    await closeFinderWindow(folder, "drag out");

    return;
  }

  const landed = (): string[] =>
    spawnSync("ls", [folder], { encoding: "utf-8" })
      .stdout.split("\n")
      .filter(Boolean);

  for (const how of ["drag", "drag-hold"]) {
    // Looked at anew before each drag: the drop only ever goes to the window that shows the trial's folder.
    const now = inFinderWindow(folder);

    if (!now.ok) {
      record(
        "drag out: its Finder window is in front for the drop",
        false,
        `${now.why}; nothing was dragged since`
      );

      break;
    }

    // The drop goes to the Finder window's lower half, clear of the shelf.
    const to = [
      String(Math.round(now.frame.x + now.frame.width / 2)),
      String(Math.round(now.frame.y + now.frame.height * 0.7)),
    ];

    input(how, ...tile.split(" "), ...to);

    // oxlint-disable-next-line no-await-in-loop -- one drag, then the next only if the first dropped nothing.
    if (await waitUntil(() => landed().length > 0, 4000)) {
      console.log(`  dropped with ${how}`);
      break;
    }
  }

  record(
    "drag out: Finder gets the picture as a file named after it",
    landed().some((name) => name.startsWith("Seeded picture")),
    landed().join(", ") || "nothing in the folder"
  );

  const dropped = landed().find((name) => name.startsWith("Seeded picture"));

  // The app exports the picture with its pins drawn in (exportImage), so its bytes differ from the stored file; its size doesn't.
  const droppedSize =
    dropped === undefined ? "" : pictureSize(path.join(folder, dropped));

  record(
    "drag out: the dropped file is the picture as a PNG of its own size",
    dropped !== undefined &&
      droppedSize ===
        pictureSize(path.join(attachmentsDir(), attachedPicture())),
    droppedSize
  );
  await closeFinderWindow(folder, "drag out");
};

// Copy with Details (src/main/copy-commands.ts): read back from the pasteboard, then pasted into a document of the test's own under the run's temp folder.

/** The pasteboard's types, its plain text and its HTML. */
const pasteboard = () =>
  z
    .object({
      html: z.string(),
      plain: z.string(),
      rtf: z.number(),
      types: z.array(z.string()),
    })
    .parse(
      JSON.parse(
        jxa(`ObjC.import("AppKit");
          const b = $.NSPasteboard.generalPasteboard;
          const types = ObjC.deepUnwrap(b.types) || [];
          const text = (t) => { const s = b.stringForType(t); return s.isNil() ? "" : ObjC.unwrap(s); };
          const rtf = b.dataForType("public.rtf");
          JSON.stringify({ html: text("public.html"), plain: text("public.utf8-plain-text"), rtf: rtf.isNil() ? 0 : Number(rtf.length), types });`)
      )
    );

/**
 * The document the paste goes into: a blank rich-text package in the run's temp folder.
 * TextEdit keeps a new Untitled document in iCloud Drive, so the test never makes one.
 */
const PASTE_DOCUMENT = path.join(work, "inset-e2e-paste.rtfd");

const TextEditWindow = z.object({
  document: z.string(),
  standard: z.boolean(),
  text: z.string(),
});

/** Reads TextEdit's windows through System Events: the file each shows, and its text. */
const TEXTEDIT_WINDOWS = `const textEditWindows = () => Application("System Events").processes.byName("TextEdit").windows().map((w) => {
    const read = (get) => { try { const v = get(); return v === null || v === undefined ? "" : String(v); } catch { return ""; } };
    const area = (() => { try { return w.entireContents().find((e) => { try { return e.role() === "AXTextArea"; } catch { return false; } }); } catch { return undefined; } })();
    return { document: read(() => w.attributes.byName("AXDocument").value()), standard: read(() => w.subrole()) === "AXStandardWindow", text: area ? read(() => area.value()) : "", w };
  });`;

const textEditWindows = (): z.infer<typeof TextEditWindow>[] =>
  z
    .array(TextEditWindow)
    .parse(
      JSON.parse(
        jxa(
          `${TEXTEDIT_WINDOWS} JSON.stringify(textEditWindows().map(({ document, standard, text }) => ({ document, standard, text })));`
        )
      )
    );

/** A window's AXDocument is a file URL; a package's ends in a slash. */
const documentPath = (url: string): string =>
  url === ""
    ? ""
    : decodeURIComponent(new URL(url).pathname).replace(/\/$/u, "");

const isPasteDocument = (window: z.infer<typeof TextEditWindow>): boolean =>
  documentPath(window.document) === realpathSync(PASTE_DOCUMENT);

/**
 * Edit > Paste in TextEdit, pressed only when its one window shows the test's own blank document.
 * The look and the press are one script, so the paste can reach no other document.
 */
const pasteIntoOwnDocument = (): string =>
  jxa(`${TEXTEDIT_WINDOWS}
    const own = ${JSON.stringify(`file://${realpathSync(PASTE_DOCUMENT)}`)};
    const open = textEditWindows();
    const plain = (url) => decodeURIComponent(url).replace(/\\/$/, "");
    (() => {
      if (open.length !== 1) return "not pasted: " + open.length + " windows";
      if (plain(open[0].document) !== own) return "not pasted: the window shows " + (open[0].document || "no file");
      if (open[0].text !== "") return "not pasted: the document is not blank";
      Application("System Events").processes.byName("TextEdit").menuBars[0].menuBarItems.byName("Edit").menus[0].menuItems.byName("Paste").click();
      return "pasted";
    })();`);

/** One step of a cleanup: a step that fails says so and does not skip the next. */
const attempt = (run: () => string): string => {
  try {
    return run();
  } catch (error) {
    return `failed: ${error instanceof Error ? error.message.split("\n")[0] : "unknown"}`;
  }
};

/**
 * Closes the test's own document and nothing else, then quits TextEdit when no document of anyone's is left open.
 * Runs after a failure too.
 */
const closePasteDocument = async (): Promise<void> => {
  if (spawnSync("pgrep", ["-x", "TextEdit"]).status !== 0) {
    return;
  }

  const closed = attempt(() =>
    jxa(`${TEXTEDIT_WINDOWS}
      const own = ${JSON.stringify(`file://${realpathSync(PASTE_DOCUMENT)}`)};
      const mine = textEditWindows().filter((each) => decodeURIComponent(each.document).replace(/\\/$/, "") === own);
      for (const { w } of mine) {
        const close = w.buttons().find((b) => { try { return b.subrole() === "AXCloseButton"; } catch { return false; } });
        if (close) close.click();
        delay(0.8);
        // Only with "Ask to keep changes when closing documents": the file is the test's own, so either answer is safe. Without it the window is gone by now, and there is nothing to read.
        try {
          const sheet = w.sheets().length > 0 ? w.sheets()[0] : undefined;
          const answer = sheet ? sheet.entireContents().find((e) => { try { return e.role() === "AXButton" && ["Revert Changes", "Don’t Save", "Delete"].includes(e.name()); } catch { return false; } }) : undefined;
          if (answer) answer.click();
        } catch {}
      }
      String(mine.length);`)
  );

  await delay(800);

  const left = attempt(() =>
    String(textEditWindows().filter((each) => each.standard).length)
  );

  console.log(
    `  TextEdit: closed ${closed} of the test's windows, ${left} left`
  );

  if (left === "0") {
    attempt(() =>
      osa(
        'tell application "System Events" to tell process "TextEdit" to click menu item "Quit TextEdit" of menu 1 of menu bar item "TextEdit" of menu bar 1'
      )
    );
    await waitUntil(
      () => spawnSync("pgrep", ["-x", "TextEdit"]).status !== 0,
      4000
    );
  }
};

/** C8: the note with a picture attached, copied with ⌥⌘C's menu item; its flavours, then a paste into TextEdit. */
const checkCopyDetails = async (): Promise<void> => {
  enableWebAccessibility();
  showShelfFromTray();
  await delay(1000);
  pbcopy(CLIPBOARD_SENTINEL);

  const selected = await clickElement("AXButton", ATTACH_TARGET);
  const mark = events().length;

  await delay(500);
  menuItem("Edit", "Copy with Details");

  const copied = await waitFor("copied", mark);
  const board = pasteboard();

  console.log(`  pasteboard types: ${board.types.join(", ")}`);
  record(
    "copy details: the item is copied",
    selected && board.plain !== CLIPBOARD_SENTINEL,
    `clicked ${selected}, copied event ${copied === undefined ? "none" : "logged"}`
  );
  record(
    "copy details: plain text names the note and its attachment",
    board.plain.includes(ATTACH_TARGET) &&
      board.plain.includes("Seeded picture"),
    JSON.stringify(board.plain.slice(0, 120))
  );
  record(
    "copy details: HTML carries the words and the picture",
    board.html.includes(ATTACH_TARGET) && /<img\b/u.test(board.html),
    `${board.html.length} chars, ${(board.html.match(/<img\b/gu) ?? []).length} img`
  );
  console.log(
    `  RTF: ${board.rtf === 0 ? "not written" : `${board.rtf} bytes`}`
  );
  writeFileSync(path.join(work, "copy-details.html"), board.html);
  writeFileSync(path.join(work, "copy-details.txt"), board.plain);

  // TextEdit only through `open` and System Events, never an Apple Event to it. It opens one file, the test's own, without its saved windows. No Untitled document is made, so nothing reaches iCloud Drive.
  if (spawnSync("pgrep", ["-x", "TextEdit"]).status === 0) {
    record(
      "copy details: TextEdit was not already open",
      false,
      "not pasted, to leave the owner's documents alone"
    );

    return;
  }

  mkdirSync(PASTE_DOCUMENT);
  writeFileSync(
    path.join(PASTE_DOCUMENT, "TXT.rtf"),
    String.raw`{\rtf1\ansi\ansicpg1252{\fonttbl\f0\fswiss Helvetica;}\f0\fs24 }`
  );

  try {
    execFileSync("open", [
      "-a",
      "TextEdit",
      PASTE_DOCUMENT,
      "--args",
      "-ApplePersistenceIgnoreState",
      "YES",
    ]);

    const shown = await waitUntil(
      () =>
        frontmost() === "TextEdit" && textEditWindows().some(isPasteDocument),
      8000
    );

    await delay(600);

    const outcome = shown
      ? pasteIntoOwnDocument()
      : "not pasted: the document did not open";

    await delay(1200);

    const own = textEditWindows().find(isPasteDocument);
    const pasted = own?.text ?? "";

    record(
      "copy details: TextEdit pastes the words and the picture into the test's own document",
      outcome === "pasted" &&
        pasted.includes(ATTACH_TARGET) &&
        pasted.includes("￼"),
      `${outcome}, ${path.basename(PASTE_DOCUMENT)}: ${JSON.stringify(pasted.replaceAll("￼", "[picture]").slice(0, 160))}`
    );

    const window = windows().find(
      (each) => each.owner === "TextEdit" && each.layer === 0
    );

    if (window !== undefined) {
      execFileSync("screencapture", [
        "-x",
        `-R${window.x},${window.y},${window.width},${window.height}`,
        path.join(work, "copy-details-textedit.png"),
      ]);
    }
  } finally {
    await closePasteDocument();
    console.log(
      `  paste document on disk: ${readdirSync(PASTE_DOCUMENT).join(", ")}`
    );
    record(
      "copy details: TextEdit is quit again",
      spawnSync("pgrep", ["-x", "TextEdit"]).status !== 0
    );
  }
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

/** The seeded note, a month old so the screenshot card's Add to “…” doesn't name it, with a picture attached or not; screenshot cards off. */
const seedNote = (picture: boolean): void => {
  seedShelf([
    seedText(
      1,
      ATTACH_TARGET,
      picture ? [seedAttachedPicture()] : [],
      new Date("2026-10-26T09:00:00.000Z")
    ),
  ]);
  writeFileSync(
    path.join(userData, "settings.json"),
    `${JSON.stringify({ screenshotCards: false })}\n`
  );
};

interface SeededTrial {
  readonly seed: () => void;
  readonly run: (app: ChildProcess) => Promise<ChildProcess>;
}

/** Round 6's trials: each seeds its data folder before launch, then runs. */
const SEEDED_TRIALS = new Map(
  Object.entries({
    annotate: {
      run: async (app) => {
        await checkAnnotate();

        return app;
      },
      seed: () => {
        seedNote(true);
      },
    },
    "attach-files": {
      run: async (app) => {
        await checkAttachFiles();

        return app;
      },
      seed: () => {
        seedNote(false);
      },
    },
    "copy-details": {
      run: async (app) => {
        await checkCopyDetails();

        return app;
      },
      seed: () => {
        seedNote(true);
      },
    },
    "drag-out": {
      run: async (app) => {
        await checkDragOut();

        return app;
      },
      seed: () => {
        seedNote(true);
      },
    },
    "finder-drop": {
      run: async (app) => {
        await checkFinderDrop();

        return app;
      },
      seed: () => {
        seedNote(false);
      },
    },
    "paste-image": {
      run: async (app) => {
        await checkPasteImage();

        return app;
      },
      seed: () => {
        seedNote(false);
      },
    },
    switch: {
      run: async (app) => {
        await hideShelf();

        return await checkSwitch(app);
      },
      seed: () => {
        seedShelf([seedText(1, SWITCH_TARGET)]);
      },
    },
    upgrade: { run: checkUpgrade, seed: seedV3 },
  } satisfies Record<string, SeededTrial>)
);

/** Trials that start on a disk refusing one write: the card's and the failed paste's the first, the why's the second (the capture's lands). */
const failingWrite = (trial: string) => {
  if (trial === "card" || trial === "added-failed" || trial === "switch") {
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

  const seeded = SEEDED_TRIALS.get(only);

  seeded?.seed();

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
    } else if (only === "code") {
      await checkCodePlace();
    } else if (only === "card") {
      await checkScreenshotCard();
    } else if (only === "added" || only === "added-failed") {
      await checkAddedNotice(only === "added-failed");
    } else if (seeded === undefined) {
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
    } else {
      app = await seeded.run(app);
    }
  } finally {
    stopSource();
    quitApp(app);
    await exited(app);
    spawnSync(lsregister, ["-u", sourceApp]);
    rmSync(sourceHome, { force: true, recursive: true });

    // pbcopy("") leaves an empty text item, which the app reads as a held clipboard: clear it instead.
    if (clipboardBefore === "") {
      jxa(
        'ObjC.import("AppKit"); $.NSPasteboard.generalPasteboard.clearContents; ""'
      );
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

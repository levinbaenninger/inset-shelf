/**
 * Screenshots the shelf, the window-link picker and the drawing window of the
 * built renderer in their main states, light and dark, without Electron. Each
 * page runs in Playwright's Chromium with a fake preload bridge
 * (scripts/fixtures/screens-bridge.js) that answers from the sample data
 * below. The shelf is shot at 360×620 with an item that has every field
 * filled in, and the run fails a scene where anything overflows.
 *
 *   pnpm screens            (builds first)
 *   node scripts/screens.ts [output folder]
 *
 * The default output folder is release/screens.
 */
import { once } from "node:events";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { z } from "zod";

const ROOT = path.resolve(import.meta.dirname, "..");
const RENDERER = path.join(ROOT, "out", "renderer");

const OUT = path.resolve(
  process.argv[2] ?? path.join(ROOT, "release", "screens")
);

const FIXTURES = path.join(OUT, ".fixtures");
const BRIDGE = path.join(ROOT, "scripts", "fixtures", "screens-bridge.js");

type Platform = "macos" | "windows";

type Theme = "light" | "dark";

const USER_AGENT: Readonly<Record<Platform, string>> = {
  macos:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  windows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
};

const uuid = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const png = (n: number): string => `${uuid(n)}.png`;

// Sample windows, drawn as pages and screenshotted as fixtures

const WINDOW_CSS = `
  body { margin: 0; height: 100vh; display: flex; flex-direction: column; font: 22px/1.45 -apple-system, system-ui, sans-serif; color: #1d1d1f; background: #fff; }
  .bar { height: 52px; flex: none; background: var(--accent); display: flex; align-items: center; gap: 10px; padding: 0 20px; color: white; }
  .bar i { width: 14px; height: 14px; border-radius: 50%; background: rgb(255 255 255 / 0.55); display: inline-block; }
  .bar b { margin-left: 14px; font-weight: 600; font-size: 20px; }
  .frame { flex: 1; display: flex; min-height: 0; }
  aside { width: 230px; background: color-mix(in oklab, var(--accent) 12%, white); border-right: 1px solid #ddd; padding: 24px 18px; display: grid; align-content: start; gap: 14px; }
  aside span { height: 16px; border-radius: 8px; background: color-mix(in oklab, var(--accent) 35%, white); }
  main { flex: 1; padding: 34px 42px; overflow: hidden; }
  h2 { margin: 0 0 14px; font-size: 34px; }
  .meta { color: #6e6e73; margin-top: 0; }
  table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
  th, td { border: 1px solid #e0e0e0; padding: 10px 14px; text-align: left; }
  th { background: color-mix(in oklab, var(--accent) 18%, white); }
  tr:last-child td { font-weight: 700; background: #ffe4df; color: #b3261e; }
  .cal { display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px; }
  .cal span { padding: 12px; border-radius: 10px; background: #f2f2f4; text-align: center; color: #999; }
  .cal span.free { background: #d9f0de; color: #1d6b34; font-weight: 600; }
  ul { padding-left: 0; list-style: none; display: grid; gap: 12px; }
  li { padding: 12px 16px; border-radius: 10px; background: color-mix(in oklab, var(--accent) 16%, white); border-left: 6px solid var(--accent); }
  .plan { display: grid; grid-template-columns: 2fr 1fr; gap: 14px; height: 420px; }
  .plan span { border: 4px solid #333; border-radius: 4px; background: #fafafa; }
`;

const SAMPLE_WINDOWS = [
  {
    accent: "#1f9d55",
    app: "Numbers",
    body: `<h2>Office move budget</h2><table>${[
      ["Item", "Quote", "Cap"],
      ["Desks (12)", "CHF 9,840", "CHF 10,000"],
      ["Chairs (12)", "CHF 5,280", "CHF 5,000"],
      ["Delivery", "CHF 980", "CHF 0"],
      ["Total", "CHF 18,260", "CHF 18,000"],
    ]
      .map(
        (row, index) =>
          `<tr>${row.map((cell) => (index === 0 ? `<th>${cell}</th>` : `<td>${cell}</td>`)).join("")}</tr>`
      )
      .join("")}</table>`,
    n: 101,
    title: "Office move budget",
  },
  {
    accent: "#1f6feb",
    app: "Mail",
    body: `<h2>Quote 2026-114: office furniture</h2><p class="meta">Rieder Möbel AG · 2 Nov</p><p>Dear Ms Keller,</p><p>Thank you for your enquiry. Please find our quote for 12 desks, 12 chairs and shelving attached. Delivery is possible from 24 November at the earliest.</p>`,
    n: 102,
    title: "Quote 2026-114 from Rieder Möbel",
  },
  {
    accent: "#0a84ff",
    app: "Safari",
    body: `<h2>Delivery dates</h2><div class="cal">${Array.from(
      { length: 30 },
      (_, day) =>
        `<span class="${day + 1 >= 24 ? "free" : ""}">${day + 1}</span>`
    ).join("")}</div>`,
    n: 103,
    title: "rieder-moebel.ch: Delivery",
  },
  {
    accent: "#e8453c",
    app: "Calendar",
    body: `<h2>Week 47</h2><ul><li>Mon 17 · Movers book the lift</li><li>Thu 20 · Keys for the new floor</li><li>Fri 21 · Team moves in</li></ul>`,
    n: 104,
    title: "Calendar: November",
  },
  {
    accent: "#8e5cd9",
    app: "Preview",
    body: `<h2>Floor plan, level 3</h2><div class="plan"><span></span><span></span><span></span><span></span></div>`,
    n: 105,
    title: "floor-plan-level-3.pdf",
  },
] as const;

const LOGIN_PAGE = `
  <style>
    body { margin: 0; height: 100vh; display: grid; place-items: center; font: 15px/1.4 -apple-system, system-ui, sans-serif; background: linear-gradient(135deg, #eef2f7, #dfe7f1); }
    form { width: 340px; background: white; border-radius: 14px; padding: 28px; box-shadow: 0 10px 30px rgb(0 0 0 / 0.12); display: grid; gap: 12px; }
    h1 { margin: 0 0 6px; font-size: 22px; }
    label { font-size: 12px; color: #555; }
    input { height: 34px; border: 1px solid #ccd; border-radius: 8px; padding: 0 10px; font: inherit; }
    .error { color: #c62828; font-size: 12px; margin-top: -4px; }
    button { height: 38px; border: 0; border-radius: 8px; background: #1f6feb; color: white; font: 600 15px/1 inherit; margin-top: 18px; }
  </style>
  <form><h1>Sign in</h1><label>Email<br><input value="anna@keller.ch"></label><label>Password<br><input type="password" value="secret"></label><div class="error">Something went wrong</div><button>Sign in</button></form>`;

const LOGIN = {
  file: png(201),
  heightPx: 1200,
  pixelsPerDip: 2,
  widthPx: 1920,
};

const renderFixtures = async (browser: Browser): Promise<void> => {
  await mkdir(FIXTURES, { recursive: true });

  await Promise.all(
    SAMPLE_WINDOWS.map(async (win) => {
      const page = await browser.newPage({
        viewport: { height: 720, width: 1152 },
      });

      await page.setContent(
        `<style>${WINDOW_CSS}</style><body style="--accent: ${win.accent}"><div class="bar"><i></i><i></i><i></i><b>${win.app} · ${win.title}</b></div><div class="frame"><aside>${"<span></span>".repeat(6)}</aside><main>${win.body}</main></div></body>`
      );
      await page.screenshot({ path: path.join(FIXTURES, png(win.n)) });
      await page.close();
    })
  );

  const login = await browser.newPage({
    deviceScaleFactor: 2,
    viewport: { height: 600, width: 960 },
  });

  await login.setContent(LOGIN_PAGE);
  await login.screenshot({ path: path.join(FIXTURES, LOGIN.file) });
  await login.close();
};

// The shelf's sample document

const now = new Date();

const isoDay = (offset: number): string => {
  const day = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + offset
  );

  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
};

const ago = (minutes: number): string =>
  new Date(now.getTime() - minutes * 60_000).toISOString();

const windowRef = (index: number, description = "") => {
  const win = SAMPLE_WINDOWS[index] ?? SAMPLE_WINDOWS[0];

  return {
    app: win.app,
    appPath: `/Applications/${win.app}.app`,
    capturedAt: ago(30),
    description,
    document:
      win.app === "Numbers" || win.app === "Preview"
        ? `/Users/anna/Documents/${win.title}`
        : null,
    id: uuid(300 + index),
    thumb: { file: png(win.n), heightPx: 720, pixelsPerDip: 1, widthPx: 1152 },
    title: win.title,
    url: win.app === "Safari" ? "https://rieder-moebel.ch/delivery" : null,
  };
};

const OFFICE = uuid(1);
const INBOX = uuid(2);
const LATER = uuid(3);

const META = { description: "", due: null, steps: [], windows: [] };

const step = (n: number, text: string, done = false) => ({
  done,
  id: uuid(400 + n),
  text,
});

const base = (n: number, minutes: number, section = OFFICE) => ({
  ...META,
  color: null,
  context: null,
  createdAt: ago(minutes),
  done: false,
  id: uuid(n),
  sectionId: section,
});

/** The item with every field filled in and a long text: the layout check. */
const FULL = {
  ...base(10, 50),
  color: "orange",
  context: {
    app: "Mail",
    appLink: null,
    title:
      "Quote 2026-114 from Rieder Möbel — office furniture for the third floor",
    url: "https://rieder-moebel.ch/quotes/2026-114-office-furniture-third-floor",
  },
  description:
    "Chairs are CHF 280 over and delivery adds CHF 980 we never planned for. Marco signs off on anything above the cap.",
  due: isoDay(0),
  html: null,
  kind: "text",
  links: [],
  steps: [
    step(1, "Ask Rieder whether 21 November is possible", true),
    step(2, "Get a second quote for the chairs", true),
    step(3, "Tell Marco the cap needs CHF 260 more"),
    step(4, "Book the lift for the delivery day"),
    step(5, "Send the floor plan to the movers"),
  ],
  text: "Rieder’s quote breaks the furniture cap and arrives three days after the team moves in, so we need a second quote before Marco signs anything",
  via: "selection",
  windows: [
    windowRef(0, "The total is CHF 260 over the cap"),
    windowRef(1),
    windowRef(2),
  ],
};

const IMAGE = {
  ...base(11, 40),
  due: isoDay(-2),
  image: LOGIN,
  kind: "image",
  description:
    "Design review found three problems on the sign-in screen. All three block the release build.",
  note: "Spacing, the button and the error text",
  pins: [
    { label: "Title too close to the field", x: 760, y: 380 },
    { label: "Error text says nothing useful", x: 820, y: 780 },
    { x: 1210, y: 900 },
  ],
  source: "Built-in Retina Display",
  steps: [step(6, "File the bug", true), step(7, "Ask design about spacing")],
  title: "Login screen: three things to fix before release",
  via: "screenshot",
  windows: [windowRef(2), windowRef(3)],
};

const ITEMS = [
  FULL,
  IMAGE,
  {
    ...base(12, 30),
    due: isoDay(1),
    html: null,
    kind: "text",
    links: [],
    text: "Book the movers for Monday",
    via: "typed",
  },
  {
    ...base(13, 25),
    file: {
      bytes: 2_480_000,
      name: "floor-plan-level-3.pdf",
      stored: `${uuid(500)}.pdf`,
    },
    kind: "file",
    note: "",
    title: "Floor plan, level 3",
    windows: [windowRef(4)],
  },
  {
    ...base(14, 20),
    context: {
      app: "Safari",
      appLink: null,
      title: "Fix flaky upload test · Pull Request #482 · inset/shelf",
      url: "https://github.com/inset/shelf/pull/482",
    },
    html: null,
    kind: "text",
    links: [],
    steps: [
      step(8, "Reproduce"),
      step(9, "Add a retry"),
      step(10, "Ask for review"),
    ],
    text: "The upload test fails one run in ten on CI",
    via: "selection",
  },
  {
    ...base(15, 15),
    done: true,
    html: null,
    kind: "text",
    links: [],
    text: "Ask building management for early keys",
    via: "typed",
  },
  {
    ...base(16, 10, INBOX),
    due: isoDay(5),
    html: null,
    kind: "text",
    links: [],
    text: "Call Marco about the **budget cap**",
    via: "typed",
  },
];

const DOC = {
  activeSectionId: OFFICE,
  items: ITEMS,
  schemaVersion: 3,
  sections: [
    { id: OFFICE, name: "Office move" },
    { id: INBOX, name: "Inbox" },
    { id: LATER, name: "Later" },
  ],
};

const STATUS = {
  floatOnTop: true,
  keys: "granted",
  problem: null,
  quitPrompt: null,
  readOnly: false,
  saveError: null,
  selectionCapture: true,
};

type ShelfFixture = typeof DOC | typeof EMPTY_DOC;

const shelfView = (doc: ShelfFixture = DOC) => ({
  canUndo: false,
  doc,
  focus: null,
  status: STATUS,
});

const EMPTY_DOC = {
  activeSectionId: INBOX,
  items: [],
  schemaVersion: 3,
  sections: [{ id: INBOX, name: "Inbox" }],
};

const CANDIDATES = SAMPLE_WINDOWS.map((win, index) => ({
  app: win.app,
  id: uuid(600 + index),
  thumb: `/.fixtures/${png(win.n)}`,
  title: win.title,
}));

type PickerState =
  | { readonly kind: "ready"; readonly candidates: typeof CANDIDATES }
  | { readonly kind: "permission" }
  | { readonly kind: "loading" };

type PickerTarget =
  | { readonly kind: "new" }
  | { readonly kind: "item"; readonly label: string };

const NEW_LINK: PickerTarget = { kind: "new" };

const pickerView = (state: PickerState, target: PickerTarget = NEW_LINK) => ({
  linking: false,
  seq: 1,
  state,
  target,
});

interface FixturePin {
  readonly x: number;
  readonly y: number;
  readonly label?: string;
}

const drawingView = (pins: readonly FixturePin[], pinMode: boolean) => ({
  image: {
    heightPx: LOGIN.heightPx,
    pinMode,
    pins,
    pixelsPerDip: LOGIN.pixelsPerDip,
    url: `/.fixtures/${LOGIN.file}`,
    widthPx: LOGIN.widthPx,
  },
  seq: 1,
});

// Scenes

type PageName = "shelf" | "picker" | "drawing";

interface Scene {
  readonly name: string;
  readonly page: PageName;
  readonly data: object;
  readonly platforms?: readonly Platform[];
  /** The window's width, where it differs from the page's usual size: the shelf's narrowest is 300. */
  readonly width?: number;
  /** Fails the scene when anything in the list or details overflows or wraps badly. */
  readonly layoutCheck?: boolean;
  readonly act?: (page: Page) => Promise<void>;
  /** Runs after the screenshot: what went wrong, or null. */
  readonly check?: (page: Page) => Promise<string | null>;
}

const AppliedSchema = z.array(
  z.looseObject({ text: z.string().optional(), type: z.string() })
);

/** The operations the page sent to the fake main process so far. */
const applied = async (page: Page) =>
  AppliedSchema.parse(
    JSON.parse(
      String(await page.evaluate("JSON.stringify(globalThis.__applied)"))
    )
  );

const item = (page: Page, n: number) =>
  page.locator(`[data-item-id="${uuid(n)}"]`);

/** Selects an item as a click does, on its words. */
const select = async (page: Page, n: number): Promise<void> => {
  await item(page, n).locator("button:not([role=checkbox])").first().click();
};

const details = async (page: Page, n: number): Promise<void> => {
  await select(page, n);
  await page.keyboard.press("ArrowRight");
  await page.getByRole("button", { name: "Back to the list" }).waitFor();
};

/** The drawing window's pins, and the one selected. */
const drawingPins = (page: Page) => page.locator("span[style*='--pin-x']");

const selectedPin = (page: Page) => page.locator(".pin-selected");

/** The row's remove ops sent so far. */
const removes = async (page: Page): Promise<number> => {
  const ops = await applied(page);

  return ops.filter((op) => op.type === "remove").length;
};

const CallsSchema = z.array(z.object({ arg: z.unknown(), call: z.string() }));

/** What the page asked the fake main process for so far, in order: operations, copies, opens. */
const calls = async (page: Page, from = 0) => {
  const all = CallsSchema.parse(
    JSON.parse(
      String(await page.evaluate("JSON.stringify(globalThis.__calls)"))
    )
  );

  return all.slice(from);
};

const FocusSchema = z.object({
  onRow: z.boolean(),
  row: z.string().nullable(),
  tag: z.string(),
});

/** The item focus is in, and whether it is on the item itself rather than a control inside it. */
const focused = async (page: Page) =>
  FocusSchema.parse(
    await page.evaluate(`(() => {
      const active = document.activeElement;

      return {
        onRow: active?.hasAttribute("data-row-keys") ?? false,
        row: active?.closest("[data-item-id]")?.getAttribute("data-item-id") ?? null,
        tag: active?.tagName ?? "",
      };
    })()`)
  );

/** The command key the page reads: ⌘ on a Mac, Ctrl elsewhere. */
const commandKey = async (page: Page): Promise<"Meta" | "Control"> => {
  const mac = await page.evaluate("navigator.userAgent.includes('Mac')");

  return mac === true ? "Meta" : "Control";
};

/** How many calls the page has made so far. */
const callCount = async (page: Page): Promise<number> =>
  Number(await page.evaluate("globalThis.__calls.length"));

/** Right-clicks an item's words, as a user opens its menu. */
const openMenuOn = async (page: Page, n: number): Promise<void> => {
  await item(page, n)
    .locator("[data-row-keys]")
    .first()
    .click({ button: "right" });
  await page.getByRole("menu").waitFor();
};

/** The menu has faded out and handed focus back. */
const menuClosed = async (page: Page): Promise<void> => {
  await page.getByRole("menu").waitFor({ state: "detached" });
  await page.waitForTimeout(150);
};

/** The longest Due chip there is, overdue since last year, on items with every badge and a long source. */
const NARROW_DOC = {
  ...DOC,
  items: [
    { ...FULL, due: isoDay(-400) },
    { ...IMAGE, due: isoDay(-400) },
    ...ITEMS.flatMap((entry) =>
      entry.id === uuid(13) ? [{ ...entry, due: isoDay(-400) }] : []
    ),
    ...ITEMS.filter((entry) => entry.id === uuid(14)),
  ],
};

/** A short list, so every row stays clear of the toasts at the bottom. */
const MENU_DOC = {
  ...DOC,
  items: [12, 14, 13, 15].flatMap((n) =>
    ITEMS.filter((entry) => entry.id === uuid(n))
  ),
};

/** Item A is the open entry; item B is the row whose menu is open; C is picked with A. */
const ENTRY_A = 12;
const ROW_B = 14;
const ROW_C = 13;

/** Opens entry A with focus on it, then B's menu, as in Sol's round 3 report. */
const openAThenMenuOnB = async (page: Page): Promise<void> => {
  await select(page, ENTRY_A);
  await item(page, ENTRY_A).locator("[data-row-keys]").first().focus();
  await openMenuOn(page, ROW_B);
};

/** A command main sends when a menu bar item runs (src/shared/contracts.ts ShelfCommand). */
interface MenuCommand {
  readonly kind: "copy" | "item";
  readonly action?: "copyDetails" | "copyList" | "copyWithLink" | "open";
}

interface MenuStep {
  readonly name: string;
  readonly run: (page: Page) => Promise<void>;
  /** What the page asks main for, exactly and in order. */
  readonly sends: readonly unknown[];
  /** After a delete, focus belongs on the item selected next, once main's late view has removed the row. */
  readonly focus?: "selected";
}

/** A step that presses a key. */
const pressing = (combo: string) => async (on: Page) => {
  await on.keyboard.press(combo);
};

const ACTIVE_ENTRY =
  "document.activeElement?.getAttribute('role') === 'menuitem' ? document.activeElement.textContent : ''";

/**
 * Moves the menu's highlight down to the entry named, as a keyboard user
 * does. The menu moves its highlight a moment after each ↓, so each step
 * waits for it.
 */
const walkTo = async (on: Page, name: string): Promise<void> => {
  let label = String(await on.evaluate(ACTIVE_ENTRY));

  while (!label.startsWith(name)) {
    const was = label;

    // oxlint-disable-next-line no-await-in-loop -- one key after another, on purpose.
    await on.keyboard.press("ArrowDown");
    // oxlint-disable-next-line no-await-in-loop -- the highlight moves after the key.
    await on.waitForFunction(
      `(${ACTIVE_ENTRY}) !== ${JSON.stringify(was)}`,
      undefined,
      {
        timeout: 1000,
      }
    );
    // oxlint-disable-next-line no-await-in-loop -- read after each key.
    label = String(await on.evaluate(ACTIVE_ENTRY));
  }
};

/** A step that highlights the entry named, then presses `key` there. */
const onEntry = (name: string, key: string) => async (on: Page) => {
  await walkTo(on, name);
  await on.keyboard.press(key);
};

/** A step that runs a menu bar command, as main sends it. */
const command = (payload: MenuCommand) => async (on: Page) => {
  await on.evaluate(`globalThis.__emit("command", ${JSON.stringify(payload)})`);
};

const selectedRow = async (page: Page): Promise<string | null> =>
  z
    .string()
    .nullable()
    .parse(
      await page.evaluate(
        `document.querySelector('[data-item-id][aria-current="true"]')?.getAttribute("data-item-id") ?? null`
      )
    );

/**
 * Opens a menu, runs one step, and checks what the page sent and where
 * focus is once the menu has gone, step by step: what went wrong, or null.
 */
const runMenuSteps = async (
  page: Page,
  steps: readonly MenuStep[],
  menu: {
    readonly open: () => Promise<void>;
    readonly owner: string;
    readonly name: string;
  }
): Promise<string | null> => {
  for (const menuStep of steps) {
    // oxlint-disable-next-line no-await-in-loop -- one step after another, on purpose.
    await menu.open();
    // oxlint-disable-next-line no-await-in-loop -- counted before the menuStep.
    const before = await callCount(page);
    // oxlint-disable-next-line no-await-in-loop -- one step after another, on purpose.
    await menuStep.run(page);
    // oxlint-disable-next-line no-await-in-loop -- the menu must be gone before focus is read.
    await menuClosed(page);
    // oxlint-disable-next-line no-await-in-loop -- read after the menuStep.
    const sent = await calls(page, before);

    if (!isDeepStrictEqual(sent, menuStep.sends)) {
      return `${menuStep.name} in ${menu.name} sent ${JSON.stringify(sent)}, not ${JSON.stringify(menuStep.sends)}`;
    }

    if (menuStep.focus === "selected") {
      // oxlint-disable-next-line no-await-in-loop -- main's view arrives 250 ms late.
      await page.waitForTimeout(300);
    }

    const want =
      menuStep.focus === "selected"
        ? // oxlint-disable-next-line no-await-in-loop -- read after the menuStep.
          await selectedRow(page)
        : menu.owner;

    // oxlint-disable-next-line no-await-in-loop -- read after the menuStep.
    const focus = await focused(page);

    if (want === null || focus.row !== want || !focus.onRow) {
      return `after ${menuStep.name} in ${menu.name}, focus is on ${focus.tag} in ${focus.row ?? "no item"}, not on the row ${want ?? "selected"}`;
    }
  }

  return null;
};

/** → in B's menu opens B's details, and Back returns focus to B. */
const detailsFromMenu = async (page: Page): Promise<string | null> => {
  await openAThenMenuOnB(page);
  await page.keyboard.press("ArrowRight");
  await page.getByRole("button", { name: "Back to the list" }).waitFor();

  const shown = (await page.locator("[data-details]").textContent()) ?? "";

  if (!shown.includes("The upload test fails")) {
    return "→ with B's menu open showed details for another item";
  }

  await page.getByRole("button", { name: "Back to the list" }).click();
  await page.waitForTimeout(150);

  const focus = await focused(page);

  return focus.row === uuid(ROW_B) && focus.onRow
    ? null
    : `after → and Back, focus is on ${focus.tag} in ${focus.row ?? "no item"}, not on B`;
};

/** → on "Move to ›" opens its list rather than B's details; ← goes back. */
const moveToArrows = async (page: Page): Promise<string | null> => {
  await openAThenMenuOnB(page);
  await page.getByRole("menuitem", { name: "Move to" }).hover();
  await page.keyboard.press("ArrowRight");

  const opened = await page.getByRole("menuitem", { name: "Back" }).count();

  await page.keyboard.press("ArrowLeft");

  const closedAgain = await page
    .getByRole("menuitem", { name: "Move to" })
    .count();

  await page.keyboard.press("Escape");
  await menuClosed(page);

  return opened === 1 && closedAgain === 1
    ? null
    : `→ and ← on “Move to” showed the sections ${opened} times and the menu again ${closedAgain} times`;
};

/** The operations the shelf sends for ⌫ and Space on an item. */
const removing = (id: string) => ({
  arg: { id, type: "remove" },
  call: "apply",
});

const toggling = (id: string) => ({
  arg: { id, type: "toggleDone" },
  call: "apply",
});

/**
 * Round 4: a row's menu belongs to its row. Each step opens entry A, then
 * row B's menu, and runs a key or a menu bar command. It asserts what the
 * page asked main for, then where focus is once the menu is gone. Then the
 * same for the menu of A and C picked together.
 */
const menuOwnershipCheck = async (page: Page): Promise<string | null> => {
  const mod = await commandKey(page);
  const a = uuid(ENTRY_A);
  const b = uuid(ROW_B);
  const c = uuid(ROW_C);

  const onB = {
    name: "B's menu over A",
    open: async () => {
      await openAThenMenuOnB(page);
    },
    owner: b,
  };

  const onPicked = {
    name: "the menu for A and C",
    open: async () => {
      await openMenuOn(page, ROW_C);
    },
    owner: c,
  };

  const phases: readonly (() => Promise<string | null>)[] = [
    // The scene left B's menu open over the open entry A.
    async () =>
      await runMenuSteps(
        page,
        [{ name: "Escape", run: pressing("Escape"), sends: [] }],
        {
          ...onB,
          open: async () => {
            await page.getByRole("menu").waitFor();
          },
        }
      ),
    async () =>
      await runMenuSteps(
        page,
        [
          {
            name: `${mod}+C`,
            run: pressing(`${mod}+c`),
            sends: [{ arg: b, call: "copy" }],
          },
          {
            name: `Alt+${mod}+C`,
            run: pressing(`Alt+${mod}+c`),
            sends: [{ arg: b, call: "copyDetails" }],
          },
          // Return and Space choose the highlighted entry, for B.
          {
            name: "↓ and Space on Copy",
            run: onEntry("Copy", "Space"),
            sends: [{ arg: b, call: "copy" }],
          },
          {
            name: "↓ and Return on Copy",
            run: onEntry("Copy", "Enter"),
            sends: [{ arg: b, call: "copy" }],
          },
          {
            name: "Space on Check Off",
            run: onEntry("Check Off", "Space"),
            sends: [toggling(b)],
          },
          {
            name: "Space on a section in Move to",
            run: async (on) => {
              await onEntry("Move to", "ArrowRight")(on);
              await onEntry("Later", "Space")(on);
            },
            sends: [
              {
                arg: { id: b, sectionId: LATER, type: "moveItem" },
                call: "apply",
              },
            ],
          },
          {
            name: `${mod}+C on the Move to list`,
            run: async (on) => {
              await onEntry("Move to", "ArrowRight")(on);
              await on.keyboard.press(`${mod}+c`);
            },
            sends: [{ arg: b, call: "copy" }],
          },
          {
            name: `${mod}+O`,
            run: pressing(`${mod}+o`),
            sends: [{ arg: { id: b }, call: "openLink" }],
          },
          { name: "Escape", run: pressing("Escape"), sends: [] },
          // The menu bar's own keys: Edit › Copy on a Mac; on Windows main answers Ctrl+Alt+C and Ctrl+O before the page.
          {
            name: "Edit › Copy",
            run: command({ kind: "copy" }),
            sends: [{ arg: b, call: "copy" }],
          },
          {
            name: "Edit › Copy with Details",
            run: command({ action: "copyDetails", kind: "item" }),
            sends: [{ arg: b, call: "copyDetails" }],
          },
          {
            name: "Item › Open",
            run: command({ action: "open", kind: "item" }),
            sends: [{ arg: { id: b }, call: "openLink" }],
          },
        ],
        onB
      ),
    async () => await detailsFromMenu(page),
    async () => await moveToArrows(page),
    // Main's view arrives late here, so B is still listed when the menu has gone.
    async () =>
      await runMenuSteps(
        page,
        [
          {
            focus: "selected",
            name: "Backspace",
            run: pressing("Backspace"),
            sends: [removing(b)],
          },
        ],
        onB
      ),
    // ⇧-click picks A and C, as ⌃-click is a right-click on a Mac.
    async () => {
      await select(page, ENTRY_A);
      await item(page, ROW_C)
        .locator("[data-row-keys]")
        .first()
        .click({ modifiers: ["Shift"] });

      return await runMenuSteps(
        page,
        [
          {
            name: `Shift+${mod}+C`,
            run: pressing(`Shift+${mod}+c`),
            sends: [{ arg: [a, c], call: "copyList" }],
          },
          {
            name: "Space on Check Off All",
            run: onEntry("Check Off All", "Space"),
            sends: [toggling(a), toggling(c)],
          },
          {
            name: "Item › Copy as List",
            run: command({ action: "copyList", kind: "item" }),
            sends: [{ arg: [a, c], call: "copyList" }],
          },
          { name: "Escape", run: pressing("Escape"), sends: [] },
          {
            focus: "selected",
            name: "Backspace",
            run: pressing("Backspace"),
            sends: [removing(a), removing(c)],
          },
        ],
        onPicked
      );
    },
  ];

  for (const phase of phases) {
    // oxlint-disable-next-line no-await-in-loop -- one phase after another, on purpose.
    const failed = await phase();

    if (failed !== null) {
      return failed;
    }
  }

  return null;
};

/** Opens entry A's text for editing and types into it, without leaving the field. */
const typeInEntryA = async (page: Page): Promise<void> => {
  await select(page, ENTRY_A);
  await page.keyboard.press("Enter");
  await item(page, ENTRY_A)
    .getByRole("textbox", { name: "Edit item" })
    .waitFor();
  await page.waitForFunction(
    "document.activeElement?.getAttribute('aria-label') === 'Edit item'"
  );
  await page.keyboard.press("End");
  await page.keyboard.type(" at 9");
};

/** With A's edit still being typed (the scene's act), A's menu copies the edited words. */
const pendingEditCheck = async (page: Page): Promise<string | null> => {
  const mod = await commandKey(page);
  const a = uuid(ENTRY_A);
  const before = await callCount(page);

  // On the card's edge, outside the text being edited.
  await item(page, ENTRY_A).click({
    button: "right",
    position: { x: 4, y: 4 },
  });
  await page.getByRole("menu").waitFor();
  await page.keyboard.press(`${mod}+c`);
  await menuClosed(page);

  const sent = await calls(page, before);

  const want = [
    {
      arg: { id: a, text: "Book the movers for Monday at 9", type: "editText" },
      call: "apply",
    },
    { arg: a, call: "copy" },
  ];

  return isDeepStrictEqual(sent, want)
    ? null
    : `copying an item being edited sent ${JSON.stringify(sent)}, not the edit and then the copy`;
};

/** Watches each key press: whether something called preventDefault, and whether it got past the page's own handlers to the window. */
const WATCH_KEYS = `(() => {
  globalThis.__keys = [];
  const reached = new WeakSet();

  window.addEventListener("keydown", (event) => {
    reached.add(event);
  });
  window.addEventListener("keydown", (event) => {
    const entry = { key: event.key, prevented: false, reached: false };

    globalThis.__keys.push(entry);
    setTimeout(() => {
      entry.prevented = event.defaultPrevented;
      entry.reached = reached.has(event);
    });
  }, true);
})()`;

const KeysSchema = z.array(
  z.object({ key: z.string(), prevented: z.boolean(), reached: z.boolean() })
);

const MenuOpenSchema = z.array(z.boolean());

/** What the page last told main: a menu is open (true), or none is. */
const menuSignal = async (page: Page): Promise<boolean | undefined> =>
  MenuOpenSchema.parse(await page.evaluate("globalThis.__menuOpen")).at(-1);

/** A menu closes when the window loses focus, and the page tells main, which forgets it on blur as well. */
const blurClosesMenuCheck = async (page: Page): Promise<string | null> => {
  await openMenuOn(page, ROW_C);

  if ((await menuSignal(page)) !== true) {
    return "the page didn't tell main that C's menu is open";
  }

  await page.evaluate('window.dispatchEvent(new Event("blur"))');
  await menuClosed(page);

  return (await menuSignal(page)) === false
    ? null
    : "C's menu closed as the window lost focus, but the page didn't tell main";
};

/**
 * Presses a key the open menu doesn't show: nothing may run, the menu stays
 * open, and the key must be held back from the page (preventDefault, so the
 * menu bar's Copy and the rest stay quiet) and from the window's handlers.
 */
const swallows = async (
  page: Page,
  combo: string,
  where: string
): Promise<string | null> => {
  const before = await callCount(page);

  await page.evaluate("globalThis.__keys.length = 0");
  await page.keyboard.press(combo);
  await page.waitForTimeout(120);

  // The modifiers go down first; the key itself is the last press.
  const pressed = KeysSchema.parse(await page.evaluate("globalThis.__keys")).at(
    -1
  );

  const sent = await calls(page, before);
  const menus = await page.getByRole("menu").count();
  const detailsOpen = await page.locator("[data-details-view]").count();

  if (sent.length > 0) {
    return `${combo} in ${where} sent ${JSON.stringify(sent)}`;
  }

  if (menus !== 1) {
    return `${combo} in ${where} closed the menu`;
  }

  if (pressed === undefined || !pressed.prevented || pressed.reached) {
    return `${combo} in ${where} reached the page (${JSON.stringify(pressed)})`;
  }

  return where === "B's menu" && detailsOpen > 0
    ? `${combo} in B's menu opened details`
    : null;
};

/**
 * Round 5: keys a menu doesn't show never reach the page under it. With
 * entry A open and B's menu open, the field keys, Undo, Find, Select All and
 * the rest do nothing, and the menu stays. The page tells main a menu is
 * open meanwhile, so main holds back the menu bar's keys on Windows too.
 */
const swallowedKeysCheck = async (page: Page): Promise<string | null> => {
  const mod = await commandKey(page);

  await page.evaluate(WATCH_KEYS);
  await openAThenMenuOnB(page);

  if ((await menuSignal(page)) !== true) {
    return "the page didn't tell main that B's menu is open";
  }

  const keys = [
    `Shift+${mod}+d`,
    `${mod}+d`,
    `Shift+${mod}+s`,
    `${mod}+z`,
    `${mod}+f`,
    `${mod}+a`,
    `Shift+${mod}+n`,
    `${mod}+/`,
    `Alt+${mod}+ArrowDown`,
  ];

  for (const combo of keys) {
    // oxlint-disable-next-line no-await-in-loop -- one key after another, on purpose.
    const failed = await swallows(page, combo, "B's menu");

    if (failed !== null) {
      return failed;
    }
  }

  await page.keyboard.press("Escape");
  await menuClosed(page);

  const focus = await focused(page);

  if (focus.row !== uuid(ROW_B) || !focus.onRow) {
    return `after the held-back keys and Esc, focus is on ${focus.tag} in ${focus.row ?? "no item"}, not on B`;
  }

  return (await menuSignal(page)) === false
    ? null
    : "the page didn't tell main that the last menu closed";
};

/**
 * The other menus answer the keys they show, and only those: the ⋯ at the
 * top, the details header's ⋯ (⌥⌘C on the open item), details' Add… and the
 * note field's +.
 */
const otherMenusCheck = async (page: Page): Promise<string | null> => {
  const mod = await commandKey(page);
  const b = uuid(ROW_B);

  await page.evaluate(WATCH_KEYS);
  await page.locator("header").getByRole("button", { name: "More" }).click();
  await page.getByRole("menu").waitFor();

  const copyInTopMenu = await swallows(page, `${mod}+c`, "the ⋯ at the top");

  if (copyInTopMenu !== null) {
    return copyInTopMenu;
  }

  await page.keyboard.press(`Shift+${mod}+n`);
  await menuClosed(page);

  const naming = await page.evaluate(
    "document.activeElement?.getAttribute('aria-label')"
  );

  if (naming !== "New section name") {
    return `⇧${mod}N in the ⋯ at the top left focus on ${String(naming)}, not the new section's name`;
  }

  await page.keyboard.press("Escape");
  await details(page, ROW_B);

  let before = await callCount(page);

  await page
    .locator("[data-details-view]")
    .getByRole("button", { exact: true, name: "More" })
    .click();
  await page.getByRole("menu").waitFor();
  await page.keyboard.press(`Alt+${mod}+c`);
  await menuClosed(page);

  const fromDetailsMenu = await calls(page, before);

  if (!isDeepStrictEqual(fromDetailsMenu, [{ arg: b, call: "copyDetails" }])) {
    return `Alt+${mod}+C in the details ⋯ sent ${JSON.stringify(fromDetailsMenu)}, not copyDetails(B)`;
  }

  await page.getByRole("button", { name: "Add a field" }).click();
  await page.getByRole("menu").waitFor();
  await page.keyboard.press(`${mod}+d`);
  await menuClosed(page);

  const field = await page.evaluate(
    "document.activeElement?.closest('[aria-label]')?.getAttribute('aria-label')"
  );

  if (field !== "Description") {
    return `${mod}+D in details' Add… left focus on ${String(field)}, not the description`;
  }

  await page.getByRole("button", { name: "Back to the list" }).click();
  await page.waitForTimeout(150);
  before = await callCount(page);
  await page.getByRole("button", { exact: true, name: "Add" }).click();
  await page.getByRole("menu").waitFor();
  await page.keyboard.press(`Shift+${mod}+l`);
  await menuClosed(page);

  const afterAdd = await calls(page, before);
  const fromAddMenu = afterAdd.map((call) => call.call);

  return isDeepStrictEqual(fromAddMenu, ["newWindowLink"])
    ? null
    : `Shift+${mod}+L in the note field's + sent ${JSON.stringify(fromAddMenu)}, not newWindowLink`;
};

/** A step that clicks the first menu entry whose name starts so: "Copy" is the entry above "Copy with Details". */
const clickEntry = (name: string) => async (on: Page) => {
  await on
    .getByRole("menuitem", { name: new RegExp(`^${name}`, "u") })
    .first()
    .click();
};

/** Picks A and C, with ⇧-click, as ⌃-click is a right-click on a Mac. */
const pickAAndC = async (page: Page): Promise<void> => {
  await select(page, ENTRY_A);
  await item(page, ROW_C)
    .locator("[data-row-keys]")
    .first()
    .click({ modifiers: ["Shift"] });
};

/** Main's message when the shelf can't be saved: the banner shows it, and every copy is refused with it. */
const SAVE_FAILED =
  "The shelf could not be saved: ENOSPC: no space left on device, write";

const NOT_COPIED = `Not copied. ${SAVE_FAILED}`;

const DRAFT_DESCRIPTION = "Keys from the caretaker";
const DRAFT_TEXT = "The upload test fails one run in ten on CI today";

/**
 * With saves failing, types a description into A's details and goes back,
 * then edits B's words in its row and picks C, then opens A's details again.
 * The shelf's drafts live in main, so each edit must reach it as it is left.
 */
const keepDraftsAct = async (page: Page): Promise<void> => {
  await details(page, ENTRY_A);
  await page.getByRole("button", { name: "Add a field" }).click();
  await page.getByRole("menuitem", { name: /^Description/u }).click();
  await page.getByRole("textbox", { name: "Description" }).waitFor();
  await page.keyboard.type(DRAFT_DESCRIPTION);
  await page.getByRole("button", { name: "Back to the list" }).click();
  await select(page, ROW_B);
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    "document.activeElement?.getAttribute('aria-label') === 'Edit item'"
  );
  await page.keyboard.press("End");
  await page.keyboard.type(" today");
  await select(page, ROW_C);
  // Main echoes each edit back a moment later (`echo: "later"`).
  await page.waitForTimeout(400);
  await details(page, ENTRY_A);
};

const keepDraftsCheck = async (page: Page): Promise<string | null> => {
  const description = await page
    .getByRole("textbox", { name: "Description" })
    .inputValue();

  if (description !== DRAFT_DESCRIPTION) {
    return `A's details show ${JSON.stringify(description)} after leaving them with saves failing, not the description typed`;
  }

  if (
    !(await page
      .locator("[data-details-view]")
      .getByText("Not saved to disk")
      .isVisible())
  ) {
    return "A's details, opened again with saves failing, don't say the shelf isn't saved";
  }

  await page.getByRole("button", { name: "Back to the list" }).click();

  const b = (await item(page, ROW_B).textContent()) ?? "";

  if (!b.includes(DRAFT_TEXT)) {
    return `B's row reads ${JSON.stringify(b)} after its edit was left, not ${JSON.stringify(DRAFT_TEXT)}`;
  }

  const before = await callCount(page);

  await page.getByRole("button", { exact: true, name: "Retry" }).click();
  await page.getByText(`Still not saved. ${SAVE_FAILED}`).waitFor();

  const sent = await calls(page, before);
  const retried = sent.map((call) => call.call);

  return isDeepStrictEqual(retried, ["retrySave"])
    ? null
    : `Retry in the banner sent ${JSON.stringify(retried)}, not retrySave`;
};

/** Main's view once a quit is held: the shelf as it was, with the prompt. */
const QUIT_HELD_VIEW = {
  ...shelfView(MENU_DOC),
  status: {
    ...STATUS,
    quitPrompt: { count: 2, message: SAVE_FAILED, state: "asking" },
    saveError: SAVE_FAILED,
  },
};

/** B is picked when Quit is held, as when the shelf is in use. */
const quitHeldAct = async (page: Page): Promise<void> => {
  await select(page, ROW_B);
  await page.evaluate(
    `globalThis.__emit("view", ${JSON.stringify(QUIT_HELD_VIEW)})`
  );
  await page.getByRole("alertdialog").waitFor();
};

const QuitLayoutSchema = z.object({
  focused: z.string(),
  inside: z.boolean(),
  overflowing: z.array(z.string()),
});

/**
 * Round 6b: Retry has the keyboard, every button fits at the shelf's
 * narrowest, Return retries even from Quit without saving, Esc cancels,
 * and the list behind keeps its keys: → doesn't open the picked item's
 * details.
 */
const quitHeldCheck = async (page: Page): Promise<string | null> => {
  const layout = QuitLayoutSchema.parse(
    await page.evaluate(`(() => {
      const dialog = document.querySelector("[role=alertdialog]");
      const box = dialog.getBoundingClientRect();

      return {
        focused: document.activeElement?.textContent ?? "",
        inside: box.left >= 8 && box.right <= innerWidth - 8,
        overflowing: [...dialog.querySelectorAll("button")]
          .filter((button) => button.scrollWidth > button.clientWidth)
          .map((button) => button.textContent),
      };
    })()`)
  );

  if (layout.focused !== "Retry") {
    return `the quit prompt opened with focus on ${JSON.stringify(layout.focused)}, not Retry`;
  }

  if (!layout.inside || layout.overflowing.length > 0) {
    return `the quit prompt doesn't fit the window: inside ${layout.inside}, cut ${JSON.stringify(layout.overflowing)}`;
  }

  const before = await callCount(page);

  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");

  const sent = await calls(page, before);

  if ((await page.locator("[data-details-view]").count()) > 0) {
    return "→ in the quit prompt opened the picked item's details behind it";
  }

  return isDeepStrictEqual(sent, [
    { arg: "retry", call: "answerQuit" },
    { arg: "retry", call: "answerQuit" },
    { arg: "cancel", call: "answerQuit" },
  ])
    ? null
    : `→, Return, Tab and Return, then Esc in the quit prompt sent ${JSON.stringify(sent)}, not retry, retry, cancel`;
};

/**
 * Round 5: with saves failing, main refuses every copy. Each way to copy in
 * the shelf asks main, then shows the refusal and never "Copied".
 */
const copyRefusedCheck = async (page: Page): Promise<string | null> => {
  const mod = await commandKey(page);

  const ways: readonly {
    readonly name: string;
    readonly open: (on: Page) => Promise<void>;
    readonly run: (on: Page) => Promise<void>;
    readonly call: string;
  }[] = [
    {
      call: "copy",
      name: `${mod}+C in B's menu`,
      open: openAThenMenuOnB,
      run: pressing(`${mod}+c`),
    },
    {
      call: "copyDetails",
      name: `Alt+${mod}+C in B's menu`,
      open: openAThenMenuOnB,
      run: pressing(`Alt+${mod}+c`),
    },
    {
      call: "copy",
      name: "Copy in B's menu",
      open: openAThenMenuOnB,
      run: clickEntry("Copy"),
    },
    {
      call: "copyWithLink",
      name: "Copy with Link in B's menu",
      open: openAThenMenuOnB,
      run: clickEntry("Copy with Link"),
    },
    {
      call: "copy",
      name: "Edit › Copy",
      open: async (on) => {
        await select(on, ROW_B);
      },
      run: command({ kind: "copy" }),
    },
    {
      call: "copyDetails",
      name: "Item › Copy with Details",
      open: async (on) => {
        await select(on, ROW_B);
      },
      run: command({ action: "copyDetails", kind: "item" }),
    },
    {
      call: "copyList",
      name: "Item › Copy as List",
      open: async (on) => {
        await select(on, ROW_B);
      },
      run: command({ action: "copyList", kind: "item" }),
    },
    {
      call: "copyWithLink",
      name: "Item › Copy with Link",
      open: async (on) => {
        await select(on, ROW_B);
      },
      run: command({ action: "copyWithLink", kind: "item" }),
    },
    {
      call: "copyList",
      name: `Shift+${mod}+C in the menu for A and C`,
      open: async (on) => {
        await pickAAndC(on);
        await openMenuOn(on, ROW_C);
      },
      run: pressing(`Shift+${mod}+c`),
    },
    {
      call: "copyList",
      name: "Edit › Copy with A and C picked",
      open: pickAAndC,
      run: command({ kind: "copy" }),
    },
    // Elsewhere than macOS the page answers Ctrl+C itself; on a Mac ⌘C is the menu bar's Edit › Copy, above.
    ...(mod === "Control"
      ? [
          {
            call: "copy",
            name: "Ctrl+C on B's row",
            open: async (on: Page) => {
              await select(on, ROW_B);
              await item(on, ROW_B).locator("[data-row-keys]").first().focus();
            },
            run: pressing("Control+c"),
          },
        ]
      : []),
  ];

  // Each toast that appears from here on, by its words.
  await page.evaluate(`(() => {
    globalThis.__toasts = [];
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element && node.matches("[data-sonner-toast]")) {
            requestAnimationFrame(() => globalThis.__toasts.push(node.textContent));
          }
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  })()`);

  for (const way of ways) {
    // oxlint-disable-next-line no-await-in-loop -- one way after another, on purpose.
    await way.open(page);
    // oxlint-disable-next-line no-await-in-loop -- only the toasts this copy shows.
    await page.evaluate("globalThis.__toasts.length = 0");
    // oxlint-disable-next-line no-await-in-loop -- counted before the copy.
    const before = await callCount(page);
    // oxlint-disable-next-line no-await-in-loop -- one way after another, on purpose.
    await way.run(page);
    // oxlint-disable-next-line no-await-in-loop -- the refusal comes back over IPC.
    await page.waitForTimeout(300);

    // oxlint-disable-next-line no-await-in-loop -- read after the copy.
    const after = await calls(page, before);
    const sent = after.map((call) => call.call);
    // oxlint-disable-next-line no-await-in-loop -- read after the copy.
    const copiedMarks = await page.locator('[aria-label="Copied"]').count();
    // oxlint-disable-next-line no-await-in-loop -- read after the copy.
    const shown = await page.evaluate("globalThis.__toasts");
    const toasts = z.array(z.string()).parse(shown);

    if (!isDeepStrictEqual(sent, [way.call])) {
      return `${way.name} sent ${JSON.stringify(sent)}, not ${way.call}`;
    }

    if (copiedMarks > 0 || toasts.some((text) => text.startsWith("Copied"))) {
      return `${way.name} showed Copied although main refused the copy`;
    }

    if (!toasts.some((text) => text.includes(NOT_COPIED))) {
      return `${way.name} didn't say why nothing was copied (toasts: ${JSON.stringify(toasts)})`;
    }
  }

  return null;
};

const SCENES: readonly Scene[] = [
  {
    check: async (page) => {
      const badges = z
        .array(z.object({ hidden: z.boolean(), wrapped: z.boolean() }))
        .parse(
          await page.evaluate(`[...document.querySelectorAll("[data-badges] > *")].map((badge) => ({
            hidden: badge.getAttribute("aria-hidden") === "true",
            wrapped: badge.getBoundingClientRect().top >= badge.parentElement.getBoundingClientRect().bottom,
          }))`)
        );

      const wrapped = badges.filter((badge) => badge.wrapped).length;
      const wrong = badges.filter((badge) => badge.hidden !== badge.wrapped);

      if (wrapped === 0) {
        return "no badge wraps out of sight in the list, so aria-hidden goes untested";
      }

      return wrong.length === 0
        ? null
        : `${wrong.length} badges are aria-hidden where they show, or read out where they don't`;
    },
    data: { view: shelfView() },
    layoutCheck: true,
    name: "shelf-list",
    page: "shelf",
    platforms: ["macos", "windows"],
  },
  {
    data: { view: shelfView(NARROW_DOC) },
    layoutCheck: true,
    name: "shelf-list-narrow",
    page: "shelf",
    platforms: ["macos", "windows"],
    width: 300,
  },
  {
    act: async (page) => {
      await select(page, 10);
    },
    data: { view: shelfView() },
    layoutCheck: true,
    name: "shelf-expanded-full-item",
    page: "shelf",
  },
  {
    act: async (page) => {
      await select(page, 10);
      await item(page, 10)
        .getByRole("checkbox", { name: /^(?:Done|Not done): /u })
        .first()
        .focus();
    },
    check: async (page) => {
      await page.keyboard.press("Space");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(150);

      const ops = await applied(page);
      const sent = ops.map((op) => op.type);

      const editing = await page
        .getByRole("textbox", { name: "Edit item" })
        .count();

      if (sent.includes("toggleDone") || editing > 0) {
        return `Space or Return on a step's checkbox reached the row: ${JSON.stringify(sent)}, editing ${editing}`;
      }

      return sent.includes("toggleStep")
        ? null
        : `Space on a step's checkbox sent ${JSON.stringify(sent)}`;
    },
    data: { view: shelfView() },
    name: "shelf-expanded-step-keys",
    page: "shelf",
  },
  {
    act: async (page) => {
      await select(page, 10);
    },
    check: async (page) => {
      const row = item(page, 10);

      const controls = new Map([
        [
          "a step's checkbox",
          row.getByRole("checkbox", { name: /^(?:Done|Not done): /u }).first(),
        ],
        [
          "a window",
          row
            .getByRole("list", { name: "Linked windows" })
            .getByRole("button")
            .first(),
        ],
        ["Details", row.getByRole("button", { name: "Show details" })],
        ["⋯", row.getByRole("button", { name: "More" })],
      ]);

      for (const [name, control] of controls) {
        // oxlint-disable-next-line no-await-in-loop -- one control after another, on purpose.
        await control.focus();
        // oxlint-disable-next-line no-await-in-loop -- one key after another, on purpose.
        await page.keyboard.press("Backspace");
        // oxlint-disable-next-line no-await-in-loop -- one key after another, on purpose.
        await page.keyboard.press("Delete");

        // oxlint-disable-next-line no-await-in-loop -- checked before the next control, which a deletion would hide.
        if ((await removes(page)) > 0) {
          return `⌫ or Delete on ${name} deleted the item`;
        }
      }

      await row.locator("[data-row-keys]").first().focus();
      await page.keyboard.press("Backspace");
      await page.waitForTimeout(150);

      const fromRow = await removes(page);

      return fromRow === 1
        ? null
        : `⌫ on the row itself sent ${fromRow} deletions, not 1`;
    },
    data: { view: shelfView() },
    name: "shelf-expanded-delete-keys",
    page: "shelf",
  },
  {
    act: async (page) => {
      await select(page, 11);
      await item(page, 11).scrollIntoViewIfNeeded();
    },
    data: { view: shelfView() },
    layoutCheck: true,
    name: "shelf-expanded-image-pins",
    page: "shelf",
  },
  {
    act: async (page) => {
      await details(page, 10);
    },
    data: { view: shelfView() },
    layoutCheck: true,
    name: "shelf-details",
    page: "shelf",
    platforms: ["macos", "windows"],
  },
  {
    act: async (page) => {
      await details(page, 10);
      await page.locator("[data-details]").evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
    },
    data: { view: shelfView() },
    layoutCheck: true,
    name: "shelf-details-windows",
    page: "shelf",
  },
  {
    act: async (page) => {
      await details(page, 11);
    },
    data: { view: shelfView() },
    layoutCheck: true,
    name: "shelf-details-image-pins",
    page: "shelf",
  },
  {
    act: async (page) => {
      await details(page, 11);
      await page.locator("[data-details]").evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
    },
    data: { view: shelfView() },
    layoutCheck: true,
    name: "shelf-details-pin-labels",
    page: "shelf",
  },
  {
    act: async (page) => {
      await details(page, 11);

      const field = page.getByRole("textbox", { name: "Label for pin 1" });

      await field.click();
      await page.keyboard.press("Meta+a");
      await page.keyboard.type("Button label is cut off");
      await page.getByRole("heading", { name: "Details" }).focus();
    },
    check: async (page) => {
      const field = page.getByRole("textbox", { name: "Label for pin 1" });
      const edited = await field.inputValue();

      await page.evaluate(`globalThis.__emit("command", { kind: "undo" })`);
      await page.waitForTimeout(150);

      const after = await field.inputValue();

      return edited === "Button label is cut off" &&
        after === "Title too close to the field"
        ? null
        : `Undo after leaving a pin's label: “${edited}” became “${after}”`;
    },
    data: { view: shelfView() },
    name: "shelf-details-pin-label-undo",
    page: "shelf",
  },
  {
    act: async (page) => {
      await details(page, 10);
      await page.getByRole("button", { name: /^Due /u }).click();
      await page.getByRole("menuitem", { name: /^Tomorrow/u }).waitFor();
    },
    data: { view: shelfView() },
    name: "shelf-due-picker",
    page: "shelf",
  },
  {
    act: async (page) => {
      await details(page, 12);
      await page.getByRole("button", { name: "Add a field" }).click();
      await page.getByRole("menuitem", { name: /^Description/u }).waitFor();
    },
    data: { view: shelfView() },
    name: "shelf-details-add-menu",
    page: "shelf",
  },
  {
    act: async (page) => {
      await details(page, 12);
      await page.getByRole("button", { name: "Add a field" }).click();
      await page.getByRole("menuitem", { name: /^Next steps/u }).click();
      // Focus moves into the new step once the menu has closed.
      await page.waitForFunction(
        () => document.activeElement?.getAttribute("aria-label") === "Step 1"
      );
      await page.keyboard.type("Confirm the date with the movers");
      await page.keyboard.press("Enter");
      await page.keyboard.type("Send them the floor plan");
    },
    check: async (page) => {
      const first = await page
        .getByRole("textbox", { name: "Step 1" })
        .inputValue();

      const second = await page
        .getByRole("textbox", { name: "Step 2" })
        .inputValue();

      return first === "Confirm the date with the movers" &&
        second === "Send them the floor plan"
        ? null
        : `the steps read “${first}” and “${second}”`;
    },
    data: { view: shelfView() },
    name: "shelf-details-adding-steps",
    page: "shelf",
  },
  {
    act: async (page) => {
      await page.getByRole("textbox", { name: /^New note in/u }).click();
      await page.keyboard.type("# Research");
    },
    check: async (page) => {
      const headings = await page
        .getByRole("textbox", { name: /^New note in/u })
        .locator("h1, h2, h3")
        .count();

      await page.keyboard.press("Enter");

      const sent = await applied(page);

      const section = sent.some(
        (op) => op.type === "compose" && /^\\?# Research$/u.test(op.text ?? "")
      );

      if (headings > 0) {
        return "the note field formatted “# Research” as a heading";
      }

      return section
        ? null
        : `Return sent ${JSON.stringify(sent)}, not “# Research”`;
    },
    data: { view: shelfView() },
    name: "shelf-section-hint",
    page: "shelf",
  },
  {
    act: async (page) => {
      const field = page.getByRole("textbox", { name: /^New note in/u });

      await field.click();
      await page.keyboard.type("Call Rieder");
      await page.keyboard.press("Meta+a");
    },
    check: async (page) => {
      await page.keyboard.press("Meta+Shift+s");

      const struck = await page
        .getByRole("textbox", { name: /^New note in/u })
        .locator("s")
        .count();

      return struck === 0
        ? null
        : "⇧⌘S struck the text through instead of leaving the key to Next steps";
    },
    data: { view: shelfView() },
    name: "shelf-composer-strike-key",
    page: "shelf",
  },
  {
    act: async (page) => {
      await details(page, 10);
      await page.getByRole("button", { name: /^Due /u }).click();
      await page.getByRole("menuitem", { name: /^Tomorrow/u }).waitFor();
    },
    check: async (page) => {
      const back = page.getByRole("button", { name: "Back to the list" });

      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);

      const menuOpen = await page.getByRole("menu").count();
      const stillInDetails = await back.isVisible();

      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);

      const backInList = await page
        .getByRole("textbox", { name: "Search the shelf" })
        .isVisible();

      if (menuOpen > 0 || !stillInDetails) {
        return "the first Escape did not just close the Due menu";
      }

      return backInList
        ? null
        : "the second Escape did not go back to the list";
    },
    data: { view: shelfView() },
    name: "shelf-escape-layers",
    page: "shelf",
  },
  {
    act: async (page) => {
      await page.evaluate(
        "{ const list = document.querySelector('.shelf-list'); list.scrollTop = list.scrollHeight; }"
      );
      await select(page, 16);
      await page.waitForTimeout(150);
      await page.evaluate(
        "globalThis.__scrollBefore = document.querySelector('.shelf-list:not([data-details])').scrollTop"
      );
      await page.keyboard.press("ArrowRight");
      await page.getByRole("button", { name: "Back to the list" }).waitFor();
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
    },
    check: async (page) => {
      const state = z
        .object({ after: z.number(), before: z.number(), row: z.string() })
        .parse(
          await page.evaluate(`({
            after: document.querySelector(".shelf-list:not([data-details])").scrollTop,
            before: globalThis.__scrollBefore,
            row: document.activeElement?.closest("[data-item-id]")?.getAttribute("data-item-id") ?? "none",
          })`)
        );

      if (state.before < 20) {
        return `the list was not scrolled before details opened (${state.before})`;
      }

      if (Math.abs(state.after - state.before) > 2) {
        return `the list scrolled from ${state.before} to ${state.after} through details`;
      }

      if (state.row !== uuid(16)) {
        return `focus came back to ${state.row}, not the item`;
      }

      await page.keyboard.press("Enter");
      await page.waitForTimeout(150);

      const editing = await page
        .getByRole("textbox", { name: "Edit item" })
        .count();

      const reopened = await page
        .getByRole("button", { name: "Back to the list" })
        .isVisible();

      return editing === 1 && !reopened
        ? null
        : `Return after Back: editing ${editing}, details reopened ${reopened}`;
    },
    data: { view: shelfView() },
    name: "shelf-details-back",
    page: "shelf",
  },
  {
    act: async (page) => {
      await select(page, 16);
      await page.keyboard.press("ArrowRight");
      await page.getByRole("button", { name: "Back to the list" }).waitFor();
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
      await page.keyboard.press("Space");
      await page.waitForTimeout(150);
    },
    check: async (page) => {
      const ops = await applied(page);
      const sent = ops.map((op) => op.type);

      const reopened = await page
        .getByRole("button", { name: "Back to the list" })
        .isVisible();

      return sent.includes("toggleDone") && !reopened
        ? null
        : `Space after Back sent ${JSON.stringify(sent)}, details reopened ${reopened}`;
    },
    data: { view: shelfView() },
    name: "shelf-details-back-space",
    page: "shelf",
  },
  {
    act: async (page) => {
      await details(page, 14);
      await page.getByRole("button", { name: "Remove step 2" }).click();
    },
    check: async (page) => {
      const steps = page.getByRole("textbox", { name: /^Step /u });
      const before = await steps.count();

      await page.keyboard.press("Meta+z");
      await page.waitForTimeout(200);

      const after = await steps.count();

      return before === 2 && after === 3
        ? null
        : `⌘Z after removing a step: ${before} steps before, ${after} after`;
    },
    data: { view: shelfView() },
    name: "shelf-details-step-removed",
    page: "shelf",
  },
  {
    act: async (page) => {
      await item(page, 10)
        .locator("button:not([role=checkbox])")
        .first()
        .click({ button: "right" });
      await page
        .getByRole("menuitem", { name: /^Copy with Details/u })
        .waitFor();
    },
    data: { view: shelfView() },
    name: "shelf-item-menu",
    page: "shelf",
    platforms: ["macos", "windows"],
  },
  {
    act: openAThenMenuOnB,
    check: menuOwnershipCheck,
    data: { echo: "later", view: shelfView(MENU_DOC) },
    name: "shelf-row-menu-keys",
    page: "shelf",
    platforms: ["macos", "windows"],
  },
  {
    // ↓ to Check Off: the highlighted entry, which Space or Return would choose; no entry shows Space.
    act: async (page) => {
      await openAThenMenuOnB(page);
      await walkTo(page, "Check Off");
    },
    check: async (page) => {
      await page.keyboard.press("Escape");
      await menuClosed(page);

      return (
        (await swallowedKeysCheck(page)) ??
        (await otherMenusCheck(page)) ??
        (await blurClosesMenuCheck(page))
      );
    },
    data: { echo: "later", view: shelfView(MENU_DOC) },
    name: "shelf-menu-held-keys",
    page: "shelf",
    platforms: ["macos", "windows"],
  },
  {
    act: async (page) => {
      const mod = await commandKey(page);

      await openAThenMenuOnB(page);
      await page.keyboard.press(`${mod}+c`);
      await page.getByText(NOT_COPIED).waitFor();
    },
    check: copyRefusedCheck,
    data: {
      copyFails: NOT_COPIED,
      echo: "later",
      view: {
        ...shelfView(MENU_DOC),
        status: { ...STATUS, saveError: SAVE_FAILED },
      },
    },
    name: "shelf-copy-save-failed",
    page: "shelf",
    platforms: ["macos", "windows"],
  },
  {
    act: keepDraftsAct,
    check: keepDraftsCheck,
    data: {
      echo: "later",
      view: {
        ...shelfView(MENU_DOC),
        status: { ...STATUS, saveError: SAVE_FAILED },
      },
    },
    name: "shelf-draft-kept",
    page: "shelf",
  },
  {
    act: quitHeldAct,
    check: quitHeldCheck,
    data: {
      view: {
        ...shelfView(MENU_DOC),
        status: { ...STATUS, saveError: SAVE_FAILED },
      },
    },
    name: "shelf-quit-held",
    page: "shelf",
    width: 300,
  },
  {
    act: typeInEntryA,
    check: pendingEditCheck,
    data: { echo: "later", view: shelfView(MENU_DOC) },
    name: "shelf-copy-pending-edit",
    page: "shelf",
    platforms: ["macos", "windows"],
  },
  {
    act: async (page) => {
      await page.getByRole("button", { exact: true, name: "Add" }).click();
      await page.getByRole("menuitem", { name: /^New Window Link/u }).waitFor();
    },
    data: { view: shelfView() },
    name: "shelf-add-menu",
    page: "shelf",
  },
  {
    act: async (page) => {
      await details(page, 13);
    },
    data: { view: shelfView() },
    layoutCheck: true,
    name: "shelf-details-file",
    page: "shelf",
  },
  {
    act: async (page) => {
      await page
        .getByRole("textbox", { name: "Search the shelf" })
        .fill("quote");
    },
    data: { view: shelfView() },
    layoutCheck: true,
    name: "shelf-search",
    page: "shelf",
  },
  {
    act: async (page) => {
      await page.getByRole("button", { name: "Filter by Due" }).click();
      await page.getByRole("menuitem", { name: /^Overdue/u }).waitFor();
    },
    data: { view: shelfView() },
    name: "shelf-search-filter-menu",
    page: "shelf",
  },
  {
    act: async (page) => {
      await page
        .getByRole("textbox", { name: "Search the shelf" })
        .fill("due:week");
    },
    data: { view: shelfView() },
    layoutCheck: true,
    name: "shelf-search-due-week",
    page: "shelf",
  },
  {
    act: async (page) => {
      await page
        .getByRole("textbox", { name: "Search the shelf" })
        .fill("due:o");
    },
    check: async (page) => {
      const empty = await page.getByText(/^No matches/u).count();

      const suggested = await page
        .getByRole("button", { name: /\(due:overdue\)$/u })
        .count();

      await page
        .getByRole("textbox", { name: "Search the shelf" })
        .press("Enter");

      const query = await page
        .getByRole("textbox", { name: "Search the shelf" })
        .inputValue();

      if (empty > 0 || suggested === 0) {
        return `a partial due: showed ${empty} empty states and ${suggested} suggestions`;
      }

      return query === "due:overdue"
        ? null
        : `Return on a partial due: left “${query}”`;
    },
    data: { view: shelfView() },
    name: "shelf-search-due-partial",
    page: "shelf",
  },
  {
    act: async (page) => {
      await page
        .getByRole("textbox", { name: "Search the shelf" })
        .fill("due:");
    },
    data: { view: shelfView() },
    layoutCheck: true,
    name: "shelf-search-due-all",
    page: "shelf",
  },
  {
    act: async (page) => {
      await page
        .getByRole("textbox", { name: "Search the shelf" })
        .fill("zebra crossing");
    },
    data: { view: shelfView() },
    name: "shelf-search-empty",
    page: "shelf",
  },
  {
    act: async (page) => {
      await page.evaluate(
        "globalThis.__emit('command', { kind: 'shortcuts' })"
      );
      await page.getByRole("dialog").waitFor();
    },
    data: { view: shelfView() },
    name: "shelf-shortcuts",
    page: "shelf",
    platforms: ["macos", "windows"],
  },
  {
    act: async (page) => {
      const modifier = "Meta";

      await item(page, 12)
        .locator("button:not([role=checkbox])")
        .first()
        .click({ modifiers: [modifier] });
      await item(page, 14)
        .locator("button:not([role=checkbox])")
        .first()
        .click({ modifiers: [modifier] });
      await page.keyboard.press("ArrowRight");
      await page.getByText("Pick one item to see its details").waitFor();
    },
    data: { view: shelfView() },
    name: "shelf-pick-one-hint",
    page: "shelf",
  },
  {
    data: { view: shelfView(EMPTY_DOC) },
    name: "shelf-first-run",
    page: "shelf",
  },
  {
    data: { view: pickerView({ candidates: CANDIDATES, kind: "ready" }) },
    name: "picker",
    page: "picker",
    platforms: ["macos", "windows"],
  },
  {
    act: async (page) => {
      await page.getByRole("button", { name: /^Quote 2026-114/u }).click();
      await page.getByRole("button", { name: /^Office move budget/u }).click();
    },
    data: { view: pickerView({ candidates: CANDIDATES, kind: "ready" }) },
    name: "picker-picked",
    page: "picker",
  },
  {
    act: async (page) => {
      await page.getByRole("button", { name: /^Calendar: November/u }).click();
    },
    data: {
      view: pickerView(
        { candidates: CANDIDATES, kind: "ready" },
        { kind: "item", label: "Book the movers for Monday" }
      ),
    },
    name: "picker-link-to-item",
    page: "picker",
  },
  {
    data: { view: pickerView({ kind: "permission" }) },
    name: "picker-permission",
    page: "picker",
  },
  {
    act: async (page) => {
      await page.keyboard.press("p");
      await page.keyboard.press("2");
    },
    data: { view: drawingView(IMAGE.pins, false) },
    name: "drawing-pins",
    page: "drawing",
  },
  {
    data: { view: drawingView([], true) },
    name: "drawing-pin-hint",
    page: "drawing",
  },
  {
    act: async (page) => {
      await page.keyboard.press("p");
      await page.keyboard.press("2");
      await page.getByRole("button", { name: "Pen" }).focus();
    },
    check: async (page) => {
      const selectedAfterLeaving = await selectedPin(page).count();

      await page.keyboard.press("Backspace");
      await page.keyboard.press("Delete");

      const pinsAfterLeaving = await drawingPins(page).count();

      await page.keyboard.press("2");
      await page.keyboard.press("Backspace");

      const pinsAfterRemoving = await drawingPins(page).count();

      if (selectedAfterLeaving > 0 || pinsAfterLeaving !== 3) {
        return `with focus on the toolbar: ${selectedAfterLeaving} pins selected, ${pinsAfterLeaving} of 3 left after ⌫`;
      }

      return pinsAfterRemoving === 2
        ? null
        : `2 then ⌫ left ${pinsAfterRemoving} pins, not 2`;
    },
    data: { view: drawingView(IMAGE.pins, false) },
    name: "drawing-pin-focus",
    page: "drawing",
  },
  {
    act: async (page) => {
      await page.keyboard.press("p");
      await page.keyboard.press("2");
    },
    check: async (page) => {
      const before = await selectedPin(page).getAttribute("style");

      for (const key of ["ArrowRight", "ArrowRight", "ArrowRight"]) {
        // oxlint-disable-next-line no-await-in-loop -- a key held down repeats, one after another.
        await page.keyboard.down(key);
      }

      await page.keyboard.up("ArrowRight");

      const held = await selectedPin(page).getAttribute("style");

      await page.keyboard.press("Meta+z");

      const undone = await drawingPins(page).nth(1).getAttribute("style");

      if (held === before) {
        return "holding → did not move the pin";
      }

      return undone === before
        ? null
        : `one Undo after holding →: ${undone}, not ${before}`;
    },
    data: { view: drawingView(IMAGE.pins, false) },
    name: "drawing-held-nudge",
    page: "drawing",
  },
];

const SIZES: Readonly<Record<PageName, { width: number; height: number }>> = {
  drawing: { height: 720, width: 1040 },
  picker: { height: 520, width: 600 },
  shelf: { height: 620, width: 360 },
};

/** The macOS sidebar material, which Chrome cannot draw, as a flat stand-in. */
const MATERIAL = { dark: "#2b2a2e", light: "#ececee" } as const;

const CONTENT_TYPES = new Map([
  [".css", "text/css"],
  [".html", "text/html"],
  [".js", "text/javascript"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".woff2", "font/woff2"],
]);

const ListeningSchema = z.object({ port: z.number().int() });

const answer = async (
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> => {
  const url = new URL(request.url ?? "/", "http://localhost");

  const file = url.pathname.startsWith("/.fixtures/")
    ? path.join(OUT, url.pathname)
    : path.join(RENDERER, url.pathname);

  try {
    const body = await readFile(file);

    response.writeHead(200, {
      "content-type":
        CONTENT_TYPES.get(path.extname(file)) ?? "application/octet-stream",
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end();
  }
};

const serve = async () => {
  const server = createServer((request, response) => {
    void answer(request, response);
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const { port } = ListeningSchema.parse(server.address());

  return { origin: `http://127.0.0.1:${port}`, server };
};

/**
 * What overflows: a list or details that scroll sideways, anything that
 * sticks out of its card, badges that wrap onto a second line.
 */
const layoutProblems = async (page: Page): Promise<readonly string[]> =>
  await page.evaluate((nameLength) => {
    const problems: string[] = [];

    const describe = (element: Element): string => {
      const name =
        element.getAttribute("aria-label") ??
        element.textContent?.trim().slice(0, nameLength) ??
        "";

      return `<${element.tagName.toLowerCase()}> “${name}”`;
    };

    for (const scroller of document.querySelectorAll(".shelf-list")) {
      if (
        scroller instanceof HTMLElement &&
        scroller.offsetParent !== null &&
        scroller.scrollWidth > scroller.clientWidth + 1
      ) {
        problems.push(
          `${Object.hasOwn(scroller.dataset, "details") ? "details" : "the list"} scroll sideways (${scroller.scrollWidth} > ${scroller.clientWidth})`
        );
      }
    }

    for (const card of document.querySelectorAll("[data-item-id]")) {
      const box = card.getBoundingClientRect();

      for (const child of card.querySelectorAll("*")) {
        const inner = child.getBoundingClientRect();

        if (
          inner.width > 0 &&
          (inner.right > box.right + 0.5 || inner.left < box.left - 0.5)
        ) {
          problems.push(`${describe(child)} sticks out of its item`);
        }
      }
    }

    for (const badges of document.querySelectorAll("[data-badges]")) {
      if (badges.getBoundingClientRect().height > 22) {
        problems.push("badges wrap onto a second line");
      }
    }

    const panel = document.querySelector("[data-details]");

    if (panel !== null) {
      const box = panel.getBoundingClientRect();

      for (const child of panel.querySelectorAll("*")) {
        const inner = child.getBoundingClientRect();

        if (inner.width > 0 && inner.right > box.right + 0.5) {
          problems.push(`${describe(child)} sticks out of details`);
        }
      }
    }

    return [...new Set(problems)];
  }, 30);

/** A badge on its line shows whole, its icon included; one that doesn't fit wraps out of sight. */
const cutBadges = async (page: Page): Promise<readonly string[]> =>
  await page.evaluate(() =>
    [...document.querySelectorAll("[data-badges]")].flatMap((badges) => {
      const line = badges.getBoundingClientRect();

      return [...badges.children].flatMap((badge) => {
        const box = badge.getBoundingClientRect();

        return box.top < line.bottom &&
          (box.left < line.left - 0.5 || box.right > line.right + 0.5)
          ? [`“${badge.textContent ?? ""}” is cut off`]
          : [];
      });
    })
  );

const shoot = async (
  browser: Browser,
  origin: string,
  scene: Scene,
  platform: Platform,
  theme: Theme
): Promise<string> => {
  const size = {
    ...SIZES[scene.page],
    width: scene.width ?? SIZES[scene.page].width,
  };

  const context = await browser.newContext({
    colorScheme: theme,
    deviceScaleFactor: 2,
    userAgent: USER_AGENT[platform],
    viewport: size,
  });

  // A scene whose control is missing fails in seconds, not half a minute.
  context.setDefaultTimeout(5000);

  const page = await context.newPage();
  const errors: string[] = [];

  page.on("pageerror", (error) => {
    errors.push(error.message);
  });

  await page.addInitScript(
    `globalThis.__screens = ${JSON.stringify({ data: scene.data, page: scene.page })};`
  );
  await page.addInitScript({ path: BRIDGE });
  await page.goto(`${origin}/${scene.page}.html`);

  if (platform === "macos") {
    await page.addStyleTag({
      content: `html { background: ${MATERIAL[theme]}; }`,
    });
  }

  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(250);

  if (scene.act !== undefined) {
    await scene.act(page);
    await page.waitForTimeout(350);
  }

  if (errors.length > 0) {
    await context.close();
    throw new Error(`the page threw: ${errors.join("; ")}`);
  }

  // No hover left over from the scene's clicks.
  await page.mouse.move(1, 1);
  await page.waitForTimeout(100);

  const file = path.join(OUT, `${scene.name}-${platform}-${theme}.png`);

  await page.screenshot({ path: file });

  const problems =
    scene.layoutCheck === true
      ? [...(await layoutProblems(page)), ...(await cutBadges(page))]
      : [];

  const failed = scene.check === undefined ? null : await scene.check(page);

  await context.close();

  if (problems.length > 0) {
    throw new Error(`layout: ${problems.join("; ")}`);
  }

  if (failed !== null) {
    throw new Error(`check: ${failed}`);
  }

  return path.relative(OUT, file);
};

interface Shot {
  readonly scene: Scene;
  readonly platform: Platform;
  readonly theme: Theme;
}

/** SCREENS=details renders only the scenes whose name holds that word. */
const only = process.env.SCREENS ?? "";

const SHOTS: readonly Shot[] = SCENES.filter((scene) =>
  scene.name.includes(only)
).flatMap((scene) =>
  (scene.platforms ?? (["macos"] as const)).flatMap((platform) =>
    (["light", "dark"] as const).map((theme) => ({ platform, scene, theme }))
  )
);

const main = async (): Promise<void> => {
  if (only === "") {
    await rm(OUT, { force: true, recursive: true });
  }

  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch();

  await renderFixtures(browser);

  const { origin, server } = await serve();
  const taken: string[] = [];
  const failed: string[] = [];

  // One at a time: scenes wait on timers, and a loaded machine would change what they catch.
  for (const { platform, scene, theme } of SHOTS) {
    const name = `${scene.name}-${platform}-${theme}`;

    try {
      // oxlint-disable-next-line no-await-in-loop -- one shot at a time, on purpose.
      taken.push(await shoot(browser, origin, scene, platform, theme));
      console.log(`ok ${name}`);
    } catch (error) {
      failed.push(name);
      console.error(`${name}: ${String(error)}`);
    }
  }

  await writeFile(
    path.join(OUT, "index.json"),
    `${JSON.stringify(taken, null, 2)}\n`
  );
  await browser.close();
  server.close();
  console.log(`${taken.length} screenshots in ${OUT}`);

  if (failed.length > 0) {
    console.error(`${failed.length} failed: ${failed.join(", ")}`);
    process.exitCode = 1;
  }
};

await main();

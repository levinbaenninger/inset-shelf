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

const SCENES: readonly Scene[] = [
  {
    data: { view: shelfView() },
    layoutCheck: true,
    name: "shelf-list",
    page: "shelf",
    platforms: ["macos", "windows"],
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

      return state.row === uuid(16)
        ? null
        : `focus came back to ${state.row}, not the item`;
    },
    data: { view: shelfView() },
    name: "shelf-details-back",
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
      await page.getByRole("button", { name: "Filter by due date" }).click();
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

const shoot = async (
  browser: Browser,
  origin: string,
  scene: Scene,
  platform: Platform,
  theme: Theme
): Promise<string> => {
  const size = SIZES[scene.page];

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

  const problems = scene.layoutCheck === true ? await layoutProblems(page) : [];

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

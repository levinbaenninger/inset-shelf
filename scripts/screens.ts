/**
 * Screenshots the shelf, the window-link picker, the drawing window and the
 * first-run onboarding of the
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
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { chromium } from "playwright";
import type { Browser, Locator, Page } from "playwright";
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

const APP_ICON = "app-icon.png";

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

  // The onboarding's tile shows the app's icon, as main reads it from the bundle.
  await copyFile(
    path.join(ROOT, "build", "icon.png"),
    path.join(FIXTURES, APP_ICON)
  );
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

type ShelfFixture = typeof DOC | typeof EMPTY_DOC | typeof EXAMPLE_DOC;

const shelfView = (doc: ShelfFixture = DOC) => ({
  canUndo: false,
  discarded: null,
  doc,
  focus: null,
  notSaved: [],
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

/** Annotate on the sign-in screenshot: its pins, in its pixels, open as marks in its DIP, after the marks a save kept. */
const drawingView = (
  pins: readonly FixturePin[],
  pinMode: boolean,
  kept: readonly object[] = []
) => ({
  image: {
    heightPx: LOGIN.heightPx,
    pixelsPerDip: LOGIN.pixelsPerDip,
    url: `/.fixtures/${LOGIN.file}`,
    widthPx: LOGIN.widthPx,
  },
  marks: [
    ...kept,
    ...pins.map(({ x, y, ...label }) => ({
      ...label,
      at: { x: x / LOGIN.pixelsPerDip, y: y / LOGIN.pixelsPerDip },
      kind: "pin",
    })),
  ],
  pinMode,
  quitting: false,
  seq: 1,
});

// The permission onboarding's sample states (src/shared/onboarding.ts)

type RowState = "allow" | "waiting" | "allowed" | "reopen" | "reopening";

type OnboardingKind = "welcome" | "access" | "done";

const onboardingView = (
  current: OnboardingKind,
  rows: { readonly accessibility: RowState; readonly screen: RowState },
  steps: readonly OnboardingKind[] = ["welcome", "access", "done"]
) => ({
  appName: "Inset Shelf",
  focus: rows.accessibility === "allowed" ? "screen" : "accessibility",
  handOff: {
    later:
      "Inset Shelf works without the permissions you skipped. Set Up Permissions… in the Inset Shelf menu or the menu bar icon’s menu asks again.",
    ready:
      "Inset Shelf is ready. A short Getting started list on the shelf shows the rest.",
    showAround: "Show Me Around",
    start: "Start Using Inset Shelf",
  },
  permissions: [
    {
      features: ["Double Shift"],
      id: "accessibility",
      listName: "Accessibility",
      purpose:
        "Notices Double Shift and reads the page address of what you save.",
      state: rows.accessibility,
      title: "Accessibility",
    },
    {
      features: ["window links"],
      id: "screen",
      listName: "Screen & System Audio Recording",
      purpose: "Shows window titles and lets you link windows.",
      state: rows.screen,
      title: "Screen Recording",
    },
  ],
  step: { kind: current },
  steps: steps.map((kind) => ({ kind })),
  tagline: "Inset Shelf keeps what you capture in a list beside your work.",
  tile: { icon: `/.fixtures/${APP_ICON}`, name: "Inset Shelf" },
});

const NOTHING_ALLOWED = { accessibility: "allow", screen: "allow" } as const;
const ALL_ALLOWED = { accessibility: "allowed", screen: "allowed" } as const;

const PageHeightSchema = z.number();

/** The window takes the page's height: so does the shot, which then shows what the user sees. */
const fitToPage = async (page: Page): Promise<number> => {
  const height = PageHeightSchema.parse(
    await page.evaluate(() =>
      Math.ceil(
        document.querySelector("main")?.getBoundingClientRect().height ?? 0
      )
    )
  );

  if (height > 0) {
    await page.setViewportSize({
      height,
      width: page.viewportSize()?.width ?? 460,
    });
  }

  return height;
};

/** A page sized to its content and no taller than this: no big empty area. */
const compact = async (page: Page, most: number): Promise<string | null> => {
  const height = await fitToPage(page);

  return height > 0 && height <= most
    ? null
    : `the page is ${height}px tall, more than ${most}px`;
};

const DotsSchema = z.object({ count: z.number(), label: z.string() });

/** One dot per page of the run, the current one named. */
const dotsMatch = async (
  page: Page,
  count: number,
  label: string
): Promise<string | null> => {
  const dots = DotsSchema.parse(
    await page.evaluate(() => {
      const list = document.querySelector("footer ol");

      return {
        count: list?.children.length ?? 0,
        label: list?.getAttribute("aria-label") ?? "",
      };
    })
  );

  return dots.count === count && dots.label === label
    ? null
    : `dots: ${JSON.stringify(dots)}, wanted ${count} labelled “${label}”`;
};

// The in-app tutorial's sample states (src/shared/tutorial.ts), as src/main/shelf-tutorial.ts writes them for a Mac

const TUTORIAL_TASKS = [
  {
    anchor: null,
    how: "Select text in any app, then tap Shift twice (⇧ ⇧). It lands here, with the page it came from.",
    id: "double-shift",
    keys: "⇧ ⇧",
    title: "Save selected text with Double Shift",
  },
  {
    anchor: null,
    how: "Press ⇧⌘4 and drag over an area. Click Add to Shelf on the card that appears beside the shelf.",
    id: "screenshot",
    keys: "⇧⌘4",
    title: "Capture part of the screen",
  },
  {
    anchor: "add-button",
    how: "⌥⌘N, or + › New Drawing, opens a page to sketch on. To pin a spot, open an image and press P. Save puts it on the shelf.",
    id: "pin-or-sketch",
    keys: "⌥⌘N",
    title: "Pin a spot or draw a sketch",
  },
  {
    anchor: "add-button",
    how: "⇧⌘L, or + › New Window Link, lists your open windows. Click each one to link.",
    id: "window-link",
    keys: "⇧⌘L",
    title: "Link a window",
  },
  {
    anchor: "item-check",
    how: "Click an item's circle or press Space to check it off. ⌘C copies the selected item back.",
    id: "check-or-copy",
    keys: "Space",
    title: "Check off or copy an item back",
  },
];

const SPOTLIGHT_STEPS = [
  {
    anchor: "shelf-list",
    id: "list",
    text: "Everything you capture lands here, in sections. Drag an item onto another section to move it.",
    title: "Your shelf",
  },
  {
    anchor: "item-source",
    id: "source",
    text: "The line under an item names the app, window or page it came from. Click it to open the page again.",
    title: "Where it came from",
  },
  {
    anchor: "composer",
    id: "composer",
    text: "Type a note or a prompt and press Return. # and a name starts a section.",
    title: "Notes and prompts",
  },
  {
    anchor: "add-button",
    id: "add",
    text: "Attach files, start a drawing or link open windows.",
    title: "The + menu",
  },
  {
    anchor: "item-check",
    id: "check",
    text: "Click the circle or press Space to check an item off. ⌘C copies the selected item back.",
    title: "Check off and copy",
  },
  {
    anchor: "shelf-menu",
    id: "menu",
    text: "New sections, Settings and Keyboard Shortcuts are here. The menu bar icon has them too.",
    title: "Settings and more",
  },
];

const PICKER_HINT = {
  anchor: "picker-window",
  id: "picker",
  page: "picker",
  placement: "below",
  task: "window-link",
  text: "Click each window to link. The number on it shows its place in the link.",
  title: "Pick windows",
};

const DETAILS_HINT = {
  anchor: "details-add",
  id: "details-add",
  page: "shelf",
  placement: "below",
  task: null,
  text: "Add a description, next steps, a due date or linked windows. None of it is needed when you capture.",
  title: null,
};

/** A hint as main grants it: showing now, on its page. */
const grantedHint = (hint: typeof PICKER_HINT | typeof DETAILS_HINT) => ({
  anchor: hint.anchor,
  id: hint.id,
  kind: "hint",
  placement: hint.placement,
  text: hint.text,
  title: hint.title,
});

const EXAMPLE_IDS = [uuid(901), uuid(902), uuid(903), uuid(904)];

interface FixtureContext {
  readonly app: null;
  readonly appLink: null;
  readonly title: string;
  readonly url: string;
}

const exampleItem = (
  index: number,
  text: string,
  context: FixtureContext | null = null
) => ({
  ...base(901 + index, 10 - index, INBOX),
  context,
  html: null,
  kind: "text",
  links: [],
  text,
  via: "typed",
});

/** The first run's shelf: the examples, each a thing to try. */
const EXAMPLE_DOC = {
  activeSectionId: INBOX,
  items: [
    exampleItem(
      0,
      "Select any text in another app and tap Shift twice (⇧ ⇧) to save it here"
    ),
    exampleItem(1, "Check me off: click the circle or press Space"),
    exampleItem(2, "Copy me back with ⌘C, or drag me into another app"),
    exampleItem(
      3,
      "Saved from a web page: the line below says where, and opens it again",
      {
        app: null,
        appLink: null,
        title: "Inset Shelf: README",
        url: "https://github.com/levinbaenninger/inset-shelf#readme",
      }
    ),
  ],
  schemaVersion: 3,
  sections: [{ id: INBOX, name: "Inbox" }],
};

const tutorialView = (options: {
  readonly done?: number;
  readonly complete?: boolean;
  readonly examples?: boolean;
  readonly checklist?: boolean;
  readonly active?: object | null;
  readonly hints?: readonly object[];
  readonly spotlight?: number | null;
}) => {
  const done = options.done ?? 0;

  return {
    active: options.active ?? null,
    busy: false,
    checklist:
      options.checklist === false
        ? null
        : {
            collapsed: false,
            complete: options.complete ?? false,
            doneText:
              "That’s every way in. Help › Getting Started, or the menu bar icon’s menu, brings this back.",
            done,
            examples: options.examples ?? false,
            tasks: TUTORIAL_TASKS.map((task, index) => ({
              ...task,
              done: index < done,
            })),
            title: "Getting started",
            total: TUTORIAL_TASKS.length,
          },
    examples: options.examples === true ? EXAMPLE_IDS : [],
    hints: options.hints ?? [],
    spotlight:
      options.spotlight === undefined || options.spotlight === null
        ? null
        : { seq: options.spotlight, steps: SPOTLIGHT_STEPS },
  };
};

const BubbleSchema = z.object({ text: z.string(), visible: z.boolean() });

/** The tutorial's bubble, drawn and saying this. */
/** The text of the focused button, when focus is in the tutorial's bubble; null elsewhere. */
const bubbleFocus = async (page: Page): Promise<string | null> =>
  z
    .string()
    .nullable()
    .parse(
      await page.evaluate(() => {
        const active = document.activeElement;

        return active instanceof HTMLButtonElement &&
          active.closest("[data-coach-bubble]") !== null
          ? (active.textContent ?? "").trim()
          : null;
      })
    );

const bubbleSays = async (page: Page, text: string): Promise<string | null> => {
  const bubble = BubbleSchema.parse(
    await page.evaluate(() => {
      const element = document.querySelector("[data-coach-bubble]");
      const box = element?.getBoundingClientRect();

      return {
        text: element?.textContent ?? "",
        // Placed on the page: an unplaced bubble waits off screen.
        visible:
          element !== null &&
          box !== undefined &&
          box.width > 0 &&
          box.left >= 0 &&
          box.right <= window.innerWidth &&
          getComputedStyle(element).visibility !== "hidden",
      };
    })
  );

  return bubble.visible && bubble.text.includes(text)
    ? null
    : `the bubble must show “${text}” (${JSON.stringify(bubble)})`;
};

type Check = (page: Page) => Promise<string | null>;

/** Runs the checks in order: the first problem, or null. */
const firstProblem = async (
  page: Page,
  checks: readonly Check[]
): Promise<string | null> => {
  for (const check of checks) {
    // oxlint-disable-next-line no-await-in-loop -- in order, the first problem wins.
    const problem = await check(page);

    if (problem !== null) {
      return problem;
    }
  }

  return null;
};

const shows = async (
  page: Page,
  role: "button" | "status",
  name: string | RegExp
): Promise<string | null> =>
  (await page.getByRole(role, { name }).isVisible())
    ? null
    : `no ${role} “${String(name)}”`;

const showsText = async (page: Page, text: string): Promise<string | null> =>
  (await page.getByText(text, { exact: true }).isVisible())
    ? null
    : `no text “${text}”`;

const ListScrollSchema = z.object({
  scrollable: z.boolean(),
  top: z.number(),
});

/** The list is long enough to scroll, and sits at the top, on the checklist. */
const opensOnChecklist = async (page: Page): Promise<string | null> => {
  const list = ListScrollSchema.parse(
    await page.evaluate(() => {
      const element = document.querySelector("[data-coach='shelf-list']");

      return {
        scrollable:
          element !== null && element.scrollHeight > element.clientHeight,
        top: element?.scrollTop ?? -1,
      };
    })
  );

  if (!list.scrollable) {
    return "the list must be long enough to scroll, or the check proves nothing";
  }

  return list.top === 0
    ? await showsText(page, "Getting started")
    : `the shelf must open on the checklist, not ${list.top}px down the list`;
};

const PulseSchema = z.string();

/** Reduced motion stops the Waiting… pulse. */
const pulseRespectsMotion = async (page: Page): Promise<string | null> => {
  const pulse = page.locator("button span[aria-hidden=true].rounded-full");

  const moving = PulseSchema.parse(
    await pulse.evaluate((element) => getComputedStyle(element).animationName)
  );

  await page.emulateMedia({ reducedMotion: "reduce" });

  const reduced = PulseSchema.parse(
    await pulse.evaluate((element) => getComputedStyle(element).animationName)
  );

  return moving !== "none" && reduced === "none"
    ? null
    : `the pulse must stop with reduced motion (${moving} → ${reduced})`;
};

// Scenes

type PageName = "shelf" | "picker" | "drawing" | "onboarding";

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
  /** Leaves the mouse where the act left it, a button still held, for a marquee being drawn. */
  readonly keepPointer?: boolean;
  /** Runs after the screenshot: what went wrong, or null. */
  readonly check?: (page: Page) => Promise<string | null>;
  /** The system asks for reduced motion. */
  readonly reducedMotion?: boolean;
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

/** The tutorial actions the page sent, each kind and id once: a page asks again until main answers. */
const tutorialAsks = async (page: Page): Promise<readonly string[]> => {
  const sent = await calls(page);

  return [
    ...new Set(
      sent
        .filter((each) => each.call === "tutorial")
        .map((each) => JSON.stringify(each.arg))
    ),
  ];
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

/** A new drawing on a blank page. */
const BLANK_DRAWING = {
  image: null,
  marks: [],
  pinMode: false,
  quitting: false,
  seq: 1,
} as const;

/** A pen stroke across the blank page. */
const drawStroke = async (page: Page, y: number): Promise<void> => {
  await page.mouse.move(200, y);
  await page.mouse.down();
  await page.mouse.move(320, y + 40, { steps: 6 });
  await page.mouse.up();
};

/** A point of the drawing canvas, in its CSS pixels, where the mouse goes for it. */
const onCanvas = async (
  page: Page,
  x: number,
  y: number
): Promise<{ readonly x: number; readonly y: number }> => {
  const box = await page.locator("canvas").first().boundingBox();

  return { x: (box?.x ?? 0) + x, y: (box?.y ?? 0) + y };
};

const clickCanvas = async (page: Page, x: number, y: number): Promise<void> => {
  const at = await onCanvas(page, x, y);

  await page.mouse.click(at.x, at.y);
};

/** A drag across the canvas; `release: false` keeps the button down, as a marquee being drawn. */
const dragCanvas = async (
  page: Page,
  from: readonly [number, number],
  to: readonly [number, number],
  release = true
): Promise<void> => {
  const start = await onCanvas(page, ...from);
  const end = await onCanvas(page, ...to);

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });

  if (release) {
    await page.mouse.up();
  }
};

/** What the canvas shows, to compare before and after. */
const canvasPicture = async (page: Page): Promise<string> =>
  String(await page.evaluate("document.querySelector('canvas').toDataURL()"));

const PixelsSchema = z.array(z.number());

/**
 * One column of the canvas, from `top` to `bottom`: [r, g, b, a] of its
 * first inked pixel, and how many CSS pixels are inked (a 7 px stroke is
 * about 6 solid ones).
 */
const inkDown = async (
  page: Page,
  x: number,
  top: number,
  bottom: number
): Promise<{ readonly color: readonly number[]; readonly run: number }> => {
  const pixels = PixelsSchema.parse(
    await page.evaluate(
      `(() => {
        const canvas = document.querySelector("canvas");
        const ratio = canvas.width / canvas.clientWidth;
        const top = Math.round(${top} * ratio);
        const data = canvas.getContext("2d").getImageData(Math.round(${x} * ratio), top, 1, Math.round(${bottom} * ratio) - top).data;
        return [...data];
      })()`
    )
  );

  const inked = Array.from({ length: pixels.length / 4 }, (_, index) =>
    pixels.slice(index * 4, index * 4 + 4)
  ).filter((pixel) => (pixel[3] ?? 0) > 200);

  const ratio = Number(
    await page.evaluate(
      "(() => { const canvas = document.querySelector('canvas'); return canvas.width / canvas.clientWidth; })()"
    )
  );

  return { color: inked[0] ?? [], run: inked.length / ratio };
};

const near = (color: readonly number[], hex: string): boolean =>
  [1, 3, 5].every(
    (start, index) =>
      Math.abs(
        (color[index] ?? -99) - Number.parseInt(hex.slice(start, start + 2), 16)
      ) <= 6
  );

const attributes = async (page: Page, selector: string, name: string) =>
  await page
    .locator(selector)
    .evaluateAll(
      (nodes, attribute) => nodes.map((node) => node.getAttribute(attribute)),
      name
    );

const isDark = async (page: Page): Promise<boolean> =>
  (await page.evaluate(
    "matchMedia('(prefers-color-scheme: dark)').matches"
  )) === true;

/** Keeps the PNG each save sends, so a scene can look at what the export drew. */
const keepSavedPng = async (page: Page): Promise<void> => {
  await page.evaluate(`(() => {
    const save = globalThis.insetDrawing.save;
    globalThis.insetDrawing.save = (drawing) => {
      globalThis.__png = drawing.png === null ? null : [...drawing.png];
      return save(drawing);
    };
  })()`);
};

const PngSchema = z.array(z.number()).nullable();

/** Keeps the marks and pins each save sends and its picture's width, so a scene can check what Annotate keeps. */
const keepSavedMarks = async (page: Page): Promise<void> => {
  await page.evaluate(`(() => {
    const save = globalThis.insetDrawing.save;
    globalThis.insetDrawing.save = (drawing) => {
      globalThis.__kept = {
        marks: drawing.marks,
        pins: drawing.pins,
        width: drawing.png === null ? null : new DataView(drawing.png.buffer, drawing.png.byteOffset).getUint32(16),
      };
      return save(drawing);
    };
  })()`);
};

const KeptSchema = z.object({
  marks: z.array(z.unknown()),
  pins: z.array(z.object({ x: z.number(), y: z.number() })),
  width: z.number().nullable(),
});

const KeptBoxSchema = z.object({
  from: z.object({ x: z.number(), y: z.number() }),
  kind: z.literal("rect"),
  to: z.object({ x: z.number(), y: z.number() }),
  width: z.number(),
});

/** What the last save kept; it is let go of, so the next save's can be waited for. */
const takeKept = async (page: Page) => {
  await page.waitForFunction("globalThis.__kept !== undefined");

  const kept = KeptSchema.parse(await page.evaluate("globalThis.__kept"));

  await page.evaluate("globalThis.__kept = undefined");

  return kept;
};

/** Where a point of the sign-in screenshot under the marks, in its DIP, is on the screen. */
const onImage = async (
  page: Page,
  x: number,
  y: number
): Promise<{ readonly x: number; readonly y: number }> => {
  const box = await page.locator("img").first().boundingBox();
  const scale = (box?.width ?? 0) / (LOGIN.widthPx / LOGIN.pixelsPerDip);

  return { x: (box?.x ?? 0) + x * scale, y: (box?.y ?? 0) + y * scale };
};

/** Tabs on until the control with this name has focus. */
const tabTo = async (page: Page, name: string): Promise<void> => {
  for (let tab = 0; tab < 20; tab += 1) {
    // oxlint-disable-next-line no-await-in-loop -- one Tab at a time, as a person presses it.
    await page.keyboard.press("Tab");

    // oxlint-disable-next-line no-await-in-loop -- as above.
    const label = await page.evaluate(
      "document.activeElement?.getAttribute('aria-label') ?? null"
    );

    if (label === name) {
      return;
    }
  }

  throw new Error(`Tab never reached ${name}`);
};

/** A box and a text a save kept beside the sign-in screenshot, in its DIP. */
const KEPT = [
  {
    color: "red",
    from: { x: 300, y: 160 },
    kind: "rect",
    to: { x: 660, y: 260 },
    width: 3,
  },
  {
    at: { x: 320, y: 300 },
    color: "red",
    kind: "text",
    size: 24,
    text: "Fix this",
  },
] as const;

const WidthsSchema = z.object({ plain: z.number(), sketch: z.number() });

/** Words on the page, typed with Text, closed with Return. */
const typeText = async (
  page: Page,
  x: number,
  y: number,
  words: string
): Promise<void> => {
  await page.keyboard.press("t");
  await clickCanvas(page, x, y);
  await page.keyboard.type(words);
  await page.keyboard.press("Enter");
};

/** Retry's save has reached the fake main process, or 3 s went by; then time for a second one that shouldn't come. */
const retrySent = async (page: Page): Promise<void> => {
  await page
    .waitForFunction("globalThis.__calls.length > 0", null, { timeout: 3000 })
    .catch(() => null);
  await page.waitForTimeout(200);
};

/** Each change the page reported to main: one per change of its marks. */
const dirtyReports = async (page: Page): Promise<number> =>
  Number(await page.evaluate("globalThis.__dirty.length"));

/**
 * Round 8: nothing a locked page gets changes its marks. A drag, a click
 * with Text, the tool keys, ⌘Z, the menu bar's Undo, typing and Return in
 * the open text field, Esc, and the window's close button. Null when
 * nothing changed.
 */
const lockedPageCheck = async (page: Page): Promise<string | null> => {
  const mod = await commandKey(page);
  const field = page.getByRole("textbox", { exact: true, name: "Text" });

  // Clicking Save commits words being typed, so the field may be gone.
  const words = async (): Promise<string | null> =>
    (await field.count()) > 0 ? await field.inputValue() : null;

  const fieldBefore = await words();
  const before = await dirtyReports(page);
  const pressed = await page.locator("[aria-pressed=true]").count();

  await drawStroke(page, 300);
  await page.keyboard.press("p");
  await page.keyboard.press("x");
  await page.keyboard.press(`${mod}+z`);
  await page.evaluate('globalThis.__emit("edit", "undo")');

  if (fieldBefore !== null) {
    await field.focus();
    await page.keyboard.type(" more");
    await page.keyboard.press("Enter");
  }

  await page.keyboard.press("Escape");
  await page.evaluate('globalThis.__emit("confirmClose", "none")');
  await page.waitForTimeout(150);

  const after = await dirtyReports(page);
  const fieldAfter = await words();
  const dialogs = await page.getByRole("alertdialog").count();

  const disabled = await page
    .getByRole("toolbar", { name: "Drawing tools" })
    .getByRole("button", { disabled: false })
    .count();

  if (after !== before || fieldAfter !== fieldBefore) {
    return `the locked page changed: ${after - before} changes reported, its text ${JSON.stringify(fieldBefore)} became ${JSON.stringify(fieldAfter)}`;
  }

  if (dialogs > 0 || disabled > 0) {
    return `the locked page showed ${dialogs} dialogs and kept ${disabled} toolbar buttons enabled`;
  }

  return pressed === (await page.locator("[aria-pressed=true]").count())
    ? null
    : "a tool key picked another tool on the locked page";
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

/** With A's edit still being typed, inside the pause before it is sent, A's menu copies the edited words. */
const pendingEditCheck = async (page: Page): Promise<string | null> => {
  const mod = await commandKey(page);
  const a = uuid(ENTRY_A);
  const before = await callCount(page);

  await page.keyboard.type(" sharp");

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
      arg: {
        id: a,
        text: "Book the movers for Monday at 9 sharp",
        type: "editText",
      },
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

/** Main's message when the shelf can't be saved (src/main/save-error.ts): the banner shows it, and every copy is refused with it. */
const SAVE_FAILED = "The disk is full.";

const NOT_COPIED = `Couldn’t save your changes, so nothing was copied. ${SAVE_FAILED}`;

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

  const banner = page.locator("[data-details-view]").getByText("Not saved", {
    exact: true,
  });

  if (!(await banner.isVisible())) {
    return "A's details, opened again with saves failing, don't say A isn't saved";
  }

  await page.getByRole("button", { name: "Back to the list" }).click();

  const b = (await item(page, ROW_B).textContent()) ?? "";

  if (!b.includes(DRAFT_TEXT)) {
    return `B's row reads ${JSON.stringify(b)} after its edit was left, not ${JSON.stringify(DRAFT_TEXT)}`;
  }

  const before = await callCount(page);

  await item(page, ROW_B)
    .getByRole("button", { name: /^Retry: /u })
    .click();
  await page.getByText(`Still not saved. ${SAVE_FAILED}`).waitFor();

  const sent = await calls(page, before);
  const retried = sent.map((call) => call.call);

  return isDeepStrictEqual(retried, ["retrySave"])
    ? null
    : `Retry on B's row sent ${JSON.stringify(retried)}, not retrySave`;
};

/** A capture made while saves fail: the disk has never held it, so it offers Delete, not Discard changes. */
const NEW_CAPTURE = {
  ...base(20, 2),
  html: null,
  kind: "text",
  links: [],
  text: "Call the caretaker about the spare keys",
  via: "typed",
};

const EDITED_A = "Book the movers for Monday at 9";

/** Main's view after a failed save: A's words edited, and a new capture, each marked Not saved. */
const NOT_SAVED_VIEW = {
  ...shelfView({
    ...MENU_DOC,
    items: [
      NEW_CAPTURE,
      ...MENU_DOC.items.map((entry) =>
        entry.id === uuid(ENTRY_A) ? { ...entry, text: EDITED_A } : entry
      ),
    ],
  }),
  notSaved: [
    { id: uuid(20), undo: "delete" },
    { id: uuid(ENTRY_A), undo: "discard" },
  ],
  status: { ...STATUS, saveError: SAVE_FAILED },
};

const NotSavedRowsSchema = z.object({
  a: z.number(),
  capture: z.number(),
  captureDelete: z.number(),
  captureDiscard: z.number(),
});

/** How many "Not saved" lines A and the new capture show, and what the capture offers. */
const notSavedRows = async (page: Page) =>
  NotSavedRowsSchema.parse({
    a: await item(page, ENTRY_A)
      .getByText("Not saved", { exact: true })
      .count(),
    capture: await item(page, 20)
      .getByText("Not saved", { exact: true })
      .count(),
    captureDelete: await item(page, 20)
      .getByRole("button", { name: /^Delete: Call the caretaker/u })
      .count(),
    captureDiscard: await item(page, 20)
      .getByRole("button", { name: "Discard changes" })
      .count(),
  });

/**
 * Round 7: each item a failed save left unwritten says "Not saved" on its
 * row. Discard changes on A puts back only A's saved words; the new capture
 * keeps its line, and offers Delete instead, as the disk has never held it.
 */
const notSavedCheck = async (page: Page): Promise<string | null> => {
  const before = await notSavedRows(page);

  if (
    !isDeepStrictEqual(before, {
      a: 1,
      capture: 1,
      captureDelete: 1,
      captureDiscard: 0,
    })
  ) {
    return `the rows show ${JSON.stringify(before)}: A and the new capture should each say Not saved, the capture with Delete and no Discard changes`;
  }

  // The row's own keys leave its buttons alone: Return and Space press them, never Edit or Check off.
  const keyed = await callCount(page);

  const retry = item(page, 20).getByRole("button", {
    name: /^Retry: Call the caretaker/u,
  });

  await retry.focus();

  const shown = z.object({ height: z.number(), ring: z.string() }).parse(
    await retry.evaluate((button) => ({
      height: button.getBoundingClientRect().height,
      ring: getComputedStyle(button).boxShadow,
    }))
  );

  if (shown.height < 24 || shown.ring === "none") {
    return `the capture's Retry is ${shown.height} px high with ring ${shown.ring}: it needs 24 px and a visible focus ring`;
  }

  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");

  const pressed = await calls(page, keyed);

  if (
    !isDeepStrictEqual(
      pressed.map((call) => call.call),
      ["retrySave", "retrySave"]
    )
  ) {
    return `Return and Space on the capture's Retry sent ${JSON.stringify(pressed)}, not two retrySave`;
  }

  const from = await callCount(page);

  await item(page, ENTRY_A)
    .getByRole("button", { name: "Discard changes" })
    .click();
  await page.getByText("Changes discarded").waitFor();
  // Main's view with A put back arrives a moment later (`echo: "later"`).
  await page.waitForTimeout(400);

  const sent = await calls(page, from);
  const after = await notSavedRows(page);
  const words = (await item(page, ENTRY_A).textContent()) ?? "";

  if (
    !isDeepStrictEqual(sent, [{ arg: uuid(ENTRY_A), call: "discardChanges" }])
  ) {
    return `Discard changes on A sent ${JSON.stringify(sent)}, not discardChanges for A`;
  }

  if (
    words.includes(EDITED_A) ||
    !words.includes("Book the movers for Monday")
  ) {
    return `A's row reads ${JSON.stringify(words)} after Discard changes, not its saved words`;
  }

  return isDeepStrictEqual(after, { ...before, a: 0 })
    ? null
    : `after Discard changes on A the rows show ${JSON.stringify(after)}: only A's line should go`;
};

/** The file's details as typed while saves failed: every field differs from what the disk holds. */
const DRAFT_FILE = {
  ...MENU_DOC.items.find((entry) => entry.id === uuid(ROW_C)),
  description: "Ask facilities where the second exit goes",
  due: isoDay(3),
  steps: [step(11, "Print two copies for the movers")],
  title: "Floor plan, level 3, with the new desks",
};

const DETAILS_DISCARD_VIEW = {
  ...shelfView({
    ...MENU_DOC,
    items: MENU_DOC.items.map((entry) =>
      entry.id === uuid(ROW_C) ? DRAFT_FILE : entry
    ),
  }),
  notSaved: [{ id: uuid(ROW_C), undo: "discard" }],
  status: { ...STATUS, saveError: SAVE_FAILED },
};

const DetailsFieldsSchema = z.object({
  banner: z.number(),
  description: z.number(),
  due: z.number(),
  steps: z.number(),
  title: z.string(),
});

/** What the open details show: the title, and whether the other fields are there. */
const detailsFields = async (page: Page) => {
  const view = page.locator("[data-details-view]");

  return DetailsFieldsSchema.parse({
    banner: await view.getByText("Not saved", { exact: true }).count(),
    description: await view
      .getByRole("textbox", { name: "Description" })
      .count(),
    due: await view.locator('section[aria-label="Due"]').count(),
    steps: await view.getByRole("textbox", { name: /^Step /u }).count(),
    title: await view.getByRole("textbox", { name: "Title" }).inputValue(),
  });
};

/**
 * Round 7: Discard changes in the open details puts every field back as the
 * disk holds it at once (title, description, steps and Due) and its error goes.
 */
const detailsDiscardCheck = async (page: Page): Promise<string | null> => {
  const draft = await detailsFields(page);

  if (
    !isDeepStrictEqual(draft, {
      banner: 1,
      description: 1,
      due: 1,
      steps: 1,
      title: DRAFT_FILE.title,
    })
  ) {
    return `the file's details show ${JSON.stringify(draft)}, not the draft with its Not saved banner`;
  }

  await page
    .locator("[data-details-view]")
    .getByRole("button", { name: "Discard changes" })
    .click();
  await page.getByText("Changes discarded").waitFor();

  const saved = await detailsFields(page);

  return isDeepStrictEqual(saved, {
    banner: 0,
    description: 0,
    due: 0,
    steps: 0,
    title: "Floor plan, level 3",
  })
    ? null
    : `after Discard changes the open details show ${JSON.stringify(saved)}, not the saved file with no banner`;
};

/**
 * Round 7: a refused copy says why and offers Retry; Retry saves, and the
 * shelf says the item can be copied now. Nothing is copied by itself.
 */
const copyRetryCheck = async (page: Page): Promise<string | null> => {
  const from = await callCount(page);

  await page
    .locator("[data-sonner-toast]")
    .getByRole("button", { name: "Retry" })
    .click();
  await page.getByText("Saved. You can copy it now.").waitFor();

  const sent = await calls(page, from);

  return isDeepStrictEqual(
    sent.map((call) => call.call),
    ["retrySave"]
  )
    ? null
    : `Retry on the refused copy sent ${JSON.stringify(sent)}, not one retrySave and no copy`;
};

/** Office move renamed, as the page asks main for it. */
const rename = (name: string) => ({
  arg: { id: OFFICE, name, type: "renameSection" },
  call: "apply",
});

/** A section being renamed is an edit like any other: main's settle gets the name still being typed, and Escape puts the old one back. */
const liveRenameCheck = async (page: Page): Promise<string | null> => {
  await page
    .getByRole("button", { exact: true, name: "Office move" })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Rename/u }).click();
  await page.getByRole("textbox", { name: "Rename section" }).waitFor();

  const from = await callCount(page);

  await page.keyboard.press("End");
  await page.keyboard.type(" 2026");
  await page.evaluate('globalThis.__emit("settle", 9)');
  await page.keyboard.press("Escape");

  const sent = await calls(page, from);

  return isDeepStrictEqual(sent, [
    rename("Office move 2026"),
    { arg: 9, call: "settled" },
    rename("Office move"),
  ])
    ? null
    : `renaming with settle and then Escape sent ${JSON.stringify(sent)}, not the typed name, settled 9, then the old name`;
};

const DraftsSchema = z.array(z.number());

/**
 * Round 7, Sol's round 6 probe: words typed into a text item reach main
 * after a pause, with focus still in the field and main's echo leaving
 * them alone. Main's settle before a quit gets the words still waiting,
 * then the answer. Escape puts the saved words back. Round 8: the page
 * reports its count as it loads, so main can stop keeping a crashed
 * page's count.
 */
const liveEditCheck = async (page: Page): Promise<string | null> => {
  const a = uuid(ENTRY_A);
  const typed = await calls(page);

  const loaded = DraftsSchema.parse(
    await page.evaluate("globalThis.__drafts")
  ).at(0);

  if (loaded !== 0) {
    return `the page's first report of its unsent edits was ${String(loaded)}, not 0 as it loaded`;
  }

  const field = item(page, ENTRY_A).getByRole("textbox", { name: "Edit item" });

  if (
    !isDeepStrictEqual(typed, [
      { arg: { id: a, text: EDITED_A, type: "editText" }, call: "apply" },
    ])
  ) {
    return `typing in A without leaving the field sent ${JSON.stringify(typed)}, not one editText with the words`;
  }

  // Main's echo of that edit has landed by now.
  await page.waitForTimeout(300);

  const inField = await page.evaluate(
    "document.activeElement?.getAttribute('aria-label') ?? ''"
  );

  const words = (await field.textContent()) ?? "";

  if (inField !== "Edit item" || words.trim() !== EDITED_A) {
    return `after main's echo A's field reads ${JSON.stringify(words)} and focus is on ${JSON.stringify(inField)}`;
  }

  const from = await callCount(page);

  await page.keyboard.type(" sharp");
  await page.evaluate('globalThis.__emit("settle", 7)');

  const settled = await calls(page, from);

  const drafts = DraftsSchema.parse(
    await page.evaluate("globalThis.__drafts")
  ).at(-1);

  if (
    !isDeepStrictEqual(settled, [
      {
        arg: { id: a, text: `${EDITED_A} sharp`, type: "editText" },
        call: "apply",
      },
      { arg: 7, call: "settled" },
    ]) ||
    drafts !== 0
  ) {
    return `settle sent ${JSON.stringify(settled)} with ${drafts} drafts left, not the waiting words and then settled 7`;
  }

  const escaped = await callCount(page);

  await page.keyboard.press("Escape");

  const reverted = await calls(page, escaped);

  if (
    !isDeepStrictEqual(reverted, [
      {
        arg: { id: a, text: "Book the movers for Monday", type: "editText" },
        call: "apply",
      },
    ])
  ) {
    return `Escape after the words were sent sent ${JSON.stringify(reverted)}, not A's saved words`;
  }

  return await liveRenameCheck(page);
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
  ring: z.string(),
});

/** Focuses the quit prompt's button with that name and presses the key on it. */
const pressOn = async (page: Page, name: string, key: string) => {
  await page
    .getByRole("alertdialog")
    .getByRole("button", { exact: true, name })
    .focus();
  await page.keyboard.press(key);
};

/**
 * Round 6b and 7: Retry has the keyboard and shows its focus ring, every
 * button fits at the shelf's narrowest, Return retries whichever button
 * has focus, Esc cancels, Space presses the focused button, and the list
 * behind keeps its keys: → doesn't open the picked item's details.
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
        ring: getComputedStyle(document.activeElement).boxShadow,
      };
    })()`)
  );

  if (layout.focused !== "Retry") {
    return `the quit prompt opened with focus on ${JSON.stringify(layout.focused)}, not Retry`;
  }

  if (layout.ring === "none" || layout.ring === "") {
    return "Retry has focus as the prompt opens but shows no focus ring";
  }

  if (!layout.inside || layout.overflowing.length > 0) {
    return `the quit prompt doesn't fit the window: inside ${layout.inside}, cut ${JSON.stringify(layout.overflowing)}`;
  }

  const before = await callCount(page);

  await page.keyboard.press("ArrowRight");

  // Round 8: menu bar choices, and keys main answers on Windows, can't reach the shelf behind the prompt.
  for (const choice of [
    { field: "description", kind: "field" },
    { action: "toggleDone", kind: "item" },
    { action: "remove", kind: "item" },
    { kind: "newNote" },
    { kind: "find" },
  ]) {
    // oxlint-disable-next-line no-await-in-loop -- one command after another, on purpose.
    await page.evaluate(
      `globalThis.__emit("command", ${JSON.stringify(choice)})`
    );
  }

  // Main keeps the prompt up until it decides, so every key below meets the same prompt.
  const presses = [
    { answer: "retry", key: "Enter", name: "Retry" },
    { answer: "retry", key: "Enter", name: "Quit without saving" },
    { answer: "retry", key: "Enter", name: "Cancel" },
    { answer: "cancel", key: "Escape", name: "Quit without saving" },
    { answer: "retry", key: "Space", name: "Retry" },
    { answer: "discard", key: "Space", name: "Quit without saving" },
    { answer: "cancel", key: "Space", name: "Cancel" },
  ] as const;

  for (const { key, name } of presses) {
    // oxlint-disable-next-line no-await-in-loop -- one key after another, on purpose.
    await pressOn(page, name, key);
  }

  const sent = await calls(page, before);

  if ((await page.locator("[data-details-view]").count()) > 0) {
    return "→ or ⌘D in the quit prompt opened the picked item's details behind it";
  }

  const want = presses.map(({ answer }) => ({
    arg: answer,
    call: "answerQuit",
  }));

  return isDeepStrictEqual(sent, want)
    ? null
    : `keys in the quit prompt sent ${JSON.stringify(sent.map((call) => call.arg))}, not ${JSON.stringify(want.map((call) => call.arg))} (${presses.map(({ key, name }) => `${key} on ${name}`).join(", ")})`;
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

const BoxSchema = z.object({
  bottom: z.number(),
  left: z.number(),
  right: z.number(),
  top: z.number(),
});

/** Where an element sits on the page. */
const boxOf = async (locator: Locator) =>
  BoxSchema.parse(
    await locator.evaluate((element) => {
      const { bottom, left, right, top } = element.getBoundingClientRect();

      return { bottom, left, right, top };
    })
  );

const middle = (box: z.infer<typeof BoxSchema>): number =>
  (box.top + box.bottom) / 2;

const tall = (box: z.infer<typeof BoxSchema>): number => box.bottom - box.top;

const SetDueSchema = z.object({ due: z.string().nullable() });

const DescribeWindowSchema = z.object({ description: z.string() });

/** The last operation of a kind the page sent to main, or null. */
const lastSent = async <T>(
  page: Page,
  type: string,
  schema: z.ZodType<T>
): Promise<T | null> => {
  const ops = await applied(page);
  const matching = ops.filter((op) => op.type === type);
  const last = matching.at(-1);

  return last === undefined ? null : schema.parse(last);
};

/** Round 13: the circle, the words and the × of a step share one centre line, and the row keeps its height when typing stops. */
const stepRowCheck = async (page: Page): Promise<string | null> => {
  const words = page.getByRole("textbox", { name: "Step 1" });
  const row = words.locator("xpath=ancestor::li[1]");
  const editing = await boxOf(row);

  const centres = await Promise.all(
    [
      row.getByRole("checkbox"),
      words,
      row.getByRole("button", { name: /^Remove step/u }),
    ].map(async (part) => middle(await boxOf(part)))
  );

  const [checkbox = 0, field = 0, remove = 0] = centres;

  if (Math.abs(checkbox - field) > 0.5 || Math.abs(remove - field) > 0.5) {
    return `the step's parts are off centre: circle ${checkbox}, words ${field}, × ${remove}`;
  }

  await page.getByRole("heading", { name: "Details" }).focus();

  const viewing = await boxOf(row);

  return Math.abs(tall(editing) - tall(viewing)) > 0.5
    ? `the step row is ${tall(editing)} px tall while typed in and ${tall(viewing)} px after`
    : null;
};

/** The ISO day of the calendar day that has focus, or "" when focus is elsewhere. */
const focusedDay = async (page: Page): Promise<string> =>
  String(
    await page.evaluate(
      "document.activeElement?.closest('td[data-day]')?.getAttribute('data-day') ?? ''"
    )
  );

const calendar = (page: Page) => page.locator("[data-slot=calendar]");

const lastDue = async (page: Page): Promise<string | null> => {
  const op = await lastSent(page, "setDue", SetDueSchema);

  return op?.due ?? null;
};

/** Opens Pick a date… from the Due chip or Set Due. */
const openCalendar = async (page: Page, trigger: RegExp): Promise<void> => {
  await page.getByRole("button", { name: trigger }).click();
  await page.getByRole("menuitem", { name: "Pick a date…" }).click();
  await calendar(page).waitFor();
  await page.waitForTimeout(150);
};

const inDetails = async (page: Page): Promise<boolean> =>
  await page.getByRole("button", { name: "Back to the list" }).isVisible();

/**
 * The calendar takes the keys: the arrows move the day (← too, which goes
 * back elsewhere in details), Return picks it and hands focus to the Due
 * chip, the first Esc only closes the calendar and the next goes back.
 */
const calendarKeysCheck = async (page: Page): Promise<string | null> => {
  const start = await focusedDay(page);

  await page.keyboard.press("ArrowRight");

  const right = await focusedDay(page);

  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");

  const left = await focusedDay(page);

  if (start !== isoDay(1) || right !== isoDay(2) || left !== isoDay(0)) {
    return `the calendar focused ${start}, then ${right} on →, then ${left} on ← ←`;
  }

  if (!(await inDetails(page))) {
    return "← in the calendar went back to the list";
  }

  await page.keyboard.press("Enter");
  await calendar(page).waitFor({ state: "detached" });
  await page.waitForTimeout(150);

  const picked = await lastDue(page);

  const chip = await page.evaluate(
    "document.activeElement?.getAttribute('aria-label') ?? ''"
  );

  if (picked !== isoDay(0) || !String(chip).startsWith("Due Today")) {
    return `Return picked ${String(picked)} and left focus on “${String(chip)}”`;
  }

  await openCalendar(page, /^Due Today/u);
  await page.keyboard.press("Escape");
  await calendar(page).waitFor({ state: "detached" });
  await page.waitForTimeout(150);

  const back = await page.evaluate(
    "document.activeElement?.getAttribute('aria-label') ?? ''"
  );

  if (!(await inDetails(page)) || !String(back).startsWith("Due Today")) {
    return `the first Esc left details or put focus on “${String(back)}”, not the Due chip`;
  }

  // A click on text that takes no keyboard (empty space, in effect) closes the calendar and,
  // as nothing took the keyboard, gives it back to Due.
  await openCalendar(page, /^Due Today/u);
  await page.getByText("Book the movers for Monday").first().click();
  await calendar(page).waitFor({ state: "detached" });
  await page.waitForTimeout(150);

  const emptyClick = await page.evaluate(
    "document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName ?? ''"
  );

  if (!String(emptyClick).startsWith("Due Today")) {
    return `a click on plain text closed the calendar but left focus on “${String(emptyClick)}”, not Due`;
  }

  await page.getByRole("button", { name: /^Due Today/u }).focus();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);

  return (await inDetails(page))
    ? "the second Esc did not go back to the list"
    : null;
};

/** Set Due turns into the chip once a day is picked, and focus stays on it. */
const setDueCheck = async (page: Page): Promise<string | null> => {
  const day = await focusedDay(page);

  await page.keyboard.press("Enter");
  await calendar(page).waitFor({ state: "detached" });
  await page.waitForTimeout(150);

  const picked = await lastDue(page);

  const focus = await page.evaluate(
    "document.activeElement?.getAttribute('aria-label') ?? ''"
  );

  return day === isoDay(0) &&
    picked === isoDay(0) &&
    String(focus).startsWith("Due Today")
    ? null
    : `the calendar opened on ${day}, Return set ${String(picked)} and focus is on “${String(focus)}”`;
};

const QUOTE_WINDOW = "Quote 2026-114 from Rieder Möbel";

const windowDescriptionField = (page: Page) =>
  page.getByRole("textbox", { name: `Description of ${QUOTE_WINDOW}` });

/** A window's description goes back to words on Return and on blur, a click edits it again, and Esc puts back what it held. */
const windowDescriptionCheck = async (page: Page): Promise<string | null> => {
  const words = page.getByRole("button", {
    name: new RegExp(
      `^Signed copy, page 2\\. Edit the description of ${QUOTE_WINDOW}`,
      "u"
    ),
  });

  if ((await windowDescriptionField(page).count()) > 0) {
    return "the description stayed a field after Return";
  }

  const focus = await page.evaluate(
    "document.activeElement?.getAttribute('aria-label') ?? ''"
  );

  if (!String(focus).startsWith("Signed copy, page 2.")) {
    return `after Return focus is on “${String(focus)}”, not the description`;
  }

  await words.click();
  await page.keyboard.type(" and 3");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);

  const kept = await lastSent(page, "describeWindow", DescribeWindowSchema);

  if (
    (await windowDescriptionField(page).count()) > 0 ||
    !(await words.isVisible()) ||
    !(await inDetails(page))
  ) {
    return "Esc didn't put the description back as words, or left details";
  }

  if (kept?.description !== "Signed copy, page 2") {
    return `Esc left the description as “${String(kept?.description)}”`;
  }

  await words.click();
  await page.getByRole("heading", { name: "Details" }).click();
  await page.waitForTimeout(150);

  return (await windowDescriptionField(page).count()) === 0
    ? null
    : "the description stayed a field after a click elsewhere";
};

/** When it was added sits at the foot of details, and the field menu reads Add. */
const detailsFooterCheck = async (page: Page): Promise<string | null> => {
  const add = await page
    .getByRole("button", { name: "Add a field" })
    .textContent();

  if (add?.trim() !== "Add") {
    return `the field menu reads “${String(add)}”, not “Add”`;
  }

  const footer = page.locator("[data-details] > footer");
  const text = (await footer.textContent()) ?? "";
  const foot = await boxOf(footer);
  const panel = await boxOf(page.locator("[data-details]"));

  if (!text.startsWith("Added ")) {
    return `the footer reads “${text}”`;
  }

  return panel.bottom - foot.bottom > 24
    ? `the footer ends ${panel.bottom - foot.bottom} px above the foot of details`
    : null;
};

const menuEntries = async (page: Page): Promise<readonly string[]> => {
  const entries = await page.getByRole("menuitem").allTextContents();

  return entries.map((entry) => entry.trim());
};

/** Details' ⋯ has no Details entry; the row's menu still does. */
const detailsMenuCheck = async (page: Page): Promise<string | null> => {
  const inMenu = await menuEntries(page);

  if (inMenu.some((entry) => entry.startsWith("Details"))) {
    return `details' ⋯ offers ${JSON.stringify(inMenu)}`;
  }

  await page.keyboard.press("Escape");
  await menuClosed(page);
  await page.getByRole("button", { name: "Back to the list" }).click();
  await page.waitForTimeout(150);
  await openMenuOn(page, 10);

  const onRow = await menuEntries(page);

  return onRow.some((entry) => entry.startsWith("Details"))
    ? null
    : `the row's menu lost Details: ${JSON.stringify(onRow)}`;
};

/** The › of Details in the open row ends where the Due chip above it ends. */
const detailsButtonCheck = async (page: Page): Promise<string | null> => {
  const row = item(page, 10);
  const chevron = await boxOf(row.locator("[data-details-button] svg path"));
  const chip = await boxOf(row.locator("[data-badges] > *").first());

  return Math.abs(chevron.right - chip.right) > 1
    ? `Details’ › ends at ${chevron.right}, the Due chip at ${chip.right}`
    : null;
};

/** Entries A and B alone, so the list keeps empty space below them, even with B open. */
const SHORT_DOC = {
  ...DOC,
  items: [ENTRY_A, ROW_B].flatMap((n) =>
    ITEMS.filter((entry) => entry.id === uuid(n))
  ),
};

const nothingOpen = async (page: Page): Promise<boolean> => {
  const focus = await focused(page);

  return (await selectedRow(page)) === null && focus.row === null;
};

/** Clicks the list below its last section, where there is nothing. */
const clickEmptySpace = async (page: Page): Promise<void> => {
  const list = await boxOf(page.locator(".shelf-list").first());
  const last = await boxOf(page.locator(".shelf-list > section").last());

  await page.mouse.click(
    list.left + 60,
    Math.min(last.bottom + 24, list.bottom - 8)
  );
};

/**
 * Round 13: a click on search, the note field or empty space lets go of the
 * open item, and ↑ from the note field still walks into the list. A click
 * on empty space while an item's menu is open only closes the menu, and
 * focus goes back to the item (Round 4).
 */
const clickElsewhereCheck = async (page: Page): Promise<string | null> => {
  if (!(await nothingOpen(page))) {
    return "a click on empty space left the item open or focused";
  }

  const targets = [
    ["search", page.getByRole("textbox", { name: "Search the shelf" })],
    ["the note field", page.getByRole("textbox", { name: /^New note in/u })],
  ] as const;

  for (const [name, target] of targets) {
    // oxlint-disable-next-line no-await-in-loop -- one target after another, on purpose.
    await select(page, ENTRY_A);
    // oxlint-disable-next-line no-await-in-loop -- one target after another, on purpose.
    await target.click();

    // oxlint-disable-next-line no-await-in-loop -- read after each click.
    if (!(await nothingOpen(page))) {
      return `a click on ${name} left the item open or focused`;
    }
  }

  await page.keyboard.press("ArrowUp");

  if ((await selectedRow(page)) !== uuid(ROW_B)) {
    return `↑ from the note field selected ${String(await selectedRow(page))}, not the last item`;
  }

  await openMenuOn(page, ROW_B);
  await clickEmptySpace(page);
  await menuClosed(page);

  const afterMenu = await focused(page);

  if (
    afterMenu.row !== uuid(ROW_B) ||
    (await selectedRow(page)) !== uuid(ROW_B)
  ) {
    return `a click on empty space with B's menu open left focus on ${afterMenu.row ?? "no item"}`;
  }

  await openMenuOn(page, ROW_B);
  await page.getByRole("textbox", { name: "Search the shelf" }).click();
  await menuClosed(page);

  const searching = await page.evaluate(
    "document.activeElement?.getAttribute('aria-label') ?? ''"
  );

  return searching === "Search the shelf" && (await nothingOpen(page))
    ? null
    : `a click on search with B's menu open left focus on “${String(searching)}”`;
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
    check: detailsButtonCheck,
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
      await details(page, 12);
      await page.getByRole("button", { name: "Add a field" }).click();
      await page.getByRole("menuitem", { name: /^Next steps/u }).click();
      await page.waitForFunction(
        () => document.activeElement?.getAttribute("aria-label") === "Step 1"
      );
    },
    check: stepRowCheck,
    data: { view: shelfView() },
    name: "shelf-details-step-editing",
    page: "shelf",
  },
  {
    act: async (page) => {
      await details(page, 12);
    },
    check: detailsFooterCheck,
    data: { view: shelfView() },
    layoutCheck: true,
    name: "shelf-details-footer",
    page: "shelf",
  },
  {
    act: async (page) => {
      await details(page, 10);
      await page
        .locator("[data-details-view]")
        .getByRole("button", { exact: true, name: "More" })
        .click();
      await page.getByRole("menu").waitFor();
    },
    check: detailsMenuCheck,
    data: { view: shelfView() },
    name: "shelf-details-more-menu",
    page: "shelf",
  },
  {
    act: async (page) => {
      await details(page, 12);
      await openCalendar(page, /^Due Tomorrow/u);
    },
    check: calendarKeysCheck,
    data: { view: shelfView() },
    name: "shelf-due-calendar",
    page: "shelf",
    // The shelf at its narrowest, so the calendar must fit there.
    width: 300,
  },
  {
    act: async (page) => {
      await details(page, 13);
      await page.getByRole("button", { name: "Add a field" }).click();
      await page.getByRole("menuitem", { name: /^Due/u }).click();
      await page.getByRole("menuitem", { name: "Pick a date…" }).click();
      await calendar(page).waitFor();
    },
    check: setDueCheck,
    data: { view: shelfView() },
    name: "shelf-due-calendar-set-due",
    page: "shelf",
  },
  {
    act: async (page) => {
      await details(page, 10);
      await openCalendar(page, /^Due Today/u);
    },
    // A click on a field closes the calendar and the keyboard stays in that field, not on Due.
    check: async (page) => {
      // A CSS locator: while the calendar is open, the page around it is hidden from the a11y tree.
      const field = page
        .locator('[data-details] textarea[aria-label="Description"]')
        .first();

      await field.click();
      await calendar(page).waitFor({ state: "detached" });
      await page.waitForTimeout(150);

      const focus = await page.evaluate(
        "document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName ?? ''"
      );

      return focus === "Description"
        ? null
        : `a click on Description closed the calendar but left focus on “${String(focus)}”`;
    },
    data: { view: shelfView() },
    name: "shelf-due-calendar-click-field",
    page: "shelf",
  },
  {
    act: async (page) => {
      await details(page, 10);
      await page
        .getByRole("button", { name: `Add a description of ${QUOTE_WINDOW}` })
        .click();
      await windowDescriptionField(page).waitFor();
      await page.keyboard.type("Signed copy, page 2");
      await page.keyboard.press("Enter");
      await page.locator("[data-details]").evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
    },
    check: windowDescriptionCheck,
    data: { view: shelfView() },
    layoutCheck: true,
    name: "shelf-details-window-description",
    page: "shelf",
  },
  {
    act: async (page) => {
      await select(page, ENTRY_A);
      await clickEmptySpace(page);
    },
    check: clickElsewhereCheck,
    data: { view: shelfView(SHORT_DOC) },
    name: "shelf-click-elsewhere",
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
    check: notSavedCheck,
    data: { echo: "later", savedDoc: MENU_DOC, view: NOT_SAVED_VIEW },
    layoutCheck: true,
    name: "shelf-not-saved",
    page: "shelf",
  },
  {
    act: async (page) => {
      await details(page, ROW_C);
    },
    check: detailsDiscardCheck,
    data: { savedDoc: MENU_DOC, view: DETAILS_DISCARD_VIEW },
    layoutCheck: true,
    name: "shelf-details-discard",
    page: "shelf",
  },
  {
    // One click on Discard changes while A's text is open: the words sent and the ones still waiting both go (red-team round 7).
    act: async (page) => {
      await select(page, ENTRY_A);
      await page.keyboard.press("Enter");

      const field = item(page, ENTRY_A).getByRole("textbox", {
        name: "Edit item",
      });

      await field.fill("A changed once more");
      await page.waitForTimeout(350);
      await field.pressSequentially(" and more");
      await page.evaluate("globalThis.__mark = globalThis.__calls.length");
      await item(page, ENTRY_A)
        .getByRole("button", { name: /^Discard changes:/u })
        .click();
      await page.waitForTimeout(400);
    },
    check: async (page) => {
      const from = Number(await page.evaluate("globalThis.__mark"));
      const sent = await calls(page, from);
      const row = (await item(page, ENTRY_A).textContent()) ?? "";

      const editors = await item(page, ENTRY_A)
        .getByRole("textbox", { name: "Edit item" })
        .count();

      const expected = [{ arg: uuid(ENTRY_A), call: "discardChanges" }];

      if (!isDeepStrictEqual(sent, expected)) {
        return `one click on Discard changes sent ${JSON.stringify(sent)}, not ${JSON.stringify(expected)}`;
      }

      return editors === 0 &&
        row.includes("Book the movers for Monday") &&
        !row.includes("changed once more")
        ? null
        : `after Discard changes the row shows ${JSON.stringify(row)} with ${editors} editor open`;
    },
    data: { savedDoc: MENU_DOC, view: NOT_SAVED_VIEW },
    name: "shelf-discard-while-editing",
    page: "shelf",
  },
  {
    act: async (page) => {
      const mod = await commandKey(page);

      await openAThenMenuOnB(page);
      await page.keyboard.press(`${mod}+c`);
      await page
        .locator("[data-sonner-toast]")
        .getByRole("button", { name: "Retry" })
        .waitFor();
    },
    check: copyRetryCheck,
    data: {
      copyFails: NOT_COPIED,
      echo: "later",
      retryWorks: true,
      view: {
        ...shelfView(MENU_DOC),
        status: { ...STATUS, saveError: SAVE_FAILED },
      },
    },
    name: "shelf-copy-refused-retry",
    page: "shelf",
  },
  {
    act: typeInEntryA,
    check: liveEditCheck,
    data: { echo: "later", view: shelfView(MENU_DOC) },
    name: "shelf-inline-live-edit",
    page: "shelf",
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
  ...[
    {
      marked: ["mir", "mir"],
      name: "suffix",
      query: "mir",
      text: "\u0130zmir 😀\u0130zmir",
    },
    {
      marked: ["\u0130", "i"],
      name: "expanded",
      query: "i",
      text: "\u0130zmir",
    },
    { marked: ["ΟΣ"], name: "context", query: "ος", text: "ΟΣ \u0130" },
  ].map(({ marked, name, query, text }): Scene => ({
    act: async (page) => {
      await page.getByRole("textbox", { name: "Search the shelf" }).fill(query);
    },
    check: async (page) => {
      const matches = await page.evaluate(() =>
        [...(CSS.highlights.get("shelf-search") ?? [])].flatMap((range) =>
          range instanceof Range &&
          range.startContainer.parentElement?.closest("[data-item-id]")
            ? [range.toString()]
            : []
        )
      );

      return isDeepStrictEqual(matches, marked)
        ? null
        : `Unicode search highlighted ${JSON.stringify(matches)}, not ${JSON.stringify(marked)}`;
    },
    data: {
      view: shelfView({
        ...DOC,
        items: [{ ...FULL, ...META, context: null, text }],
      }),
    },
    name: `shelf-search-unicode-${name}`,
    page: "shelf",
  })),
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
    // Round 13: the drawing rows in the sheet's Pins section fit the shelf's width, keys and all.
    act: async (page) => {
      await page.evaluate(
        "globalThis.__emit('command', { kind: 'shortcuts' })"
      );
      await page.getByRole("dialog").waitFor();
      await page
        .getByRole("dialog")
        .getByText("Pins", { exact: true })
        .evaluate((heading) => {
          heading.scrollIntoView({ block: "start" });
        });
    },
    check: async (page) => {
      const outside = await page.getByRole("dialog").evaluate((dialog) => {
        const edge = dialog.getBoundingClientRect().right;

        return [...dialog.querySelectorAll("*")].flatMap((node) =>
          node.getBoundingClientRect().right > edge + 0.5
            ? [node.textContent?.trim().slice(0, 30) ?? ""]
            : []
        );
      });

      return outside.length === 0
        ? null
        : `sticks out of the sheet: ${JSON.stringify(outside)}`;
    },
    data: { view: shelfView() },
    name: "shelf-shortcuts-drawing",
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
    check: async (page) => {
      const instructions = page.locator("[data-slot=empty-description]");
      const text = (await instructions.textContent()) ?? "";

      const button = page.getByRole("button", {
        name: "Set Up Screen Recording…",
      });

      await button.click();

      return text.includes("needs Screen Recording") &&
        (await instructions.isVisible()) &&
        isDeepStrictEqual(await calls(page), [
          { arg: null, call: "setUpScreenRecording" },
        ])
        ? null
        : "the permission scene must say why, and Set Up Screen Recording… must open the onboarding";
    },
    data: { view: pickerView({ kind: "permission" }) },
    name: "picker-permission",
    page: "picker",
  },
  {
    check: async (page) =>
      await firstProblem(page, [
        async (on) => await compact(on, 300),
        async (on) => await dotsMatch(on, 3, "Step 1 of 3"),
        async (on) => await shows(on, "button", "Get Started"),
        async (on) => await shows(on, "button", "Not now"),
      ]),
    data: { view: onboardingView("welcome", NOTHING_ALLOWED) },
    name: "onboarding-welcome",
    page: "onboarding",
  },
  {
    act: async (page) => {
      await page.getByRole("button", { name: "Allow Accessibility" }).click();
      await page.getByRole("button", { name: "Back" }).click();
    },
    check: async (page) =>
      await firstProblem(page, [
        async (on) => await compact(on, 480),
        async (on) => await dotsMatch(on, 3, "Step 2 of 3"),
        async (on) =>
          isDeepStrictEqual(await calls(on), [
            { arg: "accessibility", call: "allow" },
            { arg: null, call: "back" },
          ])
            ? null
            : "Allow must ask main for that permission, and Back go back",
      ]),
    data: { view: onboardingView("access", NOTHING_ALLOWED) },
    name: "onboarding-access",
    page: "onboarding",
  },
  {
    check: async (page) =>
      await firstProblem(page, [
        async (on) => await shows(on, "button", /^Waiting for Accessibility/u),
        async (on) =>
          await showsText(on, "↑ Drag Inset Shelf into the Accessibility list"),
        async (on) => await compact(on, 560),
        pulseRespectsMotion,
      ]),
    data: {
      view: onboardingView("access", {
        accessibility: "waiting",
        screen: "allow",
      }),
    },
    name: "onboarding-waiting",
    page: "onboarding",
  },
  {
    check: async (page) =>
      await firstProblem(page, [
        async (on) => await compact(on, 480),
        async (on) => await shows(on, "status", "Accessibility allowed"),
        async (on) => await shows(on, "button", "Not now"),
      ]),
    data: {
      view: onboardingView("access", {
        accessibility: "allowed",
        screen: "allow",
      }),
    },
    name: "onboarding-allowed",
    page: "onboarding",
  },
  {
    check: async (page) =>
      await firstProblem(page, [
        async (on) => await shows(on, "button", "Reopen to finish"),
        async (on) =>
          await showsText(
            on,
            "↑ Drag Inset Shelf into the Screen & System Audio Recording list"
          ),
        async (on) => await compact(on, 600),
      ]),
    data: {
      view: onboardingView("access", {
        accessibility: "allowed",
        screen: "reopen",
      }),
    },
    name: "onboarding-reopen",
    page: "onboarding",
  },
  {
    act: async (page) => {
      await page.getByRole("button", { name: "Show Me Around" }).click();
    },
    check: async (page) =>
      await firstProblem(page, [
        async (on) => await compact(on, 300),
        async (on) => await dotsMatch(on, 3, "Step 3 of 3"),
        async (on) => await shows(on, "button", "Start Using Inset Shelf"),
        async (on) =>
          isDeepStrictEqual(await calls(on), [
            { arg: "showAround", call: "finish" },
          ])
            ? null
            : "Show Me Around must hand over to the walkthrough",
      ]),
    data: { view: onboardingView("done", ALL_ALLOWED) },
    name: "onboarding-done",
    page: "onboarding",
  },
  {
    check: async (page) =>
      await firstProblem(page, [
        async (on) => await compact(on, 340),
        async (on) =>
          await showsText(on, "Allow Accessibility to use Double Shift."),
      ]),
    data: { view: onboardingView("done", NOTHING_ALLOWED) },
    name: "onboarding-done-skipped",
    page: "onboarding",
  },
  {
    check: async (page) =>
      await firstProblem(page, [
        async (on) => await compact(on, 300),
        async (on) => await dotsMatch(on, 2, "Step 2 of 2"),
      ]),
    data: { view: onboardingView("done", ALL_ALLOWED, ["welcome", "done"]) },
    name: "onboarding-done-nothing-missing",
    page: "onboarding",
  },
  {
    act: async (page) => {
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      });
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.press("Enter");
      await page.keyboard.press("Shift+ArrowLeft");
    },
    check: async (page) =>
      isDeepStrictEqual(await calls(page), [
        { arg: null, call: "back" },
        { arg: "start", call: "finish" },
      ])
        ? null
        : `← and Return must move through the pages, → and ⇧← nothing on Done (${JSON.stringify(await calls(page))})`,
    data: { view: onboardingView("done", ALL_ALLOWED) },
    name: "onboarding-keys",
    page: "onboarding",
  },
  {
    check: async (page) =>
      await firstProblem(page, [
        async (on) => await bubbleSays(on, "Pick windows"),
        async (on) =>
          isDeepStrictEqual(await calls(on), [
            { arg: { id: "picker", kind: "hintShown" }, call: "tutorial" },
          ])
            ? null
            : `a drawn hint must say it was seen (${JSON.stringify(await calls(on))})`,
      ]),
    data: {
      tutorial: tutorialView({
        active: grantedHint(PICKER_HINT),
        checklist: false,
      }),
      view: pickerView({ candidates: CANDIDATES, kind: "ready" }),
    },
    name: "tutorial-picker-hint",
    page: "picker",
  },
  {
    check: async (page) =>
      await firstProblem(page, [
        async (on) => await showsText(on, "Getting started"),
        async (on) => await showsText(on, "· 0 of 5"),
        async (on) =>
          (await on.getByText("Example", { exact: true }).count()) === 4
            ? null
            : "every example item must be tagged Example",
      ]),
    data: {
      tutorial: tutorialView({ done: 0, examples: true }),
      view: shelfView(EXAMPLE_DOC),
    },
    layoutCheck: true,
    name: "tutorial-checklist-start",
    page: "shelf",
  },
  {
    // The shelf loads first and opens on its newest item; the checklist arriving after brings the list back to it.
    act: async (page) => {
      await page.evaluate(
        `globalThis.__emit("tutorial", ${JSON.stringify(tutorialView({ done: 0 }))})`
      );
      await page.waitForTimeout(300);
    },
    check: async (page) => await opensOnChecklist(page),
    data: { view: shelfView() },
    name: "tutorial-opens-on-checklist-shelf-first",
    page: "shelf",
  },
  {
    // The tutorial loads first: the shelf's items arriving after leave the list on the checklist.
    act: async (page) => {
      await page.evaluate(
        `globalThis.__emit("view", ${JSON.stringify(shelfView())})`
      );
      await page.waitForTimeout(300);
    },
    check: async (page) => await opensOnChecklist(page),
    data: {
      tutorial: tutorialView({ done: 0 }),
      view: shelfView(EMPTY_DOC),
    },
    name: "tutorial-opens-on-checklist-tutorial-first",
    page: "shelf",
  },
  {
    data: {
      tutorial: tutorialView({ done: 0, examples: true }),
      view: shelfView(EXAMPLE_DOC),
    },
    layoutCheck: true,
    name: "tutorial-examples-narrow",
    page: "shelf",
    width: 300,
  },
  {
    act: async (page) => {
      await page.getByRole("button", { name: /^Link a window/u }).click();
    },
    check: async (page) =>
      await firstProblem(page, [
        async (on) => await showsText(on, "· 3 of 5"),
        async (on) =>
          isDeepStrictEqual(await calls(on), [
            { arg: { id: "window-link", kind: "taskHint" }, call: "tutorial" },
          ])
            ? null
            : `a task's row must ask for its how-to, and tick nothing off (${JSON.stringify(await calls(on))})`,
      ]),
    data: {
      tutorial: tutorialView({ done: 3, examples: true }),
      view: shelfView(EXAMPLE_DOC),
    },
    name: "tutorial-checklist-progress",
    page: "shelf",
  },
  {
    check: async (page) =>
      await firstProblem(page, [
        async (on) => await bubbleSays(on, "Click each one to link."),
      ]),
    data: {
      tutorial: tutorialView({
        active: {
          anchor: "add-button",
          id: "window-link",
          kind: "task",
          placement: "below",
          text: "⇧⌘L, or + › New Window Link, lists your open windows. Click each one to link.",
          title: "Link a window",
        },
        done: 3,
        examples: true,
      }),
      view: shelfView(EXAMPLE_DOC),
    },
    name: "tutorial-task-hint",
    page: "shelf",
  },
  {
    check: async (page) =>
      await firstProblem(page, [async (on) => await showsText(on, "· Done")]),
    data: {
      tutorial: tutorialView({ complete: true, done: 5 }),
      view: shelfView(),
    },
    name: "tutorial-checklist-done",
    page: "shelf",
  },
  {
    act: async (page) => {
      // An item picked first, so Space and ⌫ would act on it if they got through.
      await page
        .getByText("Check me off: click the circle or press Space", {
          exact: true,
        })
        .click();
      await page.evaluate(
        `globalThis.__emit("tutorial", ${JSON.stringify(tutorialView({ examples: true, spotlight: 1 }))})`
      );
      await page.waitForSelector("[data-spotlight-dimmer]");
    },
    check: async (page) => {
      const picked = await selectedRow(page);
      const before = await callCount(page);

      // The walk takes the keys the list would act on: Space presses the bubble's focused Next instead.
      for (const key of [" ", "Backspace", "ArrowDown"]) {
        // oxlint-disable-next-line no-await-in-loop -- one key after another.
        await page.keyboard.press(key);
      }

      await page.waitForTimeout(300);

      const problem = await bubbleSays(page, "2 of 6");

      if (problem !== null) {
        return problem;
      }

      const duringCalls = await calls(page, before);
      const during = duringCalls.filter((each) => each.call === "apply");

      const stillPicked = await selectedRow(page);

      // The same keys once the walk is over do reach the list: the check above can fail.
      await page.evaluate(
        `globalThis.__emit("tutorial", ${JSON.stringify(tutorialView({ examples: true }))})`
      );
      await page.waitForSelector("[data-spotlight-dimmer]", {
        state: "detached",
      });
      await page.keyboard.press(" ");

      const afterCalls = await calls(page, before);
      const after = afterCalls.filter((each) => each.call === "apply");

      if (picked === null || during.length > 0 || stillPicked !== picked) {
        return `keys during the walkthrough reached the shelf: ${JSON.stringify({ during, picked, stillPicked })}`;
      }

      return after.length === 1
        ? null
        : `without the walkthrough Space must check the item off (${JSON.stringify(after)})`;
    },
    data: {
      tutorial: tutorialView({ examples: true }),
      view: shelfView(EXAMPLE_DOC),
    },
    name: "tutorial-spotlight-list",
    page: "shelf",
  },
  {
    check: async (page) => {
      const asked = await tutorialAsks(page);

      return isDeepStrictEqual(asked, [
        JSON.stringify({ id: "picker", kind: "requestHint" }),
      ])
        ? null
        : `the picker must ask for its tip once its first window shows (${asked.join(", ")})`;
    },

    data: {
      tutorial: tutorialView({ checklist: false, hints: [PICKER_HINT] }),
      view: pickerView({ candidates: CANDIDATES, kind: "ready" }),
    },
    name: "tutorial-picker-hint-request",
    page: "picker",
  },
  {
    act: async (page) => {
      await page
        .getByText("Check me off: click the circle or press Space", {
          exact: true,
        })
        .click();
      await page.keyboard.press("ArrowRight");
      await page.getByRole("button", { name: "Add a field" }).waitFor();
      await page.waitForTimeout(500);

      const asked = await tutorialAsks(page);

      if (
        !isDeepStrictEqual(asked, [
          JSON.stringify({ id: "details-add", kind: "requestHint" }),
        ])
      ) {
        throw new Error(
          `details must ask for the Add tip (${asked.join(", ")})`
        );
      }

      // Main grants it: the bubble shows at Add.
      await page.evaluate(
        `globalThis.__emit("tutorial", ${JSON.stringify(tutorialView({ active: grantedHint(DETAILS_HINT), checklist: false, examples: true }))})`
      );
      await page.waitForTimeout(400);
    },
    check: async (page) =>
      await bubbleSays(page, "None of it is needed when you capture."),
    data: {
      tutorial: tutorialView({
        checklist: false,
        examples: true,
        hints: [DETAILS_HINT],
      }),
      view: shelfView(EXAMPLE_DOC),
    },
    name: "tutorial-details-hint",
    page: "shelf",
  },
  {
    // A tip inside its control covers it, as on the screenshot card: pointing at the control puts it away.
    act: async (page) => {
      await page.waitForSelector("[data-coach-bubble]");
      await page.waitForTimeout(300);

      const free = await page.evaluate(() => {
        const list = document
          .querySelector("[data-coach='shelf-list']")
          ?.getBoundingClientRect();

        const bubble = document
          .querySelector("[data-coach-bubble]")
          ?.getBoundingClientRect();

        if (list === undefined || bubble === undefined) {
          return null;
        }

        const inBubble = (x: number, y: number): boolean =>
          x >= bubble.left &&
          x <= bubble.right &&
          y >= bubble.top &&
          y <= bubble.bottom;

        const corners = [
          [list.left + 12, list.top + 12],
          [list.right - 12, list.bottom - 12],
          [list.left + 12, list.bottom - 12],
          [list.right - 12, list.top + 12],
        ];

        return corners.find(([x = 0, y = 0]) => !inBubble(x, y)) ?? null;
      });

      if (free === null) {
        throw new Error("no point on the list outside the tip");
      }

      const [x = 0, y = 0] = free;

      await page.mouse.move(x, y, { steps: 3 });
      await page.waitForTimeout(200);
    },
    check: async (page) => {
      const asked = await tutorialAsks(page);

      return asked.includes(
        JSON.stringify({ id: "inside-tip", kind: "dismissHint" })
      )
        ? null
        : `pointing at the control must put an inside tip away (${asked.join(", ")})`;
    },
    data: {
      tutorial: tutorialView({
        active: {
          anchor: "shelf-list",
          id: "inside-tip",
          kind: "hint",
          placement: "inside",
          text: "Hover for Copy and Add to Shelf.",
          title: null,
        },
        checklist: false,
      }),
      view: shelfView(EXAMPLE_DOC),
    },
    name: "tutorial-inside-tip-pointed-at",
    page: "shelf",
  },
  {
    act: async (page) => {
      await page.waitForSelector("[data-spotlight-dimmer]");
      await page.waitForTimeout(200);

      const first = await bubbleFocus(page);

      // The note field takes focus as the page loads: the walk must take it back.
      if (first !== "Next") {
        throw new Error(
          `focus must start on the bubble's Next, not ${first ?? "outside the bubble"}`
        );
      }

      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(200);
    },
    check: async (page) =>
      await firstProblem(page, [
        async (on) => await bubbleSays(on, "2 of 6"),
        async (on) => await bubbleSays(on, "Where it came from"),
        async (on) => {
          const label = await bubbleFocus(on);

          return label === "Next"
            ? null
            : `focus must stay on the bubble's Next at step 2, not ${label ?? "outside the bubble"}`;
        },
      ]),
    data: {
      tutorial: tutorialView({ examples: true, spotlight: 1 }),
      view: shelfView(EXAMPLE_DOC),
    },
    name: "tutorial-spotlight-source",
    page: "shelf",
  },
  {
    act: async (page) => {
      await page.keyboard.press("p");
      await page.keyboard.press("2");
    },
    // Round 8: a quit locking and unlocking the page pushes the view again; that is no change to the marks.
    check: async (page) => {
      const before = await dirtyReports(page);

      for (const quitting of [true, false]) {
        // oxlint-disable-next-line no-await-in-loop -- lock, then unlock.
        await page.evaluate(
          `globalThis.__emit("view", ${JSON.stringify({ ...drawingView(IMAGE.pins, false), quitting })})`
        );
        // oxlint-disable-next-line no-await-in-loop -- each push renders before the next.
        await page.waitForTimeout(100);
      }

      const after = await dirtyReports(page);
      const pins = await drawingPins(page).count();

      return after === before && pins === 3
        ? null
        : `locking and unlocking the page reported ${after - before} changes and left ${pins} of 3 pins`;
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
      // The toolbar restyles what is selected, so focus there keeps the pin (feedback round 13).
      const keptOnToolbar = await selectedPin(page).count();

      // The window losing focus lets go of it, so ⌫ typed on coming back never removes it.
      await page.evaluate("window.dispatchEvent(new FocusEvent('blur'))");

      const selectedAfterLeaving = await selectedPin(page).count();

      await page.keyboard.press("Backspace");
      await page.keyboard.press("Delete");

      const pinsAfterLeaving = await drawingPins(page).count();

      await page.keyboard.press("2");
      await page.keyboard.press("Backspace");

      const pinsAfterRemoving = await drawingPins(page).count();

      if (
        keptOnToolbar !== 1 ||
        selectedAfterLeaving > 0 ||
        pinsAfterLeaving !== 3
      ) {
        return `focus on the toolbar kept ${keptOnToolbar} pins selected; after the window blurred ${selectedAfterLeaving} were, and ⌫ left ${pinsAfterLeaving} of 3`;
      }

      if (pinsAfterRemoving !== 2) {
        return `2 then ⌫ left ${pinsAfterRemoving} pins, not 2`;
      }

      // Round 7: Retry in a held quit saves the marks, as Save does.
      await page.evaluate('globalThis.__emit("saveForQuit", null)');
      await page.waitForTimeout(200);

      const sent = await calls(page);

      return isDeepStrictEqual(sent, [
        { arg: { copy: false, forQuit: true, pins: 2 }, call: "save" },
      ])
        ? null
        : `saveForQuit with a pin removed sent ${JSON.stringify(sent)}, not one save of 2 pins`;
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
  {
    // Words still in the open text field are a mark the quit counts and Retry saves (red-team round 7).
    act: async (page) => {
      await page.getByRole("button", { exact: true, name: "Text" }).click();
      await page
        .locator("canvas")
        .first()
        .click({ position: { x: 150, y: 100 } });
      await page
        .getByRole("textbox", { exact: true, name: "Text" })
        .fill("Words still being typed");
    },
    check: async (page) => {
      const dirty = await page.evaluate("globalThis.__dirty.at(-1)");
      const field = await page.evaluate("document.activeElement?.value");

      if (dirty !== true || field !== "Words still being typed") {
        return `with words in the open text field the page reported dirty ${String(dirty)}, field ${String(field)}`;
      }

      await page.evaluate('globalThis.__emit("saveForQuit", null)');
      await page.waitForTimeout(200);
      const retry = await calls(page);

      // The user's own Save is not one a cancelled quit can stop.
      await page.getByRole("button", { exact: true, name: "Save" }).click();
      await page.waitForTimeout(200);
      const both = await calls(page);

      const expected = [
        { arg: { copy: false, forQuit: true, pins: 0 }, call: "save" },
        { arg: { copy: false, forQuit: false, pins: 0 }, call: "save" },
      ];

      return isDeepStrictEqual(retry, expected.slice(0, 1)) &&
        isDeepStrictEqual(both, expected)
        ? null
        : `saveForQuit then Save sent ${JSON.stringify(both)}, not ${JSON.stringify(expected)}`;
    },
    data: { view: BLANK_DRAWING },
    name: "drawing-text-draft",
    page: "drawing",
  },
  {
    // Round 8: while a quit is under way the page is locked; Retry still saves it, words being typed included.
    act: async (page) => {
      await drawStroke(page, 160);
      await page.getByRole("button", { exact: true, name: "Text" }).click();
      await page
        .locator("canvas")
        .first()
        .click({ position: { x: 150, y: 100 } });
      await page
        .getByRole("textbox", { exact: true, name: "Text" })
        .fill("Words still being typed");
      await page.evaluate(
        `globalThis.__emit("view", ${JSON.stringify({ ...BLANK_DRAWING, quitting: true })})`
      );
      await page
        .getByRole("status")
        .getByText("Locked while Inset asks about quitting")
        .waitFor();
    },
    check: async (page) => {
      const locked = await lockedPageCheck(page);

      if (locked !== null) {
        return locked;
      }

      await page.evaluate('globalThis.__emit("saveForQuit", null)');
      await retrySent(page);
      const sent = await calls(page);

      const expected = [
        { arg: { copy: false, forQuit: true, pins: 0 }, call: "save" },
      ];

      return isDeepStrictEqual(sent, expected)
        ? null
        : `Retry on the locked page sent ${JSON.stringify(sent)}, not ${JSON.stringify(expected)}`;
    },
    data: { view: BLANK_DRAWING },
    name: "drawing-quit-locked",
    page: "drawing",
  },
  {
    // Round 8: the page is locked while its own save is on its way, and unlocks when it ends.
    act: async (page) => {
      await drawStroke(page, 160);
      await page.getByRole("button", { exact: true, name: "Text" }).click();
      await page
        .locator("canvas")
        .first()
        .click({ position: { x: 150, y: 100 } });
      await page
        .getByRole("textbox", { exact: true, name: "Text" })
        .fill("Saving these words");
      await page.getByRole("button", { exact: true, name: "Save" }).click();
    },
    check: async (page) => {
      const locked = await lockedPageCheck(page);

      if (locked !== null) {
        return `during the save, ${locked}`;
      }

      await page.evaluate("globalThis.__releaseSave()");
      await page.waitForTimeout(200);

      const saveEnabled = await page
        .getByRole("button", { exact: true, name: "Save" })
        .isEnabled();

      return saveEnabled ? null : "Save stayed disabled once the save ended";
    },
    data: { holdSave: true, view: BLANK_DRAWING },
    name: "drawing-save-locked",
    page: "drawing",
  },
  {
    // Red-team round 8: a stroke still held down counts before a quit decides, and a quit's lock stops it changing.
    act: async (page) => {
      await page.mouse.move(200, 160);
      await page.mouse.down();
      await page.mouse.move(320, 200, { steps: 6 });
      await page.waitForTimeout(100);
      await page.evaluate(
        "globalThis.__held = globalThis.__dirty.at(-1) === true"
      );
      await page.evaluate(
        `globalThis.__emit("view", ${JSON.stringify({ ...BLANK_DRAWING, quitting: true })})`
      );
      await page
        .getByRole("status")
        .getByText("Locked while Inset asks about quitting")
        .waitFor();
      await page.waitForTimeout(100);
    },
    check: async (page) => {
      const held = await page.evaluate("globalThis.__held");
      const canvas = "document.querySelector('canvas').toDataURL()";

      const before = {
        picture: await page.evaluate(canvas),
        reports: await dirtyReports(page),
      };

      await page.mouse.move(440, 300, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(150);

      const after = {
        picture: await page.evaluate(canvas),
        reports: await dirtyReports(page),
      };

      const problems = [
        held === true
          ? null
          : "the page reported its stroke still held down as no change",
        isDeepStrictEqual(after, before)
          ? null
          : `moving and letting go on the locked page changed ${after.picture === before.picture ? "nothing drawn" : "the drawing"} and reported ${after.reports - before.reports} changes`,
      ].filter((problem) => problem !== null);

      if (problems.length > 0) {
        return problems.join("; ");
      }

      await page.evaluate('globalThis.__emit("saveForQuit", null)');
      await retrySent(page);
      const sent = await calls(page);

      const expected = [
        { arg: { copy: false, forQuit: true, pins: 0 }, call: "save" },
      ];

      return isDeepStrictEqual(sent, expected)
        ? null
        : `Retry sent ${JSON.stringify(sent)}, not ${JSON.stringify(expected)}`;
    },
    data: { view: BLANK_DRAWING },
    name: "drawing-quit-mid-stroke",
    page: "drawing",
  },
  {
    // Red-team round 8: the menu bar's Undo and the keys change nothing behind the Discard confirm.
    act: async (page) => {
      await drawStroke(page, 160);
      await page.evaluate('globalThis.__emit("confirmClose", "none")');
      await page.getByRole("alertdialog").waitFor();
    },
    check: async (page) => {
      const mod = await commandKey(page);
      const before = await dirtyReports(page);

      await page.evaluate('globalThis.__emit("edit", "undo")');
      await page.keyboard.press(`${mod}+z`);
      await page.waitForTimeout(150);

      const after = await dirtyReports(page);
      const open = await page.getByRole("alertdialog").count();

      return after === before && open === 1
        ? null
        : `behind the Discard confirm the page reported ${after - before} changes, and ${open} confirms are open`;
    },
    data: { view: BLANK_DRAWING },
    name: "drawing-confirm-locked",
    page: "drawing",
  },
  {
    // Opus round 8: New Drawing or Annotate brought this unsaved drawing forward instead, and the page says why.
    act: async (page) => {
      await drawStroke(page, 160);
      await page.evaluate('globalThis.__emit("openRefused", null)');
      await page.getByRole("status").waitFor();
    },
    check: async (page) => {
      const said = await page.getByRole("status").textContent();
      const expected = "Save or discard this drawing to open another";

      return said === expected
        ? null
        : `the page said ${JSON.stringify(said)}, not ${JSON.stringify(expected)}`;
    },
    data: { view: BLANK_DRAWING },
    name: "drawing-open-refused",
    page: "drawing",
  },
  {
    // Opus and Sol round 8: the close confirm says what the shelf holds of the drawing.
    act: async (page) => {
      await drawStroke(page, 160);
      await page.evaluate('globalThis.__emit("confirmClose", "asIs")');
      await page.getByRole("alertdialog").waitFor();
    },
    check: async (page) => {
      const said: Record<string, string | null> = {};

      for (const onShelf of ["asIs", "earlier", "none"]) {
        // oxlint-disable-next-line no-await-in-loop -- one confirm after another.
        await page.evaluate(
          `globalThis.__emit("confirmClose", ${JSON.stringify(onShelf)})`
        );
        // oxlint-disable-next-line no-await-in-loop -- one confirm after another.
        await page.getByRole("alertdialog").waitFor();
        // oxlint-disable-next-line no-await-in-loop -- one confirm after another.
        said[onShelf] = await page
          .getByRole("alertdialog")
          .locator("[data-slot=alert-dialog-description]")
          .textContent();
        // oxlint-disable-next-line no-await-in-loop -- one confirm after another.
        await page.getByRole("button", { name: "Keep Drawing" }).click();
        // oxlint-disable-next-line no-await-in-loop -- one confirm after another.
        await page.getByRole("alertdialog").waitFor({ state: "detached" });
      }

      const expected = {
        asIs: "It is already on the shelf.",
        earlier: "The shelf keeps it without your latest changes.",
        none: "It is not on the shelf yet.",
      };

      return isDeepStrictEqual(said, expected)
        ? null
        : `the confirm said ${JSON.stringify(said)}, not ${JSON.stringify(expected)}`;
    },
    data: { view: BLANK_DRAWING },
    name: "drawing-confirm-on-shelf",
    page: "drawing",
  },
  {
    // Opus and Sol round 8: on an image, the confirm says when the shelf's picture already has the marks.
    act: async (page) => {
      await drawStroke(page, 160);
      await page.evaluate('globalThis.__emit("confirmClose", "asIs")');
      await page.getByRole("alertdialog").waitFor();
    },
    check: async (page) => {
      const said = await page
        .getByRole("alertdialog")
        .locator("[data-slot=alert-dialog-description]")
        .textContent();

      const expected = "The image on the shelf already has these marks.";

      return said === expected
        ? null
        : `the confirm said ${JSON.stringify(said)}, not ${JSON.stringify(expected)}`;
    },
    data: { view: drawingView(IMAGE.pins, false) },
    name: "drawing-confirm-image-on-shelf",
    page: "drawing",
  },
  {
    // Feedback round 13: a box drawn picks Select and shows its eight handles; a corner resizes it, ⌘Z takes it back, an arrow has its two ends.
    act: async (page) => {
      await page.keyboard.press("r");
      await dragCanvas(page, [300, 250], [560, 400]);
      await page.keyboard.press("a");
      await dragCanvas(page, [760, 160], [600, 270]);
      await clickCanvas(page, 430, 251);
    },
    check: async (page) => {
      const mod = await commandKey(page);

      const selectTool = await page
        .getByRole("button", { exact: true, name: "Select" })
        .getAttribute("aria-pressed");

      const handles = await page.locator("[data-handle]").count();
      const corner = page.locator('[data-handle="1,1"]');
      const before = await corner.boundingBox();

      if (selectTool !== "true" || handles !== 8 || before === null) {
        return `after drawing a box Select was pressed ${String(selectTool)} and the box had ${handles} handles, not 8`;
      }

      // 10 px off the handle's middle on both axes: inside its 24 px target, outside the 8 px reach it had.
      const grab = {
        x: before.x + before.width / 2 + 10,
        y: before.y + before.height / 2 + 10,
      };

      await page.mouse.move(grab.x, grab.y);
      await page.mouse.down();
      await page.mouse.move(grab.x + 60, grab.y + 40, { steps: 6 });
      await page.mouse.up();

      const resized = await corner.boundingBox();

      await page.keyboard.press(`${mod}+z`);
      await clickCanvas(page, 430, 251);

      const undone = await corner.boundingBox();

      await clickCanvas(page, 680, 215);

      const ends = await attributes(page, "[data-handle]", "data-handle");

      const moved = (box: typeof before | null, dx: number, dy: number) =>
        box !== null &&
        Math.abs(box.x - before.x - dx) < 2 &&
        Math.abs(box.y - before.y - dy) < 2;

      if (!moved(resized, 60, 40) || !moved(undone, 0, 0)) {
        return `the corner went from ${JSON.stringify(before)} to ${JSON.stringify(resized)}, and after ⌘Z to ${JSON.stringify(undone)}`;
      }

      return isDeepStrictEqual(ends, ["from", "to"])
        ? null
        : `the arrow showed handles ${JSON.stringify(ends)}, not its two ends`;
    },
    data: { view: drawingView(IMAGE.pins, false) },
    name: "drawing-select-handles",
    page: "drawing",
  },
  {
    // Feedback round 13: a marquee picks the marks it holds whole; ⌘D copies them, ⌫ deletes, and ⌘Z brings each step back.
    act: async (page) => {
      await page.keyboard.press("r");
      await dragCanvas(page, [120, 120], [280, 230]);
      await page.keyboard.press("o");
      await dragCanvas(page, [330, 140], [480, 250]);
      await typeText(page, 600, 190, "Left out");
      await page.keyboard.press("x");
      await dragCanvas(page, [150, 400], [420, 440]);
      await page.keyboard.press("v");
      await dragCanvas(page, [90, 90], [520, 300], false);
    },
    check: async (page) => {
      const mod = await commandKey(page);
      const marquee = await page.locator("[data-marquee]").count();

      const held = await attributes(
        page,
        "[data-selected-mark]",
        "data-selected-mark"
      );

      await page.mouse.up();

      const group = await page.locator("[data-selection-group]").count();
      const before = await canvasPicture(page);

      await page.keyboard.press(`${mod}+d`);

      const copies = await attributes(
        page,
        "[data-selected-mark]",
        "data-selected-mark"
      );

      const duplicated = await canvasPicture(page);

      await page.keyboard.press("Backspace");

      const left = await page.locator("[data-selected-mark]").count();
      const deleted = await canvasPicture(page);

      await page.keyboard.press(`${mod}+z`);

      const back = await canvasPicture(page);

      await page.keyboard.press(`${mod}+z`);

      const first = await canvasPicture(page);

      const problems = [
        marquee === 1 && isDeepStrictEqual(held, ["0", "1"])
          ? null
          : `the marquee showed ${marquee} times and held ${JSON.stringify(held)}, not the box and the ellipse`,
        group === 1 ? null : `${group} group outlines after letting go`,
        isDeepStrictEqual(copies, ["4", "5"]) && duplicated !== before
          ? null
          : `⌘D selected ${JSON.stringify(copies)}, not the two copies`,
        left === 0 && deleted === before
          ? null
          : `⌫ left ${left} selected and ${deleted === before ? "the drawing as before" : "another drawing"}`,
        back === duplicated && first === before
          ? null
          : "⌘Z did not bring back the copies, then the drawing before them",
      ].filter((problem) => problem !== null);

      return problems.length === 0 ? null : problems.join("; ");
    },
    data: { view: BLANK_DRAWING },
    keepPointer: true,
    name: "drawing-marquee",
    page: "drawing",
  },
  {
    // Feedback round 13: text is in Excalifont while it is typed, on the canvas, and in the saved picture; a double-click edits it in place.
    act: async (page) => {
      await typeText(page, 200, 200, "Fix this");
      const at = await onCanvas(page, 240, 200);
      await page.mouse.dblclick(at.x, at.y);
      await page.keyboard.press("End");
      await page.keyboard.type(" first");
    },
    check: async (page) => {
      const field = page.getByRole("textbox", { exact: true, name: "Text" });
      const value = await field.inputValue();

      const family = await field.evaluate(
        (node) => getComputedStyle(node).fontFamily
      );

      const loaded = await page.evaluate(
        "[...document.fonts].some((face) => face.family.replaceAll('\"', '') === 'Excalifont' && face.status === 'loaded')"
      );

      if (
        value !== "Fix this first" ||
        !family.replaceAll('"', "").startsWith("Excalifont") ||
        loaded !== true
      ) {
        return `the field held ${JSON.stringify(value)} in ${family}, Excalifont loaded ${String(loaded)}`;
      }

      await page.keyboard.press("Enter");
      await keepSavedPng(page);
      await page.getByRole("button", { exact: true, name: "Save" }).click();
      await page.waitForFunction("globalThis.__png !== undefined");

      const saved = PngSchema.parse(await page.evaluate("globalThis.__png"));

      if (saved === null) {
        return "the save sent no picture";
      }

      const bytes = Buffer.from(saved);

      await writeFile(
        path.join(
          OUT,
          `drawing-text-edit-export-${(await isDark(page)) ? "dark" : "light"}.png`
        ),
        bytes
      );

      const widths = WidthsSchema.parse(
        await page.evaluate(`(async () => {
          const text = "Fix this first";
          await document.fonts.load('20px "Inter Variable"', text);
          const context = new OffscreenCanvas(1, 1).getContext("2d");
          context.font = '400 20px "Excalifont"';
          const sketch = context.measureText(text).width;
          context.font = '400 20px "Inter Variable"';
          const plain = context.measureText(text).width;
          return { plain, sketch };
        })()`)
      );

      // The export trims to the text plus 24 px each side, at twice the size: its width tells which face it measured.
      const width = bytes.readUInt32BE(16) / 2 - 48;

      const sketched =
        width >= widths.sketch - 0.5 && width <= widths.sketch + 2;

      return sketched && Math.abs(width - widths.plain) > 4
        ? null
        : `the saved picture is ${width} px of text wide; Excalifont makes ${widths.sketch}, Inter ${widths.plain}`;
    },
    data: { view: BLANK_DRAWING },
    name: "drawing-text-edit",
    page: "drawing",
  },
  {
    // Review 4501523118: the menu bar's Undo and Redo with a text reopened act in its field; they never move the drawing's history under it.
    act: async (page) => {
      await typeText(page, 200, 200, "Hello");
      await page.evaluate(
        "globalThis.__hello = document.querySelector('canvas').toDataURL()"
      );
      const at = await onCanvas(page, 215, 200);
      await page.mouse.dblclick(at.x, at.y);

      for (const kind of ["undo", "redo"]) {
        // oxlint-disable-next-line no-await-in-loop -- each renders before the next, or React would merge them into no change.
        await page.evaluate(`globalThis.__emit("edit", "${kind}")`);
        // oxlint-disable-next-line no-await-in-loop -- as above.
        await page.waitForTimeout(100);
      }
    },
    check: async (page) => {
      const field = page.getByRole("textbox", { exact: true, name: "Text" });

      const words = async (): Promise<string | null> =>
        (await field.count()) > 0 ? await field.inputValue() : null;

      const reopened = await words();

      await page.keyboard.press("End");
      await page.keyboard.type(" world");
      await page.evaluate('globalThis.__emit("edit", "undo")');

      const undone = await words();

      await page.evaluate('globalThis.__emit("edit", "redo")');

      const redone = await words();

      await page.keyboard.press("Enter");

      const helloWorld = await canvasPicture(page);
      const hello = String(await page.evaluate("globalThis.__hello"));
      const at = await onCanvas(page, 215, 200);

      // The toolbar's Undo takes focus from the field, which keeps its words as one step; Undo then takes that step back.
      await page.mouse.dblclick(at.x, at.y);
      await page.keyboard.press("End");
      await page.keyboard.type("!");
      await page.getByRole("button", { exact: true, name: "Undo" }).click();

      const toolbarUndo = await canvasPicture(page);
      const openAfterToolbar = await field.count();

      await page.evaluate('globalThis.__emit("edit", "undo")');
      await page.waitForTimeout(100);

      const menuUndo = await canvasPicture(page);

      const problems = [
        reopened === "Hello"
          ? null
          : `menu Undo and Redo on the reopened text left the field ${JSON.stringify(reopened)}`,
        undone === "Hello" && redone === "Hello world"
          ? null
          : `menu Undo then Redo after typing left ${JSON.stringify(undone)}, then ${JSON.stringify(redone)}`,
        helloWorld === hello
          ? "Return after the field's Undo and Redo did not keep “Hello world”"
          : null,
        toolbarUndo === helloWorld && openAfterToolbar === 0
          ? null
          : `the toolbar's Undo with the field open left it open ${openAfterToolbar} times and ${toolbarUndo === helloWorld ? "“Hello world”" : "another drawing"}`,
        menuUndo === hello
          ? null
          : "menu Undo with the field closed did not take the drawing back to “Hello”",
      ].filter((problem) => problem !== null);

      return problems.length === 0 ? null : problems.join("; ");
    },
    data: { view: BLANK_DRAWING },
    name: "drawing-text-native-undo",
    page: "drawing",
  },
  {
    // Sol review, round 13: a saved image opens on its bare picture with the marks it was saved with, each selectable and editable again, and saves them drawn in once.
    act: async (page) => {
      await keepSavedMarks(page);
      const edge = await onImage(page, 480, 160);
      await page.mouse.click(edge.x, edge.y);
    },
    check: async (page) => {
      const selectTool = await page
        .getByRole("button", { exact: true, name: "Select" })
        .getAttribute("aria-pressed");

      const picked = await attributes(
        page,
        "[data-selected-mark]",
        "data-selected-mark"
      );

      const handles = await page.locator("[data-handle]").count();
      const under = await page.locator("img").first().getAttribute("src");
      const words = await onImage(page, 340, 315);

      await page.mouse.dblclick(words.x, words.y);

      const field = page.getByRole("textbox", { exact: true, name: "Text" });
      const reopened = await field.inputValue();

      await page.keyboard.press("End");
      await page.keyboard.type(" first");
      await page.keyboard.press("Enter");
      await page.getByRole("button", { exact: true, name: "Save" }).click();

      const kept = await takeKept(page);
      const [box, text] = KEPT;

      const problems = [
        selectTool === "true" &&
        isDeepStrictEqual(picked, ["0"]) &&
        handles === 8
          ? null
          : `opening with kept marks pressed Select ${String(selectTool)}; a click on the box picked ${JSON.stringify(picked)} with ${handles} handles`,
        under === `/.fixtures/${LOGIN.file}`
          ? null
          : `the picture under the marks was ${String(under)}, not the bare screenshot`,
        reopened === "Fix this"
          ? null
          : `a double-click on the kept text opened ${JSON.stringify(reopened)}`,
        isDeepStrictEqual(kept, {
          marks: [box, { ...text, text: "Fix this first" }],
          pins: [],
          width: LOGIN.widthPx,
        })
          ? null
          : `Save kept ${JSON.stringify(kept)}, not the box and the edited text drawn into the ${LOGIN.widthPx} px screenshot`,
      ].filter((problem) => problem !== null);

      return problems.length === 0 ? null : problems.join("; ");
    },
    data: { pictureBytes: true, view: drawingView([], false, KEPT) },
    name: "drawing-reopen-editable",
    page: "drawing",
  },
  {
    // Round 13: a new drawing keeps its marks at its trimmed picture's corner and its pin in that picture's pixels, and opens blank again with both editable.
    act: async (page) => {
      await keepSavedMarks(page);
      await page.keyboard.press("r");
      await dragCanvas(page, [200, 200], [440, 340]);
      // Inside the box, so moving the pin later doesn't change the picture's frame.
      await page.keyboard.press("p");
      await clickCanvas(page, 300, 300);
      await page.getByRole("button", { exact: true, name: "Save" }).click();

      const kept = await takeKept(page);
      const [pin] = kept.pins;

      await page.evaluate(`(() => {
        globalThis.__first = ${JSON.stringify(kept)};
        globalThis.__emit("view", ${JSON.stringify({
          ...BLANK_DRAWING,
          marks: [
            ...kept.marks,
            {
              at: { x: (pin?.x ?? 0) / 2, y: (pin?.y ?? 0) / 2 },
              kind: "pin",
            },
          ],
          seq: 2,
        })});
      })()`);
      await page.waitForTimeout(200);

      const box = KeptBoxSchema.parse(kept.marks[0]);

      await clickCanvas(page, (box.from.x + box.to.x) / 2, box.from.y);
    },
    check: async (page) => {
      const first = KeptSchema.parse(await page.evaluate("globalThis.__first"));
      const box = KeptBoxSchema.parse(first.marks[0]);
      const [pin] = first.pins;
      const title = await page.locator("h1").textContent();

      const selectTool = await page
        .getByRole("button", { exact: true, name: "Select" })
        .getAttribute("aria-pressed");

      const handles = await page.locator("[data-handle]").count();

      // The picture is trimmed to everything on it plus 24 px, so the box's outer edge sits 24 to 25 px from its corner.
      const left = Math.min(box.from.x, box.to.x) - box.width / 2;
      const top = Math.min(box.from.y, box.to.y) - box.width / 2;
      // The box was drawn from 200, 200 on the page: the pin, at 300, 300, moved with it, in the picture's pixels (2 per px).
      const shift = { x: 200 - box.from.x, y: 200 - box.from.y };
      const pinAt = { x: (300 - shift.x) * 2, y: (300 - shift.y) * 2 };

      await page.keyboard.press("1");
      await page.keyboard.press("ArrowRight");
      await page.getByRole("button", { exact: true, name: "Save" }).click();

      const second = await takeKept(page);

      const problems = [
        first.marks.length === 1 && isDeepStrictEqual(first.pins, [pinAt])
          ? null
          : `the first save kept ${first.marks.length} marks and pins ${JSON.stringify(first.pins)}, not the box and a pin at ${JSON.stringify(pinAt)}`,
        left >= 24 && left <= 25 && top >= 24 && top <= 25
          ? null
          : `the kept drawing's nearest edges are ${left}, ${top} from its corner, not 24 to 25`,
        title === "Drawing" && selectTool === "true" && handles === 8
          ? null
          : `opened again it read ${JSON.stringify(title)}, pressed Select ${String(selectTool)}, and a click on the box showed ${handles} handles`,
        isDeepStrictEqual(second, {
          marks: first.marks,
          pins: [{ x: (pin?.x ?? 0) + 1, y: pin?.y ?? 0 }],
          width: first.width,
        })
          ? null
          : `nudging the pin 1 px and saving again kept ${JSON.stringify(second)}, after ${JSON.stringify(first)}`,
      ].filter((problem) => problem !== null);

      return problems.length === 0 ? null : problems.join("; ");
    },
    data: { view: BLANK_DRAWING },
    name: "drawing-reopen-blank",
    page: "drawing",
  },
  {
    // Round 13: Tab from a selected box to an ink and the stroke keeps it selected, so Return and Space restyle it.
    act: async (page) => {
      await page.keyboard.press("r");
      await dragCanvas(page, [200, 200], [440, 340]);
      await tabTo(page, "Red");
      await page.keyboard.press("Enter");
      await tabTo(page, "Thick stroke");
      await page.keyboard.press("Space");
    },
    check: async (page) => {
      const red = (await isDark(page)) ? "#f87171" : "#dc2626";
      const selected = await page.locator("[data-selected-mark]").count();

      const pressed = await attributes(
        page,
        "[aria-pressed=true]",
        "aria-label"
      );

      const edge = await inkDown(page, 320, 190, 210);

      const problems = [
        selected === 1
          ? null
          : `${selected} marks stayed selected with focus in the toolbar`,
        isDeepStrictEqual(pressed, ["Select", "Red", "Thick stroke"])
          ? null
          : `the toolbar pressed ${JSON.stringify(pressed)}`,
        near(edge.color, red) && edge.run >= 6
          ? null
          : `Return on Red and Space on the stroke drew ${JSON.stringify(edge)}, not a thick ${red} edge`,
      ].filter((problem) => problem !== null);

      return problems.length === 0 ? null : problems.join("; ");
    },
    data: { view: BLANK_DRAWING },
    name: "drawing-keyboard-restyle",
    page: "drawing",
  },
  {
    // Feedback round 13: picking an ink and the thick stroke with a box selected restyles it, one ⌘Z step each.
    act: async (page) => {
      await page.keyboard.press("r");
      await dragCanvas(page, [200, 200], [440, 340]);
      await page.getByRole("button", { exact: true, name: "Red" }).click();
      await page
        .getByRole("button", { exact: true, name: "Thick stroke" })
        .click();
    },
    check: async (page) => {
      const mod = await commandKey(page);
      const red = (await isDark(page)) ? "#f87171" : "#dc2626";
      const ink = (await isDark(page)) ? "#f5f5f5" : "#171717";

      const pressed = await attributes(
        page,
        "[aria-pressed=true]",
        "aria-label"
      );

      const thick = await inkDown(page, 320, 190, 210);

      await page.keyboard.press(`${mod}+z`);

      const thin = await inkDown(page, 320, 190, 210);

      await page.keyboard.press(`${mod}+z`);

      const before = await inkDown(page, 320, 190, 210);

      const problems = [
        isDeepStrictEqual(pressed, ["Select", "Red", "Thick stroke"])
          ? null
          : `the toolbar pressed ${JSON.stringify(pressed)}`,
        near(thick.color, red) && thick.run >= 6
          ? null
          : `the restyled box drew ${JSON.stringify(thick)}, not a thick ${red} edge`,
        near(thin.color, red) && thin.run <= 3
          ? null
          : `one ⌘Z left ${JSON.stringify(thin)}, not a thin red edge`,
        near(before.color, ink)
          ? null
          : `two ⌘Z left ${JSON.stringify(before)}, not the ink it was drawn in`,
      ].filter((problem) => problem !== null);

      return problems.length === 0 ? null : problems.join("; ");
    },
    data: { view: BLANK_DRAWING },
    name: "drawing-restyle",
    page: "drawing",
  },
  {
    // Round 13: a lock that ends a stroke still held, then lifts, leaves it ended: moving on and letting go add nothing, and one ⌘Z clears it.
    act: async (page) => {
      await page.evaluate(
        "globalThis.__blank = document.querySelector('canvas').toDataURL()"
      );
      await dragCanvas(page, [200, 200], [320, 260], false);

      for (const quitting of [true, false]) {
        // oxlint-disable-next-line no-await-in-loop -- lock, then unlock.
        await page.evaluate(
          `globalThis.__emit("view", ${JSON.stringify({ ...BLANK_DRAWING, quitting })})`
        );
        // oxlint-disable-next-line no-await-in-loop -- each push renders before the next.
        await page.waitForTimeout(100);
      }
    },
    check: async (page) => {
      const mod = await commandKey(page);
      const ended = await canvasPicture(page);
      const further = await onCanvas(page, 440, 330);

      await page.mouse.move(further.x, further.y, { steps: 6 });
      await page.mouse.up();

      const after = await canvasPicture(page);

      await page.keyboard.press(`${mod}+z`);

      const undone = await canvasPicture(page);
      const blank = String(await page.evaluate("globalThis.__blank"));

      if (after !== ended) {
        return "moving on and letting go after the lock lifted changed the drawing";
      }

      return undone === blank
        ? null
        : "one ⌘Z after the lock did not leave the page blank";
    },
    data: { view: BLANK_DRAWING },
    keepPointer: true,
    name: "drawing-lock-lifts-mid-stroke",
    page: "drawing",
  },
];

const SIZES: Readonly<Record<PageName, { width: number; height: number }>> = {
  drawing: { height: 720, width: 1040 },
  onboarding: { height: 640, width: 460 },
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
    locale: "en-US",
    reducedMotion: scene.reducedMotion === true ? "reduce" : "no-preference",
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
  if (scene.keepPointer !== true) {
    await page.mouse.move(1, 1);
    await page.waitForTimeout(100);
  }

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

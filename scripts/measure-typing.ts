/**
 * What everyday keys cost on a full shelf, in three actions: 40 characters
 * typed into the composer, 11 typed into the search field, and ↓ pressed ten
 * times to move the selection down the list. For each it reports the time
 * Chromium takes, how many item rows React rendered per key (a row whose
 * `<li data-item-id>` got new props in a commit, counted through React's
 * DevTools hook, so the app carries no counter), and how often the shelf
 * measured whether its words show cut (`hidesWords` in
 * src/renderer/shared/clamp.tsx, the renderer's only `querySelectorAll("*")`).
 * Runs the built renderer with the screens bridge, on a 200-item shelf and on
 * an empty one: the empty shelf is the floor, what Playwright and the
 * composer cost by themselves.
 *
 *   pnpm build && node scripts/measure-typing.ts [runs]
 */
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

import { chromium } from "playwright";
import type { Browser } from "playwright";
import { z } from "zod";

const ROOT = path.resolve(import.meta.dirname, "..");
const RENDERER = path.join(ROOT, "out", "renderer");
const BRIDGE = path.join(ROOT, "scripts", "fixtures", "screens-bridge.js");

const RUNS = Number(process.argv[2] ?? "7");
const TYPED = "Ask the caretaker for the keys on Friday";
const SEARCHED = "Protokoll 1";
const MOVES = 10;

const uuid = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const INBOX = uuid(1);

const textItem = (n: number) => ({
  attachments: [],
  color: null,
  context:
    n % 3 === 0
      ? {
          app: "Safari",
          appLink: null,
          title: `Pull request ${n} · Fix the flaky upload test on CI`,
          url: `https://github.com/inset/shelf/pull/${n}`,
        }
      : null,
  createdAt: new Date(Date.UTC(2026, 10, 25, 9, 0, n)).toISOString(),
  description: n % 4 === 0 ? `Description ${n}: what the movers asked.` : "",
  done: n % 7 === 0,
  due: null,
  html: null,
  id: uuid(100 + n),
  kind: "text",
  links: [],
  sectionId: INBOX,
  steps: [],
  text: `Note ${n}: Die Bildschirmaufnahme und Systemaudio fehlen in der Quartalsübersicht, siehe Protokoll ${n}`,
  via: "typed",
  windows: [],
});

const view = (count: number) => ({
  canUndo: false,
  discarded: null,
  doc: {
    activeSectionId: INBOX,
    items: Array.from({ length: count }, (_, n) => textItem(n)),
    schemaVersion: 4,
    sections: [{ id: INBOX, name: "Inbox" }],
  },
  focus: null,
  notSaved: [],
  status: {
    floatOnTop: true,
    keys: "granted",
    problem: null,
    quitPrompt: null,
    readOnly: false,
    saveError: null,
    selectionCapture: true,
  },
});

/** Counts every `querySelectorAll("*")`, which only `hidesWords` asks. */
const COUNT_MEASURES = `(() => {
  const original = Element.prototype.querySelectorAll;
  globalThis.__measures = 0;
  Element.prototype.querySelectorAll = function (selector) {
    if (selector === "*") {
      globalThis.__measures += 1;
    }
    return original.call(this, selector);
  };
})();`;

/**
 * Counts item rows rendered: after each commit, walks the parts of the tree
 * React worked on (a fiber whose child is still its old one was skipped) and
 * counts the rows (their <li data-item-id>) whose props are new.
 */
const COUNT_ROWS = `(() => {
  globalThis.__rows = 0;
  const isRow = (fiber) =>
    fiber.tag === 5 &&
    fiber.memoizedProps !== null &&
    typeof fiber.memoizedProps["data-item-id"] === "string";
  const visit = (fiber) => {
    const before = fiber.alternate;
    if (isRow(fiber) && (before === null || before.memoizedProps !== fiber.memoizedProps)) {
      globalThis.__rows += 1;
    }
    if (before !== null && before.child === fiber.child) {
      return;
    }
    for (let child = fiber.child; child !== null; child = child.sibling) {
      visit(child);
    }
  };
  globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    checkDCE: () => {},
    inject: () => 1,
    isDisabled: false,
    onCommitFiberRoot: (_id, root) => {
      visit(root.current);
    },
    onCommitFiberUnmount: () => {},
    onPostCommitFiberRoot: () => {},
    renderers: new Map(),
    supportsFiber: true,
  };
})();`;

const TYPES = new Map([
  [".css", "text/css"],
  [".html", "text/html"],
  [".js", "text/javascript"],
]);

const serve = async () => {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");

    void (async () => {
      try {
        const body = await readFile(path.join(RENDERER, url.pathname));

        const type =
          TYPES.get(path.extname(url.pathname)) ?? "application/octet-stream";

        response.writeHead(200, { "content-type": type });
        response.end(body);
      } catch {
        response.writeHead(404);
        response.end();
      }
    })();
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const { port } = z.object({ port: z.number() }).parse(server.address());

  return { origin: `http://127.0.0.1:${port}`, server };
};

const RunSchema = z.object({
  measures: z.number(),
  ms: z.number(),
  rows: z.number(),
});

type Run = z.infer<typeof RunSchema>;

type Action = "compose" | "search" | "move";

const KEYS: Readonly<Record<Action, number>> = {
  compose: TYPED.length,
  move: MOVES,
  search: SEARCHED.length,
};

const measure = async (
  browser: Browser,
  origin: string,
  count: number,
  action: Action
): Promise<Run> => {
  const context = await browser.newContext({
    deviceScaleFactor: 2,
    viewport: { height: 620, width: 360 },
  });

  const page = await context.newPage();

  await page.addInitScript(
    `globalThis.__screens = ${JSON.stringify({ data: { view: view(count) }, page: "shelf" })};`
  );
  await page.addInitScript(COUNT_ROWS);
  await page.addInitScript({ path: BRIDGE });
  await page.addInitScript(COUNT_MEASURES);
  await page.goto(`${origin}/shelf.html`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);

  if (action === "compose") {
    await page.getByRole("textbox", { name: /^New note in/u }).click();
  } else if (action === "search") {
    await page.getByRole("textbox", { name: "Search the shelf" }).click();
  } else if (count > 0) {
    // A click on the first row selects it and leaves the keys to the list.
    await page.locator("li[data-item-id]").first().click();
  }

  await page.waitForTimeout(300);
  await page.evaluate("globalThis.__measures = 0; globalThis.__rows = 0");

  const started = await page.evaluate("performance.now()");

  // One key at a time, each waiting for the page to take it, as a person types.
  if (action === "move") {
    for (let key = 0; key < MOVES; key += 1) {
      // oxlint-disable-next-line no-await-in-loop -- one key at a time, as a person presses them.
      await page.keyboard.press("ArrowDown");
    }
  } else {
    await page.keyboard.type(action === "compose" ? TYPED : SEARCHED);
  }

  // Whatever React still has to do for the last key.
  await page.evaluate(
    "new Promise((done) => requestAnimationFrame(() => setTimeout(done)))"
  );

  const run = RunSchema.parse(
    await page.evaluate(
      `({ measures: globalThis.__measures, ms: performance.now() - ${String(started)}, rows: globalThis.__rows })`
    )
  );

  await context.close();

  return run;
};

/** The value with as many runs below it as above it (the lower one of an even count). */
const median = (values: readonly number[]): number => {
  const middle = Math.floor((values.length - 1) / 2);

  return (
    values.find((value) => {
      const below = values.filter((each) => each < value).length;
      const upTo = values.filter((each) => each <= value).length;

      return below <= middle && middle < upTo;
    }) ?? 0
  );
};

const LABEL: Readonly<Record<Action, string>> = {
  compose: `${TYPED.length} characters typed in the composer`,
  move: `${MOVES} presses of ↓`,
  search: `${SEARCHED.length} characters typed in search`,
};

const main = async (): Promise<void> => {
  const browser = await chromium.launch();
  const { origin, server } = await serve();

  for (const action of ["compose", "search", "move"] as const) {
    for (const count of [200, 0]) {
      const runs: Run[] = [];

      for (let run = 0; run < RUNS; run += 1) {
        // oxlint-disable-next-line no-await-in-loop -- one run at a time, so they don't share the machine.
        runs.push(await measure(browser, origin, count, action));
      }

      const rows = runs.map((each) => each.rows / KEYS[action]);

      console.log(
        `${count} items, ${RUNS} runs, ${LABEL[action]}: ${median(runs.map((each) => each.ms)).toFixed(0)} ms (median; ${runs.map((each) => each.ms.toFixed(0)).join(", ")}), ${median(rows).toFixed(1)} rows rendered per key (median; ${rows.map((each) => each.toFixed(1)).join(", ")}), hidesWords ${median(runs.map((each) => each.measures))} calls (median; ${runs.map((each) => each.measures).join(", ")})`
      );
    }
  }

  await browser.close();
  server.close();
};

await main();

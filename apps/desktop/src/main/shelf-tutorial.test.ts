import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { shelfMenu } from "@shared/menus";
import { ItemIdSchema } from "@shared/shelf";
import type { ItemId } from "@shared/shelf";
import { shortcutLabels } from "@shared/shortcut";
import { DRAWING_TOOL_KEYS, shortcutSheet } from "@shared/shortcuts";
import { describe, expect, it } from "vite-plus/test";

import { HELP_URL } from "./app-menu";
import {
  removeShelfExamples,
  SHELF_TASK_IDS,
  shelfExamples,
  shelfHints,
  shelfSpotlight,
  shelfTasks,
} from "./shelf-tutorial";

/** Every key the app answers, as its Keyboard Shortcuts sheet and labels write them for the system. */
const realKeys = (mac: boolean): ReadonlySet<string> => {
  const labels = shortcutLabels(mac);

  return new Set<string>([
    ...shortcutSheet(mac).flatMap((group) =>
      group.rows.flatMap((row) => row.keys)
    ),
    labels.copy,
    labels.doubleShift,
    labels.screenshot,
    labels.toggle,
    ...Object.values(DRAWING_TOOL_KEYS),
  ]);
};

const RENDERER = path.resolve(import.meta.dirname, "../renderer");

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      return sources(full);
    }

    return entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx")
      ? [readFileSync(full, "utf-8")]
      : [];
  });

/** The anchors the renderer marks: coach("id"), and the checklist's own task rows. */
const markedAnchors = (): ReadonlySet<string> =>
  new Set([
    ...sources(RENDERER).flatMap((text) =>
      [...text.matchAll(/coach\(\s*"(?<id>[a-z][a-z0-9-]*)"\s*\)/gu)].flatMap(
        (match) => (match.groups?.id === undefined ? [] : [match.groups.id])
      )
    ),
    ...shelfTasks(true).map((task) => `task-${task.id}`),
  ]);

describe("Inset Shelf's tutorial", () => {
  it("shows only keys the app really answers to, on macOS and Windows", () => {
    for (const mac of [true, false]) {
      const keys = realKeys(mac);

      expect(
        shelfTasks(mac)
          .flatMap((task) => (task.keys === null ? [] : [task.keys]))
          .filter((shown) => !keys.has(shown))
      ).toStrictEqual([]);
    }
  });

  it("points only at controls the pages mark", () => {
    const anchors = markedAnchors();

    const pointedAt = [
      ...shelfTasks(true).flatMap((task) =>
        task.anchor === null ? [] : [task.anchor]
      ),
      ...shelfHints(true).map((hint) => hint.anchor),
      ...shelfSpotlight(true).map((step) => step.anchor),
    ];

    expect(pointedAt.filter((anchor) => !anchors.has(anchor))).toStrictEqual(
      []
    );
  });

  it("ties hints to tasks it has, and has between four and six walkthrough stops", () => {
    const tasks = new Set(shelfTasks(true).map((task) => task.id));

    expect({
      hints: shelfHints(true).flatMap((hint) =>
        hint.task === null || tasks.has(hint.task) ? [] : [hint.task]
      ),
      steps: shelfSpotlight(true).length,
      tasks: [...tasks].toSorted(),
    }).toStrictEqual({
      hints: [],
      steps: 6,
      tasks: Object.values(SHELF_TASK_IDS).toSorted(),
    });
  });

  it("names at the ⋯ stop only what that menu holds, Help among them", () => {
    const words = [
      "Float on Top",
      "Help",
      "Keyboard Shortcuts",
      "New Window Link",
      "Settings",
    ];

    const named = (mac: boolean) => {
      const stop = shelfSpotlight(mac).find((step) => step.id === "menu");

      const labels = new Set(
        shelfMenu(mac ? null : { floatOnTop: false }).flatMap((entry) =>
          entry.kind === "choice" ? [entry.label.replace("…", "")] : []
        )
      );

      const said = words.filter((word) => stop?.text.includes(word) === true);

      return {
        missing: said.filter((word) => !labels.has(word)),
        namesHelp: said.includes("Help"),
      };
    };

    for (const mac of [true, false]) {
      expect(named(mac)).toStrictEqual({ missing: [], namesHelp: true });
    }
  });

  it("writes the examples' keys for the system, and gives one a source line", () => {
    const mac = shelfExamples(true).map((example) => example.text);
    const windows = shelfExamples(false).map((example) => example.text);

    expect({
      mac: mac.filter((text) => text.includes("⇧ ⇧") || text.includes("⌘C")),
      source: shelfExamples(true).filter((example) => example.context !== null)
        .length,
      windows: windows.filter(
        (text) => text.includes("Shift Shift") || text.includes("Ctrl+C")
      ),
    }).toMatchObject({ mac: { length: 2 }, source: 1, windows: { length: 2 } });
  });

  it("names the docs on the source line that opens them", () => {
    expect(
      shelfExamples(true).find((example) => example.context !== null)?.context
    ).toMatchObject({ title: "Inset Shelf docs", url: HELP_URL });
  });
});

describe(removeShelfExamples, () => {
  const ids = [
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000002",
  ].map((id) => ItemIdSchema.parse(id));

  const shelf = (saves: boolean, stuck: ReadonlySet<string> = new Set()) => {
    const items = new Set<ItemId>(ids);

    return {
      has: (id: ItemId) => items.has(id),
      items,
      remove: (id: ItemId) => {
        if (!stuck.has(id)) {
          items.delete(id);
        }
      },
      saved: async () => await Promise.resolve(saves),
    };
  };

  it("reports the examples removed once the shelf on disk no longer holds them", async () => {
    const saving = shelf(true, new Set([ids[1] ?? ""]));

    await expect(removeShelfExamples(ids, saving)).resolves.toStrictEqual([
      ids[0],
    ]);
  });

  it("reports none removed when the save fails, so they stay examples to remove again", async () => {
    // As on Windows with a read-only shelf.json: gone from the shelf in memory, still on disk.
    const failing = shelf(false);

    await expect(removeShelfExamples(ids, failing)).resolves.toStrictEqual([]);
    expect(failing.items.size).toBe(0);
  });
});

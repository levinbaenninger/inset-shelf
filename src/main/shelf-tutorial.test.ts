import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { shortcutLabels } from "@shared/shortcut";
import { DRAWING_TOOL_KEYS, shortcutSheet } from "@shared/shortcuts";
import { describe, expect, it } from "vitest";

import {
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
});

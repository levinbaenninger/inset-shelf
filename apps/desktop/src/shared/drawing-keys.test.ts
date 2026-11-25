import { describe, expect, it } from "vitest";

import { DRAWING_TOOL_KEYS, shortcutSheet } from "./shortcuts";

const toolKeys = Object.values(DRAWING_TOOL_KEYS);

describe("drawing tool keys", () => {
  it("gives every tool its own letter and leaves the digits to the pins", () => {
    expect([
      new Set(toolKeys).size === toolKeys.length,
      toolKeys.filter((key) => /^[0-9]$/u.test(key)),
    ]).toStrictEqual([true, []]);
  });

  it("lists every tool's letter on the Keyboard Shortcuts sheet", () => {
    const listed = new Set(
      shortcutSheet(true)
        .flatMap((group) => group.rows)
        .flatMap((row) => row.keys)
    );

    expect(toolKeys.filter((key) => !listed.has(key))).toStrictEqual([]);
  });
});

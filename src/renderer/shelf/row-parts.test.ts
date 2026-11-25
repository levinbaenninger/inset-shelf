import { FileItemSchema, ImageItemSchema, TextItemSchema } from "@shared/shelf";
import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { rowParts } from "./row-parts";

const uuid = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const BASE = {
  color: null,
  context: null,
  createdAt: "2026-11-05T10:00:00.000Z",
  description: "",
  done: false,
  due: null,
  id: uuid(1),
  sectionId: uuid(2),
  steps: [],
  windows: [],
};

const windowRef = (n: number) => ({
  app: "Safari",
  appPath: null,
  capturedAt: "2026-11-05T10:00:00.000Z",
  description: "",
  document: null,
  id: uuid(100 + n),
  thumb: null,
  title: `Window ${n}`,
  url: null,
});

const step = (n: number, text: string, done = false) => ({
  done,
  id: uuid(200 + n),
  text,
});

const text = (fields: Partial<z.input<typeof TextItemSchema>> = {}) =>
  TextItemSchema.parse({
    ...BASE,
    kind: "text",
    text: "Call Marco",
    via: "typed",
    ...fields,
  });

const image = (fields: Partial<z.input<typeof ImageItemSchema>> = {}) =>
  ImageItemSchema.parse({
    ...BASE,
    image: {
      file: `${uuid(50)}.png`,
      heightPx: 600,
      pixelsPerDip: 2,
      widthPx: 960,
    },
    kind: "image",
    note: "",
    pins: [],
    source: null,
    title: null,
    via: "screenshot",
    ...fields,
  });

const file = (fields: Partial<z.input<typeof FileItemSchema>> = {}) =>
  FileItemSchema.parse({
    ...BASE,
    file: { bytes: 10, name: "plan.pdf", stored: `${uuid(60)}.pdf` },
    kind: "file",
    note: "",
    title: null,
    ...fields,
  });

const FULL = {
  description: "Why it matters",
  due: "2026-11-01",
  steps: [step(1, "Ask", true), step(2, "Book"), step(3, "  ")],
  windows: [windowRef(1), windowRef(2)],
};

describe(rowParts, () => {
  it("shows a plain note's words alone: no badges, nothing to open", () => {
    expect(rowParts(text(), false)).toStrictEqual({
      badges: [],
      badgesOn: "source",
      extras: null,
    });
  });

  it("puts what is set on the quiet line, most telling first, three at most", () => {
    const pinned = image({
      ...FULL,
      pins: [{ x: 1, y: 1 }],
    });

    expect(rowParts(pinned, false).badges).toStrictEqual([
      { due: "2026-11-01", kind: "due" },
      { done: 1, kind: "steps", total: 2 },
      { count: 2, kind: "windows" },
    ]);
  });

  it("drops the step and window counts once the row is open, as it lists them", () => {
    const parts = rowParts(text(FULL), true);

    expect(parts.badges).toStrictEqual([{ due: "2026-11-01", kind: "due" }]);
    expect(parts.extras).toStrictEqual({
      description: true,
      links: false,
      pinLegend: false,
      steps: true,
      windows: true,
    });
  });

  it("lists only what is set: blank steps and unlabelled pins count for nothing", () => {
    const parts = rowParts(
      image({ pins: [{ x: 1, y: 1 }], steps: [step(4, " ")] }),
      true
    );

    expect(parts.extras).toStrictEqual({
      description: false,
      links: false,
      pinLegend: false,
      steps: false,
      windows: false,
    });
    expect(parts.badges).toStrictEqual([{ count: 1, kind: "pins" }]);
  });

  it("carries a file's badges on its name's line when it has no source", () => {
    expect(rowParts(file({ due: "2026-11-01" }), false).badgesOn).toBe("file");
    expect(
      rowParts(
        file({
          context: { app: "Preview", appLink: null, title: "plan", url: null },
        }),
        false
      ).badgesOn
    ).toBe("source");
  });
});

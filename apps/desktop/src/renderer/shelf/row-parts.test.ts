import { FileItemSchema, ImageItemSchema, TextItemSchema } from "@shared/shelf";
import { describe, expect, it } from "vite-plus/test";
import type { z } from "zod";

import {
  checkedSteps,
  linksOf,
  ROW_CAPS,
  rowParts,
  rowSteps,
  windowsThatFit,
} from "./row-parts";

const uuid = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const BASE = {
  attachments: [],
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

/** A note with this many attached files. */
const attached = (count: number) =>
  text({
    attachments: Array.from({ length: count }, (_, n) => ({
      addedAt: "2026-11-20T10:00:00.000Z",
      file: {
        bytes: 3,
        name: `File ${n}.pdf`,
        stored: `${uuid(300 + n)}.pdf`,
      },
      id: uuid(400 + n),
      kind: "file",
    })),
  });

describe(rowParts, () => {
  it("shows a plain note's words alone: no badges, nothing to open", () => {
    expect(rowParts(text(), false)).toStrictEqual({
      badges: [],
      badgesOn: "source",
      open: null,
      strip: null,
    });
  });

  it("shows the first three attachments as tiles, open or closed, and counts the rest for details", () => {
    expect(
      [attached(0), attached(2), attached(12)].flatMap((item) => [
        rowParts(item, false).strip,
        rowParts(item, true).strip,
      ])
    ).toStrictEqual([
      null,
      null,
      { more: 0, shown: 2 },
      { more: 0, shown: 2 },
      { more: 9, shown: 3 },
      { more: 9, shown: 3 },
    ]);
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
    expect(parts.open).toMatchObject({
      description: true,
      links: false,
      pins: null,
      steps: { more: 0, moreDone: 0 },
      windows: 2,
    });
  });

  it("lists only what is set: blank steps and unlabelled pins count for nothing", () => {
    const parts = rowParts(
      image({ pins: [{ x: 1, y: 1 }], steps: [step(4, " ")] }),
      true
    );

    expect(parts.open).toStrictEqual({
      description: false,
      links: false,
      pins: null,
      steps: null,
      windows: 0,
    });
    expect(parts.badges).toStrictEqual([{ count: 1, kind: "pins" }]);
  });

  it("drops the pin count once the open row lists the pins' labels", () => {
    const labelled = image({ pins: [{ label: "Button", x: 1, y: 1 }] });

    expect(rowParts(labelled, false).badges).toStrictEqual([
      { count: 1, kind: "pins" },
    ]);
    expect(rowParts(labelled, true).badges).toStrictEqual([]);
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

/** An image with this many labelled pins. */
const labelled = (count: number) =>
  image({
    pins: Array.from({ length: count }, (_, n) => ({
      label: `Pin ${n}`,
      x: n,
      y: n,
    })),
  });

describe("an open row's caps", () => {
  it("lists every labelled pin up to three, then counts the rest", () => {
    expect(rowParts(labelled(3), true).open?.pins).toStrictEqual({
      more: 0,
      shown: 3,
    });
    expect(rowParts(labelled(30), true).open?.pins).toStrictEqual({
      more: 27,
      shown: ROW_CAPS.pins,
    });
  });

  it("lists up to five steps, then counts the rest and how many of them are done", () => {
    const steps = Array.from({ length: 20 }, (_, n) =>
      step(10 + n, `Step ${n}`, n < 3)
    );

    const listed = rowParts(text({ steps }), true).open?.steps;

    expect(listed?.shown.map((each) => each.text)).toStrictEqual([
      "Step 3",
      "Step 4",
      "Step 5",
      "Step 6",
      "Step 7",
    ]);
    expect([listed?.more, listed?.moreDone]).toStrictEqual([15, 3]);
  });

  it("shows every part it has whatever the others hold", () => {
    const crowded = image({
      description: "Why it matters",
      pins: labelled(30).pins,
      steps: Array.from({ length: 20 }, (_, n) => step(10 + n, `Step ${n}`)),
      windows: Array.from({ length: 10 }, (_, n) => windowRef(n)),
    });

    expect(rowParts(crowded, true).open).toMatchObject({
      description: true,
      pins: { more: 27, shown: 3 },
      steps: { more: 15, moreDone: 0 },
      windows: 10,
    });
  });

  it("folds an open text row's links to one line each once its description passes three lines", () => {
    const { open } = rowParts(
      text({
        description: "Why",
        links: [{ text: "Quote", url: "https://example.com/quote" }],
      }),
      true
    );

    expect([linksOf(open, 3), linksOf(open, 4)]).toStrictEqual([
      "listed",
      "folded",
    ]);
    expect(linksOf(rowParts(text(), true).open, 9)).toBe("none");
  });

  it("puts as many windows on one line as fit, with room for +N when some don't", () => {
    // Four thumbnails are 48 px each with 6 px between: 210 px.
    expect(windowsThatFit(210, 4)).toBe(4);
    expect(windowsThatFit(210, 10)).toBe(3);
    expect(windowsThatFit(500, 10)).toBe(8);
    expect(windowsThatFit(560, 2)).toBe(2);
  });
});

describe("the steps an open row lists", () => {
  const STEPS = [
    step(1, "Ask Marco", true),
    step(2, "Read the draft", true),
    step(3, "Book the room"),
    step(4, "   "),
    step(5, "Send the invite"),
    step(6, "Print the agenda"),
  ];

  /** The words of the first `shown` steps a row lists that opened with `atOpen` and now holds `now`. */
  const listed = (
    shown: number,
    atOpen: readonly ReturnType<typeof step>[] = STEPS,
    now: readonly ReturnType<typeof step>[] = atOpen
  ): readonly string[] =>
    rowSteps(text({ steps: [...now] }).steps, checkedSteps(atOpen))
      .slice(0, shown)
      .map((each) => each.text);

  it("shows the steps still to do before checked ones, however few fit", () => {
    expect(listed(2)).toStrictEqual(["Book the room", "Send the invite"]);
  });

  it("keeps the stored order among open steps and among checked ones, and leaves out a step without words", () => {
    expect(listed(9)).toStrictEqual([
      "Book the room",
      "Send the invite",
      "Print the agenda",
      "Ask Marco",
      "Read the draft",
    ]);
  });

  it("leaves a step ticked in the open row where it is, and puts it after the open ones the next time the row opens", () => {
    const ticked = STEPS.map((each) =>
      each.text === "Book the room" ? { ...each, done: true } : each
    );

    expect(listed(2, STEPS, ticked)).toStrictEqual([
      "Book the room",
      "Send the invite",
    ]);
    expect(listed(2, ticked)).toStrictEqual([
      "Send the invite",
      "Print the agenda",
    ]);
  });

  it("cuts the list in the order it opened with, so a step ticked there doesn't move or leave it", () => {
    const many = [...STEPS, step(7, "Order lunch"), step(8, "Thank everyone")];

    const ticked = many.map((each) =>
      each.text === "Book the room" ? { ...each, done: true } : each
    );

    const cut = rowParts(text({ steps: ticked }), true, checkedSteps(many)).open
      ?.steps;

    expect(cut?.shown.map((each) => each.text)).toStrictEqual([
      "Book the room",
      "Send the invite",
      "Print the agenda",
      "Order lunch",
      "Thank everyone",
    ]);
    expect([cut?.more, cut?.moreDone]).toStrictEqual([2, 2]);
  });
});

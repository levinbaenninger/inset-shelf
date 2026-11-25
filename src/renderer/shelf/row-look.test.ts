import { describe, expect, it } from "vitest";

import { fitOpenRow, ROW_CAPS } from "./row-look";

const LINE = 20;
const BUTTON = 22;

describe(fitOpenRow, () => {
  it("keeps every cap when the row fits", () => {
    expect(
      fitOpenRow([{ line: LINE, lines: 9, part: "words" }], 100, 400, BUTTON)
    ).toStrictEqual(ROW_CAPS);
  });

  it("shortens the words first, never under three lines", () => {
    const fitted = fitOpenRow(
      [
        { line: LINE, lines: 12, part: "words" },
        { line: LINE, lines: 5, part: "description" },
      ],
      100,
      300,
      BUTTON
    );

    expect(fitted.words).toBe(4);
    expect(fitted.description).toBe(3);
  });

  it("then the description and the title, to one line each", () => {
    expect(
      fitOpenRow(
        [
          { line: LINE, lines: 12, part: "words" },
          { line: LINE, lines: 5, part: "description" },
          { line: LINE, lines: 4, part: "title" },
        ],
        250,
        300,
        BUTTON
      )
    ).toStrictEqual({ description: 1, title: 1, words: 3 });
  });

  it("leaves short parts whole", () => {
    expect(
      fitOpenRow([{ line: LINE, lines: 2, part: "title" }], 500, 300, BUTTON)
        .title
    ).toBe(3);
  });
});

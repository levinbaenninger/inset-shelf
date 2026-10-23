import { describe, expect, it } from "vitest";

import {
  addMark,
  arrowhead,
  canRedo,
  canUndo,
  clearMarks,
  emptyHistory,
  EXPORT_PADDING,
  EXPORT_SCALE,
  exportFrame,
  isVisible,
  PLAIN_VIEW,
  redo,
  markBounds,
  sketchBounds,
  TEXT_LEADING,
  toDrawing,
  toPage,
  undo,
} from "./sketch";
import type { Mark, Point, SegmentMark } from "./sketch";

const line = (x: number): SegmentMark => ({
  color: "ink",
  from: { x, y: 0 },
  kind: "line",
  to: { x: x + 10, y: 0 },
  width: 2,
});

const tenths = (point: Point | undefined): Point | undefined =>
  point && {
    x: Math.round(point.x * 10) / 10,
    y: Math.round(point.y * 10) / 10,
  };

/** Every character is half the font size wide. */
const measure = (text: string, size: number): number =>
  (text.length * size) / 2;

describe("history", () => {
  it("adds marks and undoes them in order", () => {
    const one = addMark(emptyHistory, line(0));
    const two = addMark(one, line(20));

    expect(two.present).toStrictEqual([line(0), line(20)]);
    expect(canUndo(two)).toBeTruthy();
    expect(canRedo(two)).toBeFalsy();
    expect(undo(two).present).toStrictEqual([line(0)]);
    expect(undo(undo(two)).present).toStrictEqual([]);
  });

  it("redoes what was undone, and a new mark drops the redo", () => {
    const two = addMark(addMark(emptyHistory, line(0)), line(20));
    const back = undo(two);

    expect(canRedo(back)).toBeTruthy();
    expect(redo(back)).toStrictEqual(two);
    expect(canRedo(addMark(back, line(40)))).toBeFalsy();
  });

  it("leaves the history alone when there is nothing to undo or redo", () => {
    expect(undo(emptyHistory)).toBe(emptyHistory);
    expect(redo(emptyHistory)).toBe(emptyHistory);
  });

  it("makes clearing undoable, and skips clearing an empty page", () => {
    const drawn = addMark(addMark(emptyHistory, line(0)), line(20));
    const cleared = clearMarks(drawn);

    expect(cleared.present).toStrictEqual([]);
    expect(undo(cleared).present).toStrictEqual(drawn.present);
    expect(clearMarks(emptyHistory)).toBe(emptyHistory);
  });

  it("does not change the history it was given", () => {
    const one = addMark(emptyHistory, line(0));

    addMark(one, line(20));
    undo(one);

    expect(one.present).toStrictEqual([line(0)]);
    expect(emptyHistory.present).toStrictEqual([]);
  });
});

describe(arrowhead, () => {
  it("puts the tip on the end and spreads the barbs evenly", () => {
    const head = arrowhead({ x: 0, y: 0 }, { x: 100, y: 0 }, 3);

    expect(head?.tip).toStrictEqual({ x: 100, y: 0 });
    expect(head?.base).toStrictEqual({ x: 88, y: 0 });
    expect([head?.left, head?.right].map(tenths)).toStrictEqual([
      { x: 88, y: 7.2 },
      { x: 88, y: -7.2 },
    ]);
  });

  it("grows with the line width", () => {
    const head = arrowhead({ x: 0, y: 0 }, { x: 0, y: 100 }, 7);

    expect(head?.base.y).toBeCloseTo(72);
    expect(head?.base.x).toBeCloseTo(0);
  });

  it("is never longer than a short arrow", () => {
    const head = arrowhead({ x: 0, y: 0 }, { x: 5, y: 0 }, 7);

    expect(head?.base.x).toBeCloseTo(0);
  });

  it("is null for a zero-length arrow", () => {
    expect(arrowhead({ x: 4, y: 4 }, { x: 4, y: 4 }, 3)).toBeNull();
  });
});

describe(isVisible, () => {
  it("drops clicks with the mark tools and blank text, but keeps a pen dot", () => {
    expect(isVisible({ ...line(0), to: { x: 1, y: 1 } })).toBeFalsy();
    expect(isVisible(line(0))).toBeTruthy();
    expect(
      isVisible({
        at: { x: 0, y: 0 },
        color: "ink",
        kind: "text",
        size: 20,
        text: "  ",
      })
    ).toBeFalsy();
    expect(
      isVisible({
        color: "ink",
        kind: "pen",
        points: [{ x: 3, y: 3 }],
        width: 3,
      })
    ).toBeTruthy();
  });
});

describe(markBounds, () => {
  it("includes half the stroke", () => {
    expect(
      markBounds(
        {
          color: "red",
          kind: "rect",
          from: { x: 50, y: 40 },
          to: { x: 10, y: 20 },
          width: 4,
        },
        measure
      )
    ).toStrictEqual({ height: 24, width: 44, x: 8, y: 18 });
  });

  it("includes an arrow's barbs", () => {
    const box = markBounds(
      {
        color: "ink",
        from: { x: 0, y: 0 },
        kind: "arrow",
        to: { x: 100, y: 0 },
        width: 2,
      },
      measure
    );

    expect(box?.y).toBeCloseTo(-7.2 - 1);
    expect(box?.height).toBeCloseTo(14.4 + 2);
  });

  it("measures text from its top-left corner", () => {
    expect(
      markBounds(
        {
          at: { x: 5, y: 6 },
          color: "ink",
          kind: "text",
          size: 20,
          text: "abcd",
        },
        measure
      )
    ).toStrictEqual({ height: 20 * TEXT_LEADING, width: 40, x: 5, y: 6 });
  });
});

describe(exportFrame, () => {
  it("is null for an empty page", () => {
    expect(exportFrame([], measure)).toBeNull();
    expect(sketchBounds([], measure)).toBeNull();
  });

  it("trims to every mark plus padding, at the export scale", () => {
    const marks: Mark[] = [
      {
        color: "ink",
        kind: "pen",
        points: [
          { x: 100, y: 100 },
          { x: 140, y: 120 },
        ],
        width: 4,
      },
      line(200),
    ];

    expect(sketchBounds(marks, measure)).toStrictEqual({
      height: 122 - -1,
      width: 211 - 98,
      x: 98,
      y: -1,
    });
    expect(exportFrame(marks, measure)).toStrictEqual({
      origin: { x: 98 - EXPORT_PADDING, y: -1 - EXPORT_PADDING },
      pixelHeight: (123 + 2 * EXPORT_PADDING) * EXPORT_SCALE,
      pixelWidth: (113 + 2 * EXPORT_PADDING) * EXPORT_SCALE,
    });
  });

  it("rounds outwards to whole page pixels", () => {
    const frame = exportFrame(
      [{ color: "ink", kind: "pen", points: [{ x: 10.3, y: 10.3 }], width: 3 }],
      measure
    );

    // The dot covers 8.8 to 11.8, so the frame spans 8 to 12 plus the padding.
    expect(frame).toStrictEqual({
      origin: { x: 8 - EXPORT_PADDING, y: 8 - EXPORT_PADDING },
      pixelHeight: (4 + 2 * EXPORT_PADDING) * EXPORT_SCALE,
      pixelWidth: (4 + 2 * EXPORT_PADDING) * EXPORT_SCALE,
    });
  });
});

describe(toDrawing, () => {
  const view = { origin: { x: 40, y: 24 }, scale: 0.5 };

  it("maps a page point onto an image shown at half size, and back", () => {
    expect(toDrawing(view, { x: 140, y: 74 })).toStrictEqual({
      x: 200,
      y: 100,
    });
    expect(toPage(view, { x: 200, y: 100 })).toStrictEqual({ x: 140, y: 74 });
  });

  it("leaves a blank page as it is", () => {
    expect(toDrawing(PLAIN_VIEW, { x: 3, y: 4 })).toStrictEqual({ x: 3, y: 4 });
  });
});

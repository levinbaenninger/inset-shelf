import { describe, expect, it } from "vitest";

import { pinsOf } from "./pins";
import {
  draftEdit,
  duplicateMarks,
  gestureMarks,
  gestureSelection,
  handleAt,
  handlesOf,
  insideSelection,
  markAt,
  marksWithin,
  moveMarks,
  NOTHING,
  releaseGesture,
  removeMarks,
  resize,
  restyle,
  shownStyle,
  withText,
} from "./selection";
import type { Reach } from "./selection";
import { commit, emptyHistory, redo, undo } from "./sketch";
import type { Mark, SegmentMark, TextMark } from "./sketch";

/** Every character is half the font size wide. */
const measure = (text: string, size: number): number =>
  (text.length * size) / 2;

const REACH: Reach = { pinHeadY: -13, pinRadius: 9, tolerance: 6 };

const box: SegmentMark = {
  color: "ink",
  from: { x: 100, y: 100 },
  kind: "rect",
  to: { x: 200, y: 160 },
  width: 3,
};

const line: SegmentMark = {
  color: "red",
  from: { x: 0, y: 300 },
  kind: "line",
  to: { x: 100, y: 300 },
  width: 3,
};

const arrow: SegmentMark = {
  color: "blue",
  from: { x: 300, y: 0 },
  kind: "arrow",
  to: { x: 300, y: 100 },
  width: 3,
};

const ring: SegmentMark = {
  color: "green",
  from: { x: 400, y: 400 },
  kind: "ellipse",
  to: { x: 500, y: 450 },
  width: 3,
};

const label: TextMark = {
  at: { x: 10, y: 10 },
  color: "ink",
  kind: "text",
  size: 20,
  text: "Hi there",
};

const pin = (x: number, y: number): Mark => ({ at: { x, y }, kind: "pin" });

const summary = (mark: Mark): string =>
  mark.kind === "text" ? mark.text : mark.kind;

describe(markAt, () => {
  it("picks a thin line within the tolerance past its edge, and not beyond", () => {
    const marks = [line];

    expect([
      markAt(marks, { x: 50, y: 300 }, REACH, measure),
      markAt(marks, { x: 50, y: 307 }, REACH, measure),
      markAt(marks, { x: 50, y: 308 }, REACH, measure),
    ]).toStrictEqual([0, 0, null]);
  });

  it("picks a box by its outline, leaving its inside to what is under it", () => {
    const marks = [box];

    expect([
      markAt(marks, { x: 150, y: 101 }, REACH, measure),
      markAt(marks, { x: 199, y: 130 }, REACH, measure),
      markAt(marks, { x: 150, y: 130 }, REACH, measure),
    ]).toStrictEqual([0, 0, null]);
  });

  it("picks an ellipse on its curve and an arrow by its head", () => {
    const marks = [ring, arrow];

    expect([
      markAt(marks, { x: 450, y: 401 }, REACH, measure),
      markAt(marks, { x: 450, y: 425 }, REACH, measure),
      markAt(marks, { x: 309, y: 88 }, REACH, measure),
    ]).toStrictEqual([0, null, 1]);
  });

  it("picks text anywhere in its box", () => {
    expect(markAt([label], { x: 60, y: 22 }, REACH, measure)).toBe(0);
    expect(markAt([label], { x: 120, y: 22 }, REACH, measure)).toBeNull();
  });

  it("prefers the last drawn mark, and a pin's head over any stroke", () => {
    const over = { ...line, color: "blue" as const };
    const marks = [line, over, pin(50, 313)];

    expect(markAt(marks, { x: 50, y: 300 }, REACH, measure)).toBe(2);
    expect(markAt(marks, { x: 20, y: 300 }, REACH, measure)).toBe(1);
  });
});

describe(marksWithin, () => {
  it("picks the marks a marquee holds whole, and pins by their tip", () => {
    const marks = [box, line, pin(150, 130), label];

    const picked = marksWithin(
      marks,
      { height: 100, width: 150, x: 90, y: 90 },
      measure
    );

    expect([...picked]).toStrictEqual([0, 2]);
  });
});

describe(insideSelection, () => {
  it("lets a drag inside a selected box move it, and not one beside it", () => {
    const selected = new Set([0]);

    expect(
      insideSelection([box], selected, { x: 150, y: 130 }, 4, measure)
    ).toBeTruthy();
    expect(
      insideSelection([box], selected, { x: 250, y: 130 }, 4, measure)
    ).toBeFalsy();
  });
});

describe(resize, () => {
  it("drags a box's corner and leaves the opposite corner in place", () => {
    const corner = handleAt(box, { x: 204, y: 164 }, 6, 4);

    expect(corner).toStrictEqual({ kind: "side", x: 1, y: 1 });
    expect(
      corner === null ? null : resize(box, corner, { x: 30, y: -20 })
    ).toStrictEqual({
      ...box,
      from: { x: 100, y: 100 },
      to: { x: 230, y: 140 },
    });
  });

  it("grabs a handle anywhere in the square its reach spans, corners included, and not past it", () => {
    expect([
      handleAt(box, { x: 214, y: 174 }, 12, 4),
      handleAt(box, { x: 217, y: 164 }, 12, 4),
    ]).toStrictEqual([{ kind: "side", x: 1, y: 1 }, null]);
  });

  it("drags a box's top side only up and down", () => {
    expect(
      resize(box, { kind: "side", x: 0, y: -1 }, { x: 40, y: -30 })
    ).toStrictEqual({
      ...box,
      from: { x: 100, y: 70 },
      to: { x: 200, y: 160 },
    });
  });

  it("moves one end of a line or arrow", () => {
    const end = handleAt(arrow, { x: 302, y: 98 }, 6, 4);

    expect(end).toStrictEqual({ end: "to", kind: "end" });
    expect(
      end === null ? null : resize(arrow, end, { x: 50, y: 0 })
    ).toStrictEqual({ ...arrow, to: { x: 350, y: 100 } });
  });

  it("gives boxes eight handles, lines two, and text and pens none", () => {
    expect(
      [box, ring, line, label].map((mark) => handlesOf(mark, 4).length)
    ).toStrictEqual([8, 8, 2, 0]);
  });
});

describe(moveMarks, () => {
  it("moves only the selected marks, every kind, and keeps pins on the image", () => {
    const pen: Mark = {
      color: "ink",
      kind: "pen",
      points: [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ],
      width: 3,
    };

    const moved = moveMarks(
      [box, pen, label, pin(195, 10), line],
      new Set([0, 1, 2, 3]),
      { x: 10, y: -20 },
      { height: 100, width: 200 }
    );

    expect(moved).toStrictEqual([
      { ...box, from: { x: 110, y: 80 }, to: { x: 210, y: 140 } },
      {
        ...pen,
        points: [
          { x: 11, y: -19 },
          { x: 12, y: -18 },
        ],
      },
      { ...label, at: { x: 20, y: -10 } },
      pin(200, 0),
      line,
    ]);
  });
});

describe("moveMarks against the edge", () => {
  it("gives back the same marks when the pins can't go further, so no step is made", () => {
    const marks = [pin(200, 0)];

    expect(
      moveMarks(
        marks,
        new Set([0]),
        { x: 5, y: -5 },
        { height: 100, width: 200 }
      )
    ).toBe(marks);
  });
});

describe(removeMarks, () => {
  it("deletes the selection, and the pins after a removed pin take its number", () => {
    const left = removeMarks(
      [pin(10, 10), box, pin(20, 20), pin(30, 30)],
      new Set([0, 1])
    );

    expect(pinsOf(left).map((each) => each.at.x)).toStrictEqual([20, 30]);
    expect(left).toHaveLength(2);
  });
});

describe(duplicateMarks, () => {
  it("adds offset copies last, selects them, and numbers copied pins next", () => {
    const marks = [box, pin(10, 10), line];
    const copied = duplicateMarks(marks, new Set([0, 1]));

    expect(copied.marks).toStrictEqual([
      box,
      pin(10, 10),
      line,
      { ...box, from: { x: 110, y: 110 }, to: { x: 210, y: 170 } },
      pin(20, 20),
    ]);
    expect([...copied.selection]).toStrictEqual([3, 4]);
  });
});

describe(restyle, () => {
  it("gives the selection the ink and the stroke a new mark would get at this scale", () => {
    const restyled = restyle(
      [box, label, pin(1, 1), line],
      new Set([0, 1, 2]),
      { color: "red", stroke: "thick" },
      2
    );

    expect(restyled).toStrictEqual([
      { ...box, color: "red", width: 3.5 },
      { ...label, color: "red", size: 15 },
      pin(1, 1),
      line,
    ]);
  });

  it("returns the same marks when nothing changes, so no step is made", () => {
    const marks = [line];

    expect(restyle(marks, new Set([0]), { color: "red" }, 1)).toBe(marks);
  });
});

describe(shownStyle, () => {
  const next = { color: "orange", stroke: "thin" } as const;

  it("shows what the selection shares, and nothing where it differs", () => {
    expect(
      shownStyle([box, line], new Set([0, 1]), null, 1, next)
    ).toStrictEqual({ color: null, stroke: "thin" });
  });

  it("shows the next mark's style when only pins or nothing is selected", () => {
    expect(shownStyle([pin(1, 1)], new Set([0]), null, 1, next)).toBe(next);
    expect(shownStyle([box], NOTHING, null, 1, next)).toBe(next);
  });
});

describe(withText, () => {
  it("adds new words, edits a text in place, and drops it when emptied", () => {
    const marks = [box, label];
    const edited = { ...label, text: "Hello" };

    expect(withText(marks, { index: null, mark: edited })).toStrictEqual([
      box,
      label,
      edited,
    ]);
    expect(withText(marks, { index: 1, mark: edited })).toStrictEqual([
      box,
      edited,
    ]);
    expect(withText(marks, { index: 1, mark: null })).toStrictEqual([box]);
  });

  it("changes nothing when the words are as they were", () => {
    const marks = [label];

    const same = draftEdit({
      at: label.at,
      color: label.color,
      index: 0,
      size: label.size,
      value: label.text,
    });

    expect(withText(marks, same)).toBe(marks);
  });
});

describe(releaseGesture, () => {
  it("selects a shape just drawn, but not a pen stroke", () => {
    const drawnBox = releaseGesture(
      [line],
      NOTHING,
      { kind: "draw", mark: box },
      measure
    );

    const stroke = releaseGesture(
      [line],
      NOTHING,
      {
        kind: "draw",
        mark: {
          color: "ink",
          kind: "pen",
          points: [{ x: 1, y: 1 }],
          width: 3,
        },
      },
      measure
    );

    expect([[...drawnBox.selection], drawnBox.marks]).toStrictEqual([
      [1],
      [line, box],
    ]);
    expect([...stroke.selection]).toStrictEqual([]);
  });

  it("narrows a group to the mark clicked when it was let go without moving", () => {
    const still = releaseGesture(
      [box, line],
      new Set([0, 1]),
      { from: { x: 0, y: 0 }, kind: "move", narrow: 1, to: { x: 0, y: 0 } },
      measure
    );

    expect([...still.selection]).toStrictEqual([1]);
  });

  it("moves the whole selection when it was dragged", () => {
    const moved = releaseGesture(
      [box, line],
      new Set([0, 1]),
      { from: { x: 0, y: 0 }, kind: "move", narrow: 1, to: { x: 5, y: 0 } },
      measure
    );

    expect([[...moved.selection], moved.marks]).toStrictEqual([
      [0, 1],
      [
        { ...box, from: { x: 105, y: 100 }, to: { x: 205, y: 160 } },
        { ...line, from: { x: 5, y: 300 }, to: { x: 105, y: 300 } },
      ],
    ]);
  });

  it("adds a Shift marquee's picks to what was selected", () => {
    const marquee = {
      base: new Set([1]),
      from: { x: 90, y: 90 },
      kind: "marquee",
      to: { x: 210, y: 170 },
    } as const;

    expect([
      ...gestureSelection([box, line], new Set([1]), marquee, measure),
    ]).toStrictEqual([1, 0]);
    expect(
      releaseGesture([box, line], new Set([1]), marquee, measure).marks
    ).toStrictEqual([box, line]);
  });
});

describe("history of edits", () => {
  it("takes back a text edit, a move, a resize, a duplicate and a delete one step each", () => {
    const start = commit(emptyHistory, [box, label]);

    const edited = commit(
      start,
      withText(start.present, { index: 1, mark: { ...label, text: "Edited" } })
    );

    const moved = commit(
      edited,
      moveMarks(edited.present, new Set([0, 1]), { x: 5, y: 5 })
    );

    const resized = commit(
      moved,
      gestureMarks(moved.present, new Set([0]), {
        from: { x: 0, y: 0 },
        handle: { kind: "side", x: 1, y: 0 },
        index: 0,
        kind: "resize",
        to: { x: 20, y: 0 },
      })
    );

    const duplicated = commit(
      resized,
      duplicateMarks(resized.present, new Set([0])).marks
    );

    const deleted = commit(
      duplicated,
      removeMarks(duplicated.present, new Set([1]))
    );

    const steps = [deleted];

    for (let step = 0; step < 5; step += 1) {
      steps.push(undo(steps.at(-1) ?? deleted));
    }

    expect(
      steps.map((history) =>
        history.present.map((mark) =>
          mark.kind === "rect" ? `rect ${mark.to.x}` : summary(mark)
        )
      )
    ).toStrictEqual([
      ["rect 225", "rect 235"],
      ["rect 225", "Edited", "rect 235"],
      ["rect 225", "Edited"],
      ["rect 205", "Edited"],
      ["rect 200", "Edited"],
      ["rect 200", "Hi there"],
    ]);
    expect(redo(steps.at(-1) ?? deleted).present).toStrictEqual([
      box,
      { ...label, text: "Edited" },
    ]);
  });
});

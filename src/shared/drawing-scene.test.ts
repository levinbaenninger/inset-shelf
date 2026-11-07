import { describe, expect, it } from "vitest";

import { openedMarks, parseSceneFile, sceneFileText } from "./drawing-scene";
import type { StrokeMark } from "./drawing-scene";

const MARKS: readonly StrokeMark[] = [
  {
    color: "red",
    from: { x: 10, y: 20 },
    kind: "rect",
    to: { x: 110, y: 80 },
    width: 1.5,
  },
  {
    color: "ink",
    kind: "pen",
    points: [
      { x: 1, y: 2 },
      { x: 3.25, y: 4.5 },
    ],
    width: 3,
  },
  {
    at: { x: 40, y: 90 },
    color: "blue",
    kind: "text",
    size: 10,
    text: "Fix this\nfirst",
  },
];

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe(parseSceneFile, () => {
  it("reads back the marks it wrote", () => {
    expect(parseSceneFile(bytes(sceneFileText(MARKS)))).toStrictEqual(MARKS);
  });

  it("reads nothing from a file that isn't a scene of this version", () => {
    expect([
      parseSceneFile(bytes("{ not json")),
      parseSceneFile(bytes(JSON.stringify({ marks: MARKS, version: 2 }))),
      parseSceneFile(
        bytes(
          JSON.stringify({
            marks: [{ at: { x: 1, y: 2 }, kind: "pin" }],
            version: 1,
          })
        )
      ),
      parseSceneFile(
        bytes(
          JSON.stringify({
            marks: [{ ...MARKS[0], color: "purple" }],
            version: 1,
          })
        )
      ),
    ]).toStrictEqual([null, null, null, null]);
  });
});

describe(openedMarks, () => {
  it("opens the kept marks with the item's pins after them, moved from its pixels into DIP, labels kept", () => {
    expect(
      openedMarks(
        MARKS.slice(0, 1),
        [
          { label: "Too close", x: 200, y: 50 },
          { x: 7, y: 9 },
        ],
        2
      )
    ).toStrictEqual([
      MARKS[0],
      { at: { x: 100, y: 25 }, kind: "pin", label: "Too close" },
      { at: { x: 3.5, y: 4.5 }, kind: "pin" },
    ]);
  });
});

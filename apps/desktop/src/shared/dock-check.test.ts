import { describe, expect, it } from "vite-plus/test";

import { dockedBeside } from "./dock-check";
import { rect } from "./geometry";

describe(dockedBeside, () => {
  const work = rect<"screen">(0, 25, 1440, 850);
  const target = rect<"screen">(100, 100, 800, 600);

  it("accepts the shelf centred on the window, 620 tall", () => {
    expect(dockedBeside(rect(908, 90, 340, 620), target, work)).toBeTruthy();
  });

  it("rejects a shelf lower than the centre when the centre fits the screen", () => {
    expect(dockedBeside(rect(908, 500, 340, 620), target, work)).toBeFalsy();
  });

  it("rejects a shelf higher than the centre", () => {
    expect(dockedBeside(rect(908, 30, 340, 620), target, work)).toBeFalsy();
  });

  it("accepts the shelf held at the top edge of the work area when the centre would leave it", () => {
    expect(
      dockedBeside(
        rect(908, 25, 340, 620),
        rect<"screen">(100, 25, 800, 300),
        work
      )
    ).toBeTruthy();
  });

  it("accepts the shelf held at the bottom edge of the work area", () => {
    expect(
      dockedBeside(
        rect(908, 255, 340, 620),
        rect<"screen">(100, 700, 800, 175),
        work
      )
    ).toBeTruthy();
  });

  it("takes the shelf's height from the work area on a screen too short for 620", () => {
    const short = rect<"screen">(0, 25, 1280, 575);

    expect(
      dockedBeside(
        rect(908, 25, 340, 559),
        rect<"screen">(100, 100, 800, 400),
        short
      )
    ).toBeTruthy();
    expect(
      dockedBeside(
        rect(908, 25, 340, 620),
        rect<"screen">(100, 100, 800, 400),
        short
      )
    ).toBeFalsy();
  });

  it("rejects a shelf that isn't beside the window", () => {
    expect(dockedBeside(rect(950, 90, 340, 620), target, work)).toBeFalsy();
  });
});

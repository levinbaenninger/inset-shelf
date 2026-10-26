import { describe, expect, it } from "vitest";

import {
  dockShelf,
  rect,
  size,
  viewerImageRect,
  viewerWindowSize,
  WINDOWS_FRAME_INSET_DIP,
} from "./geometry";

describe(dockShelf, () => {
  const work = rect<"screen">(0, 25, 1440, 850);

  it("docks beside the right edge of the window, at its top and height", () => {
    expect(dockShelf(rect<"screen">(100, 100, 800, 600), work)).toStrictEqual(
      rect(908, 100, 340, 600)
    );
  });

  it("centres a shelf at most 620 tall on a taller window", () => {
    expect(dockShelf(rect<"screen">(100, 25, 800, 850), work)).toStrictEqual(
      rect(908, 140, 340, 620)
    );
  });

  it("docks to the left when there is no room on the right", () => {
    expect(dockShelf(rect<"screen">(500, 100, 900, 600), work)).toStrictEqual(
      rect(152, 100, 340, 600)
    );
  });

  it("sits inside the right edge of a window that fills the screen, centred, at most 620 tall", () => {
    expect(dockShelf(rect<"screen">(0, 25, 1440, 850), work)).toStrictEqual(
      rect(1092, 140, 340, 620)
    );
  });

  it("keeps a gap at the top and bottom inside a short full-screen window", () => {
    expect(
      dockShelf(
        rect<"screen">(0, 25, 1440, 500),
        rect<"screen">(0, 25, 1440, 500)
      )
    ).toStrictEqual(rect(1092, 33, 340, 484));
  });

  describe("with the invisible frame of a Windows window", () => {
    const desktop = rect<"screen">(0, 0, 1920, 1032);

    it("leaves the gap beside the visible edge", () => {
      expect(
        dockShelf(
          rect<"screen">(200, 120, 900, 640),
          desktop,
          WINDOWS_FRAME_INSET_DIP
        )
      ).toStrictEqual(rect(1101, 127, 340, 620));
    });

    it("leaves the gap before the visible edge", () => {
      expect(
        dockShelf(
          rect<"screen">(1000, 100, 800, 600),
          desktop,
          WINDOWS_FRAME_INSET_DIP
        )
      ).toStrictEqual(rect(659, 100, 340, 593));
    });

    it("sits inside a maximized window, whose bounds overhang the screen", () => {
      expect(
        dockShelf(
          rect<"screen">(-8, -8, 1936, 1048),
          desktop,
          WINDOWS_FRAME_INSET_DIP
        )
      ).toStrictEqual(rect(1572, 206, 340, 620));
    });
  });

  it("keeps a short window's shelf tall enough and on screen", () => {
    expect(dockShelf(rect<"screen">(100, 700, 400, 120), work)).toStrictEqual(
      rect(508, 515, 340, 360)
    );
  });

  it("opens at the right without a window, centred on the screen's height", () => {
    expect(dockShelf(null, work)).toStrictEqual(rect(1092, 170, 340, 560));
  });
});

describe(viewerImageRect, () => {
  it("shows a small image at its own size, centred above the toolbar", () => {
    expect(viewerImageRect(size(800, 600), size(400, 200))).toStrictEqual({
      height: 200,
      scale: 1,
      width: 400,
      x: 200,
      y: 24 + (600 - 24 - 76 - 200) / 2,
    });
  });

  it("scales a large image down to the room it has", () => {
    const placed = viewerImageRect(size(548, 600), size(1000, 500));

    expect(placed.scale).toBeCloseTo(0.5);
    expect(placed.width).toBeCloseTo(500);
    expect(placed.x).toBeCloseTo(24);
  });
});

describe(viewerWindowSize, () => {
  const work = rect<"screen">(0, 0, 1920, 1032);

  it("fits the image at its own size with the header and margins", () => {
    expect(viewerWindowSize(size(1000, 500), work)).toStrictEqual({
      height: 500 + 48 + 24 + 76,
      width: 1048,
    });
  });

  it("stays between the smallest window and 90% of the work area", () => {
    expect(viewerWindowSize(size(100, 50), work)).toStrictEqual({
      height: 360,
      width: 600,
    });
    expect(viewerWindowSize(size(4000, 3000), work)).toStrictEqual({
      height: 929,
      width: 1728,
    });
  });
});

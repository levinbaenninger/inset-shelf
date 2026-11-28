import { describe, expect, it } from "vite-plus/test";

import {
  dockedBeside,
  dockShelf,
  noticeBesidePointer,
  noticeInWindowCorner,
  resizeAtCorner,
  pt,
  rect,
  size,
  viewerImageRect,
  viewerWindowSize,
  WINDOWS_FRAME_INSET_DIP,
} from "./geometry";

describe(dockShelf, () => {
  const work = rect<"screen">(0, 25, 1440, 850);

  it("docks beside the right edge of the window, centred on its height, 620 tall", () => {
    expect(dockShelf(rect<"screen">(100, 100, 800, 600), work)).toStrictEqual(
      rect(908, 90, 340, 620)
    );
  });

  it("centres the shelf on a taller window", () => {
    expect(dockShelf(rect<"screen">(100, 25, 800, 850), work)).toStrictEqual(
      rect(908, 140, 340, 620)
    );
  });

  it("docks to the left when there is no room on the right", () => {
    expect(dockShelf(rect<"screen">(500, 100, 900, 600), work)).toStrictEqual(
      rect(152, 90, 340, 620)
    );
  });

  it("sits inside the right edge of a window that fills the screen, centred, 620 tall", () => {
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
      ).toStrictEqual(rect(659, 87, 340, 620));
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

  it("keeps a short window's shelf at the one height, on screen", () => {
    expect(dockShelf(rect<"screen">(100, 700, 400, 120), work)).toStrictEqual(
      rect(508, 255, 340, 620)
    );
  });

  it("opens at the right without a window, centred on the screen's height", () => {
    expect(dockShelf(null, work)).toStrictEqual(rect(1092, 140, 340, 620));
  });

  it("opens at one height however it was opened", () => {
    const heights = [
      null,
      rect<"screen">(100, 100, 800, 600),
      rect<"screen">(100, 25, 800, 850),
      rect<"screen">(300, 200, 500, 420),
      rect<"screen">(0, 25, 1440, 850),
    ].map((target) => dockShelf(target, work).height);

    expect(new Set(heights)).toStrictEqual(new Set([620]));
  });
});

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

describe(noticeBesidePointer, () => {
  const notice = size<"screen">(320, 64);
  const ultrawide = rect<"screen">(0, 25, 5120, 1415);

  it("shows below and to the right of the pointer, anywhere on a wide screen", () => {
    expect(noticeBesidePointer(pt(900, 700), notice, ultrawide)).toStrictEqual(
      rect(912, 712, 320, 64)
    );
  });

  it("flips to the left and above near the screen's right and bottom edges", () => {
    expect(
      noticeBesidePointer(pt(5000, 1400), notice, ultrawide)
    ).toStrictEqual(rect(4668, 1324, 320, 64));
  });

  it("stays on a display left of the main one", () => {
    const left = rect<"screen">(-1920, 0, 1920, 1080);

    expect(noticeBesidePointer(pt(-1910, 5), notice, left)).toStrictEqual(
      rect(-1898, 17, 320, 64)
    );
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

describe(resizeAtCorner, () => {
  const workArea = rect<"screen">(0, 25, 1440, 875);
  const notice = rect<"screen">(500, 300, 260, 44);
  const field = size<"screen">(320, 44);

  it.each([
    ["top-left", rect<"screen">(500, 300, 320, 44)],
    ["top-right", rect<"screen">(440, 300, 320, 44)],
    ["bottom-left", rect<"screen">(500, 300, 320, 44)],
    ["bottom-right", rect<"screen">(440, 300, 320, 44)],
  ] as const)("keeps the %s corner where it was", (corner, expected) => {
    expect(resizeAtCorner(notice, corner, field, workArea)).toStrictEqual(
      expected
    );
  });

  it("stays inside the work area when the corner is near its edge", () => {
    expect(
      resizeAtCorner(rect(1170, 856, 260, 44), "top-left", field, workArea)
    ).toStrictEqual(rect(1120, 856, 320, 44));
  });
});

describe(noticeInWindowCorner, () => {
  const workArea = rect<"screen">(0, 25, 1440, 875);
  const pill = size<"screen">(260, 44);

  it("sits 12 in from the window's bottom-right corner", () => {
    expect(
      noticeInWindowCorner(rect(100, 100, 800, 600), pill, workArea)
    ).toStrictEqual(rect(628, 644, 260, 44));
  });

  it("stays inside the work area when the window reaches past it", () => {
    expect(
      noticeInWindowCorner(rect(900, 500, 800, 600), pill, workArea)
    ).toStrictEqual(rect(1180, 856, 260, 44));
  });

  it("takes the work area's corner without a window", () => {
    expect(noticeInWindowCorner(null, pill, workArea)).toStrictEqual(
      rect(1168, 844, 260, 44)
    );
  });
});

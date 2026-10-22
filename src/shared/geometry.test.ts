import { describe, expect, it } from "vitest";

import {
  areaToImage,
  defaultCrop,
  dragRect,
  pinInCrop,
  pixelsPerDip,
  dockShelf,
  pt,
  rect,
  screenToImage,
  size,
} from "./geometry";

const retina = size<"image">(2880, 1800);

describe(screenToImage, () => {
  it("maps a 2x display by the actual image size", () => {
    expect(
      screenToImage(pt(720, 450), rect(0, 0, 1440, 900), retina)
    ).toStrictEqual({
      x: 1440,
      y: 900,
    });
  });

  it("handles a display with a negative origin", () => {
    expect(
      screenToImage(
        pt(-1000, 300),
        rect(-1920, 0, 1920, 1080),
        size(1920, 1080)
      )
    ).toStrictEqual({ x: 920, y: 300 });
  });

  it("handles mixed scale with a negative vertical origin", () => {
    expect(
      screenToImage(
        pt(3520, 140),
        rect(2560, -400, 1920, 1080),
        size(2400, 1350)
      )
    ).toStrictEqual({ x: 1200, y: 675 });
  });

  it("uses the delivered image size, not bounds × scaleFactor", () => {
    expect(
      screenToImage(pt(640, 400), rect(0, 0, 1280, 800), size(1280, 800))
    ).toStrictEqual({ x: 640, y: 400 });
  });

  it("clamps the right and bottom edge to the last pixel", () => {
    expect(
      screenToImage(pt(1440, 900), rect(0, 0, 1440, 900), retina)
    ).toStrictEqual({ x: 2879, y: 1799 });
  });

  it("floors fractional DIP points", () => {
    expect(
      screenToImage(pt(100.5, 50.25), rect(0, 0, 1440, 900), retina)
    ).toStrictEqual({ x: 201, y: 100 });
  });

  it("keeps spaces apart at the type level", () => {
    const screenPoint = pt<"screen">(1, 2);
    // @ts-expect-error a screen point is not an image point
    const imagePoint: Point<"image"> = screenPoint;

    expect(imagePoint).toStrictEqual({ x: 1, y: 2 });
  });
});

describe(pixelsPerDip, () => {
  it("is the measured width ratio", () => {
    expect(pixelsPerDip(rect(0, 0, 1920, 1080), size(2400, 1350))).toBe(1.25);
  });
});

describe(defaultCrop, () => {
  it("centres 480×300 DIP on the pin", () => {
    expect(defaultCrop(pt(1440, 900), retina, 2)).toStrictEqual({
      height: 600,
      width: 960,
      x: 960,
      y: 600,
    });
  });

  it("shifts into the image near the top-left and bottom-right edges", () => {
    expect(defaultCrop(pt(50, 40), retina, 2)).toStrictEqual({
      height: 600,
      width: 960,
      x: 0,
      y: 0,
    });
    expect(defaultCrop(pt(2870, 1790), retina, 2)).toStrictEqual({
      height: 600,
      width: 960,
      x: 1920,
      y: 1200,
    });
  });

  it("rounds the origin at a fractional scale", () => {
    expect(defaultCrop(pt(1200, 675), size(2400, 1350), 1.25)).toStrictEqual({
      height: 375,
      width: 600,
      x: 900,
      y: 488,
    });
  });

  it("shrinks only to an image smaller than the default", () => {
    expect(defaultCrop(pt(100, 100), size(400, 250), 1)).toStrictEqual({
      height: 250,
      width: 400,
      x: 0,
      y: 0,
    });
  });
});

describe(areaToImage, () => {
  it("scales a dragged area by the actual image size", () => {
    expect(
      areaToImage(rect(100, 50, 480, 300), size(1440, 900), retina)
    ).toStrictEqual(rect(200, 100, 960, 600));
  });

  it("covers fractional edges and stays inside the image", () => {
    expect(
      areaToImage(rect(1430.4, 890.2, 50, 50), size(1440, 900), retina)
    ).toStrictEqual(rect(2860, 1780, 20, 20));
  });

  it("keeps at least one pixel", () => {
    expect(
      areaToImage(rect(10, 10, 0, 0), size(1440, 900), retina)
    ).toStrictEqual(rect(20, 20, 1, 1));
  });
});

describe(dragRect, () => {
  it("normalises a drag from any corner", () => {
    expect(dragRect(pt(300, 200), pt(100, 50))).toStrictEqual(
      rect(100, 50, 200, 150)
    );
  });
});

describe(pinInCrop, () => {
  it("makes the pin relative to the crop", () => {
    expect(pinInCrop(pt(500, 400), rect(200, 100, 960, 600))).toStrictEqual(
      pt(300, 300)
    );
  });
});

describe(dockShelf, () => {
  const work = rect<"screen">(0, 25, 1440, 850);

  it("docks beside the right edge of the window, at its top and height", () => {
    expect(dockShelf(rect<"screen">(100, 100, 800, 600), work)).toStrictEqual(
      rect(908, 100, 340, 600)
    );
  });

  it("docks to the left when there is no room on the right", () => {
    expect(dockShelf(rect<"screen">(500, 100, 900, 600), work)).toStrictEqual(
      rect(152, 100, 340, 600)
    );
  });

  it("sits inside the right edge of a window that fills the screen", () => {
    expect(dockShelf(rect<"screen">(0, 25, 1440, 850), work)).toStrictEqual(
      rect(1092, 25, 340, 850)
    );
  });

  it("keeps a short window's shelf tall enough and on screen", () => {
    expect(dockShelf(rect<"screen">(100, 700, 400, 120), work)).toStrictEqual(
      rect(508, 515, 340, 360)
    );
  });

  it("opens at the top right without a window", () => {
    expect(dockShelf(null, work)).toStrictEqual(rect(1092, 33, 340, 560));
  });
});

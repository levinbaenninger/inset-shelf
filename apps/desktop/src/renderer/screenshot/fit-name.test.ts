import { describe, expect, it } from "vite-plus/test";

import { fitName } from "./fit-name";

/** Every character 10 wide, the ellipsis 8. */
const MEASURE = { dots: 8, upTo: (end: number) => end * 10 };

describe(fitName, () => {
  it("leaves a name that fits as it is", () => {
    expect(fitName("Bildschirm", 100, MEASURE)).toBe("Bildschirm");
  });

  it("cuts a longer name to its longest start, with the ellipsis right after it", () => {
    expect(fitName("Bildschirmfoto", 100, MEASURE)).toBe("Bildschir…");
  });

  it("leaves no space before the ellipsis", () => {
    expect(fitName("Quote from the movers", 68, MEASURE)).toBe("Quote…");
  });

  it("never cuts inside a character made of several", () => {
    expect(fitName("ab👩‍👩‍👧cdefghijklmnop", 80, MEASURE)).toBe("ab…");
  });

  it("is the ellipsis alone when not even one character fits", () => {
    expect(fitName("Bildschirmfoto", 12, MEASURE)).toBe("…");
  });
});

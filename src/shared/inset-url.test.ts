import { describe, expect, it } from "vitest";

import { insetUrl, originOf, parseInsetUrl } from "./inset-url";

const FILE = "3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1b2c.png";

describe(parseInsetUrl, () => {
  it("accepts an attachment by its generated file name", () => {
    expect(parseInsetUrl(insetUrl.attachment(FILE))).toStrictEqual({
      file: FILE,
      kind: "attachment",
    });
  });

  it("accepts a screenshot card's image by token", () => {
    expect(parseInsetUrl(insetUrl.shot("k3x9"))).toStrictEqual({
      kind: "shot",
      token: "k3x9",
    });
    expect(parseInsetUrl("inset://shot/a-b")).toBeNull();
  });

  it("accepts the frozen frame by token", () => {
    expect(parseInsetUrl(insetUrl.frame("k3x9"))).toStrictEqual({
      kind: "frame",
      token: "k3x9",
    });
  });

  it.each([
    ["dot segments", `inset://attachment/../${FILE}`],
    ["an upper-case name", `inset://attachment/${FILE.toUpperCase()}`],
    [
      "another extension",
      "inset://attachment/3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1b2c.json",
    ],
    ["an extra segment", `inset://attachment/${FILE}/x`],
    ["a query string", `inset://attachment/${FILE}?a=1`],
    ["a fragment", `inset://attachment/${FILE}#x`],
    ["an encoded dot segment", "inset://app/%2e%2e/main.js"],
    ["an encoded slash", "inset://app/assets%2fa.js"],
    ["an unknown host", "inset://evil/x"],
    ["another scheme", `file://attachment/${FILE}`],
    ["an empty app path", "inset://app/"],
    ["a port", "inset://app:80/shelf.html"],
    ["a frame token with symbols", "inset://frame/a-b"],
  ])("rejects %s", (_label, url) => {
    expect(parseInsetUrl(url)).toBeNull();
  });

  it("accepts app bundle files and round-trips the page builder", () => {
    expect(parseInsetUrl("inset://app/assets/a.js")).toStrictEqual({
      kind: "app",
      path: "assets/a.js",
    });
    expect(parseInsetUrl(insetUrl.page("shelf"))).toStrictEqual({
      kind: "app",
      path: "shelf.html",
    });
  });
});

describe(originOf, () => {
  it("derives an origin for the custom scheme and for the dev server", () => {
    expect(originOf("inset://app/shelf.html")).toBe("inset://app");
    expect(originOf("http://localhost:5173/shelf.html")).toBe(
      "http://localhost:5173"
    );
    expect(originOf("not a url")).toBeNull();
  });
});

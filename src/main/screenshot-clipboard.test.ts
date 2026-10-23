import { describe, expect, it } from "vitest";

import { isScreenshotClipboard } from "./screenshot-clipboard";

describe(isScreenshotClipboard, () => {
  it("takes a clipboard holding only a screenshot's image", () => {
    expect(isScreenshotClipboard(["public.png"])).toBeTruthy();
    expect(isScreenshotClipboard(["public.png", "public.tiff"])).toBeTruthy();
  });

  it("leaves images copied from apps and anything with text", () => {
    expect(
      isScreenshotClipboard(["public.png", "public.html", "public.tiff"])
    ).toBeFalsy();
    expect(isScreenshotClipboard(["public.utf8-plain-text"])).toBeFalsy();
    expect(isScreenshotClipboard(["public.tiff"])).toBeFalsy();
  });
});

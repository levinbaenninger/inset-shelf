import { WindowIdSchema, WindowRefSchema } from "@shared/shelf";
import { describe, expect, it } from "vitest";

import { windowRef } from "./window-ref";

const ID = WindowIdSchema.parse("3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1c09");
const AT = new Date("2026-11-05T09:30:00.000Z");

const window = {
  app: "Safari",
  appPath: "/Applications/Safari.app",
  document: null,
  thumb: null,
  title: "Quote",
  url: "https://example.com/quote",
};

describe(windowRef, () => {
  it("keeps what fits as it is", () => {
    expect(windowRef(window, ID, AT)).toStrictEqual({
      app: "Safari",
      appPath: "/Applications/Safari.app",
      capturedAt: "2026-11-05T09:30:00.000Z",
      description: "",
      document: null,
      id: ID,
      thumb: null,
      title: "Quote",
      url: "https://example.com/quote",
    });
  });

  it("cuts a long title and app name to what the saved shelf keeps", () => {
    const ref = windowRef(
      { ...window, app: "A".repeat(250), title: "t".repeat(600) },
      ID,
      AT
    );

    expect(ref.title).toBe(`${"t".repeat(499)}…`);
    expect(ref.app).toBe(`${"A".repeat(199)}…`);
    expect(WindowRefSchema.safeParse(ref).success).toBeTruthy();
  });

  it("never cuts an emoji in half", () => {
    const ref = windowRef(
      { ...window, title: `${"t".repeat(498)}😀😀` },
      ID,
      AT
    );

    expect(ref.title).toBe(`${"t".repeat(498)}…`);
  });

  it("drops a page, file or app path that doesn't fit whole", () => {
    const ref = windowRef(
      {
        ...window,
        appPath: `/${"a".repeat(5000)}`,
        document: `/${"d".repeat(5000)}`,
        url: `https://example.com/${"p".repeat(2000)}`,
      },
      ID,
      AT
    );

    expect([ref.url, ref.document, ref.appPath]).toStrictEqual([
      null,
      null,
      null,
    ]);
  });

  it("drops a link that isn't a web page", () => {
    expect(
      windowRef({ ...window, url: "file:///etc/hosts" }, ID, AT).url
    ).toBeNull();
  });
});

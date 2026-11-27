import { describe, expect, it } from "vite-plus/test";

import { parseFocusedWindow } from "./page-address";

const AREAS = [{ title: "Pricing", url: "https://example.com/pricing" }];

describe(parseFocusedWindow, () => {
  it("reads the web areas and the document the window names", () => {
    expect(
      parseFocusedWindow(
        JSON.stringify({ areas: AREAS, document: "file:///Users/anna/a.ts" })
      )
    ).toStrictEqual({ areas: AREAS, document: "file:///Users/anna/a.ts" });
  });

  it.each([
    ["no document", { areas: AREAS }],
    ["an empty document", { areas: AREAS, document: "" }],
    ["a document that is no text", { areas: AREAS, document: 7 }],
  ])("keeps the web areas of a window with %s", (_, answer) => {
    expect(parseFocusedWindow(JSON.stringify(answer))).toStrictEqual({
      areas: AREAS,
      document: null,
    });
  });

  it("keeps the document when the web areas are unreadable", () => {
    expect(
      parseFocusedWindow(
        JSON.stringify({ areas: [{ url: 3 }], document: "file:///a.ts" })
      )
    ).toStrictEqual({ areas: [], document: "file:///a.ts" });
  });

  it.each(["", "{ not json", "null", "[]"])(
    "reads nothing from %j",
    (output) => {
      expect(parseFocusedWindow(output)).toStrictEqual({
        areas: [],
        document: null,
      });
    }
  );
});

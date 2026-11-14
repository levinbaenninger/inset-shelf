import { describe, expect, it } from "vitest";

import {
  clipboardContent,
  holdsAgain,
  holdsAgainIn,
  readableClipboard,
  sameClipboard,
} from "./clipboard-match";

const RAW = 'electron application/osclipboard;format="DataObject"';

describe(sameClipboard, () => {
  it("compares the bytes of every format, regardless of format order", async () => {
    await expect(
      sameClipboard(
        [
          {
            "text/html": new Blob(["<b>x</b>"]),
            "text/plain": new Blob(["x"]),
          },
        ],
        [{ "text/plain": new Blob(["x"]), "text/html": new Blob(["<b>x</b>"]) }]
      )
    ).resolves.toBeTruthy();
  });

  it("detects a different picture even with the same formats and text", async () => {
    await expect(
      sameClipboard(
        [{ "image/png": new Blob(["first"]), "text/plain": new Blob(["x"]) }],
        [{ "image/png": new Blob(["other"]), "text/plain": new Blob(["x"]) }]
      )
    ).resolves.toBeFalsy();
  });

  it("detects added formats and changes to raw formats", async () => {
    await expect(
      sameClipboard([], [{ "image/png": new Blob(["png"]) }])
    ).resolves.toBeFalsy();
    await expect(
      sameClipboard(
        [{ [RAW]: new Blob(["first"]) }],
        [{ [RAW]: new Blob(["other"]) }]
      )
    ).resolves.toBeFalsy();
  });

  it("skips a format that came back empty on one side, as a read cut short by another app's hold leaves it", async () => {
    await expect(
      sameClipboard(
        [{ [RAW]: new Blob([]), "text/plain": new Blob(["x"]) }],
        [{ [RAW]: new Blob(["raw"]), "text/plain": new Blob(["x"]) }]
      )
    ).resolves.toBeTruthy();
    await expect(
      sameClipboard(
        [{ [RAW]: new Blob([]), "text/plain": new Blob(["x"]) }],
        [{ [RAW]: new Blob(["raw"]), "text/plain": new Blob(["newer"]) }]
      )
    ).resolves.toBeFalsy();
  });

  it("compares bookmark contents", async () => {
    const type = "electron application/bookmark";
    const bookmark = { title: "Page", url: "https://example.com" };

    await expect(
      sameClipboard([{ [type]: bookmark }], [{ [type]: { ...bookmark } }])
    ).resolves.toBeTruthy();
    await expect(
      sameClipboard(
        [{ [type]: bookmark }],
        [{ [type]: { ...bookmark, url: "https://example.org" } }]
      )
    ).resolves.toBeFalsy();
  });
});

describe(holdsAgain, () => {
  it("holds text put back", async () => {
    await expect(
      holdsAgain(
        [{ "text/plain": new Blob(["earlier"]) }],
        ["text/plain"],
        "earlier"
      )
    ).resolves.toBeTruthy();
  });

  it("doesn't hold it while the copied selection is still there", async () => {
    await expect(
      holdsAgain(
        [{ "text/plain": new Blob(["earlier"]) }],
        ["text/plain", "text/html"],
        "the selection"
      )
    ).resolves.toBeFalsy();
  });

  it("doesn't hold a picture when only text is there", async () => {
    await expect(
      holdsAgain([{ "image/png": new Blob(["png"]) }], ["text/plain"], "x")
    ).resolves.toBeFalsy();
  });

  it("holds rich text that came back with formats added, as on macOS", async () => {
    await expect(
      holdsAgain(
        [
          {
            "text/html": new Blob(["<b>hi</b>"]),
            "text/rtf": new Blob(["{}"]),
          },
        ],
        ["text/plain", "text/html", "text/rtf", RAW],
        "hi"
      )
    ).resolves.toBeTruthy();
  });

  it("holds an empty clipboard only while nothing readable is on it", async () => {
    await expect(holdsAgain([], [], "")).resolves.toBeTruthy();
    await expect(
      holdsAgain([{ [RAW]: new Blob([""]) }], [RAW], "")
    ).resolves.toBeTruthy();
    await expect(
      holdsAgain([], ["text/plain"], "the selection")
    ).resolves.toBeFalsy();
  });

  it("reads Windows line breaks and a trailing NUL as the same text", async () => {
    await expect(
      holdsAgain(
        [{ "text/plain": new Blob(["one\r\ntwo"]) }],
        ["text/plain"],
        "one\ntwo\0"
      )
    ).resolves.toBeTruthy();
  });
});

describe(readableClipboard, () => {
  it("takes formats with nothing in them for a read made while another app held the clipboard", () => {
    expect({
      empty: readableClipboard([]),
      held: readableClipboard([{ "text/plain": new Blob([]) }]),
      raw: readableClipboard([{ [RAW]: new Blob(["x"]) }]),
      text: readableClipboard([{ "text/plain": new Blob(["earlier"]) }]),
    }).toStrictEqual({ empty: true, held: false, raw: true, text: true });
  });

  it("reads a clipboard Windows has cleared, with only empty raw formats left, as readable and empty", () => {
    expect(
      readableClipboard([
        {
          [RAW]: new Blob([]),
          'electron application/osclipboard;format="Ole Private Data"':
            new Blob([]),
        },
      ])
    ).toBeTruthy();
  });

  it("reads a read cut short by a hold, with the text in and raw formats empty, as readable", () => {
    expect(
      readableClipboard([
        { [RAW]: new Blob([]), "text/plain": new Blob(["x"]) },
      ])
    ).toBeTruthy();
  });
});

describe(holdsAgainIn, () => {
  it("judges the read it is given: its formats and its plain text", async () => {
    const saved = [{ "text/plain": new Blob(["earlier"]) }];

    expect({
      back: await holdsAgainIn(saved, [
        { "text/plain": new Blob(["earlier"]) },
      ]),
      held: await holdsAgainIn(saved, [{ "text/plain": new Blob([]) }]),
      selection: await holdsAgainIn(saved, [
        { "text/plain": new Blob(["the selection"]) },
      ]),
    }).toStrictEqual({ back: true, held: false, selection: false });
  });
});

describe(clipboardContent, () => {
  it("reads the plain text and HTML of one read, empty for what it hasn't", async () => {
    expect({
      both: await clipboardContent([
        { "text/html": new Blob(["<b>x</b>"]), "text/plain": new Blob(["x"]) },
      ]),
      none: await clipboardContent([]),
    }).toStrictEqual({
      both: { html: "<b>x</b>", text: "x" },
      none: { html: "", text: "" },
    });
  });
});

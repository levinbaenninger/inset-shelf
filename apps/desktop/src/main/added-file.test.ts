import { describe, expect, it } from "vite-plus/test";

import { addedNotice, classifyAddedFile, noticeText } from "./added-file";

describe(classifyAddedFile, () => {
  it("shows pictures as images and keeps other files as files", () => {
    expect(
      classifyAddedFile("/Users/me/Desktop/Screen Shot.PNG")
    ).toStrictEqual({
      extension: "png",
      kind: "image",
      name: "Screen Shot.PNG",
    });
    expect(classifyAddedFile("/tmp/Quarterly report.pdf")).toMatchObject({
      extension: "pdf",
      kind: "file",
    });
  });

  it("stores unusual extensions under a safe one", () => {
    expect(classifyAddedFile("/tmp/notes")).toMatchObject({
      extension: "bin",
      kind: "file",
      name: "notes",
    });
    expect(classifyAddedFile("/tmp/archive.tar.gz;rm")).toMatchObject({
      extension: "bin",
    });
  });
});

describe(addedNotice, () => {
  it("says what was added in a done tone when everything was", () => {
    expect(addedNotice(2, 2, [], "file")).toStrictEqual({
      headline: "Added 2 files",
      reasons: [],
      tone: "done",
    });
  });

  it("names what couldn't be added, in a failed tone", () => {
    const notice = addedNotice(1, 2, ["x is a folder, not a file."], "file");

    expect({ text: noticeText(notice), tone: notice.tone }).toStrictEqual({
      text: "Added 1 of 2. x is a folder, not a file.",
      tone: "failed",
    });
  });

  it("fails when the shelf took nothing, even with no reason given", () => {
    expect(addedNotice(0, 1, [], "picture")).toStrictEqual({
      headline: "Nothing was added.",
      reasons: [],
      tone: "failed",
    });
  });

  it("fails when the shelf took fewer than were tried, even with no reason given", () => {
    expect(addedNotice(1, 2, [], "file")).toStrictEqual({
      headline: "Added 1 of 2.",
      reasons: [],
      tone: "failed",
    });
  });
});

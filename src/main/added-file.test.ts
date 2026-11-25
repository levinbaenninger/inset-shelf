import { describe, expect, it } from "vitest";

import { addedNotice, classifyAddedFile } from "./added-file";

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
      message: "Added 2 files",
      tone: "done",
    });
  });

  it("names what couldn't be added, in a failed tone", () => {
    expect(
      addedNotice(1, 2, ["x is a folder, not a file."], "file")
    ).toStrictEqual({
      message: "Added 1 of 2. x is a folder, not a file.",
      tone: "failed",
    });
  });

  it("fails when the shelf took nothing, even with no reason given", () => {
    expect(addedNotice(0, 1, [], "picture")).toStrictEqual({
      message: "Nothing was added.",
      tone: "failed",
    });
  });

  it("fails when the shelf took fewer than were tried, even with no reason given", () => {
    expect(addedNotice(1, 2, [], "file")).toStrictEqual({
      message: "Added 1 of 2.",
      tone: "failed",
    });
  });
});

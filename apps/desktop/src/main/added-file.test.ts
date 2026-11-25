import { describe, expect, it } from "vitest";

import { classifyAddedFile } from "./added-file";

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

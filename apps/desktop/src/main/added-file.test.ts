import { describe, expect, it } from "vite-plus/test";

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

  it("never keeps a separator or a dot name as the file's name", () => {
    expect(classifyAddedFile(String.raw`/tmp/a\..\b.txt`).name).toBe(
      "a_.._b.txt"
    );
    expect(classifyAddedFile("/tmp/..").name).toBe("File");
    expect(classifyAddedFile("/").name).toBe("File");
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

import { describe, expect, it } from "vite-plus/test";

import { codeEditor, codePlace, titleParts } from "./code-editors";
import type { CodeEditor } from "./code-editors";

const rowOf = (app: string): CodeEditor => {
  const editor = codeEditor(app);

  if (editor === undefined) {
    throw new Error(`no row for ${app}`);
  }

  return editor;
};

describe(codeEditor, () => {
  it("finds Code by its macOS and its Windows name", () => {
    expect(codeEditor("Visual Studio Code")).toBe(codeEditor("Code"));
    expect(codeEditor("Code")).toBeDefined();
    expect(codeEditor("Cursor")).toBeDefined();
  });

  it("has no row for an app that is no code editor", () => {
    expect(codeEditor("Notes")).toBeUndefined();
    expect(codeEditor(null)).toBeUndefined();
  });
});

describe(titleParts, () => {
  it.each([
    // Read from a running Code on macOS: "<file> — <folder>".
    ["Code", "settings.json — dotfiles", "settings.json", "dotfiles"],
    ["Code", "● settings.json — dotfiles", "settings.json", "dotfiles"],
    // Code's title template: a folder location and a profile follow the project.
    ["Code", "index.ts — inset-shelf — Work", "index.ts", "inset-shelf"],
    // Windows: the same template, with the app's name at the end.
    [
      "Visual Studio Code",
      "index.ts - inset-shelf - Visual Studio Code",
      "index.ts",
      "inset-shelf",
    ],
    ["Visual Studio Code", "index.ts - inset-shelf", "index.ts", "inset-shelf"],
    ["Cursor", "index.ts — inset-shelf", "index.ts", "inset-shelf"],
  ] as const)("reads %s's %j", (app, title, file, project) => {
    expect(titleParts(rowOf(app), title, app)).toStrictEqual({
      file,
      project,
    });
  });

  it.each([
    ["only a project", "Code", "inset-shelf"],
    ["only a file", "Code", "index.ts"],
    ["only the app's name", "Visual Studio Code", "Visual Studio Code"],
    ["no title", "Code", null],
  ] as const)("names nothing in a title with %s", (_, app, title) => {
    expect(titleParts(rowOf(app), title, app)).toStrictEqual({
      file: null,
      project: null,
    });
  });

  it("takes no editor's name for a project", () => {
    expect(
      titleParts(rowOf("Code"), "index.ts - Visual Studio Code", "Code")
    ).toStrictEqual({ file: "index.ts", project: null });
  });
});

describe(codePlace, () => {
  const code = rowOf("Code");

  it("takes the folder the title names as the file's project", () => {
    expect(
      codePlace(
        code,
        "/Users/anna/dev/inset-shelf/apps/desktop/src/a.ts",
        "a.ts — inset-shelf",
        "Code"
      )
    ).toStrictEqual({
      file: "/Users/anna/dev/inset-shelf/apps/desktop/src/a.ts",
      line: null,
      root: "/Users/anna/dev/inset-shelf",
    });
  });

  it("takes the deepest folder of that name", () => {
    expect(
      codePlace(
        code,
        "/Users/anna/proj/packages/proj/src/a.ts",
        "a.ts — proj",
        "Code"
      )?.root
    ).toBe("/Users/anna/proj/packages/proj");
  });

  it.each([
    ["a workspace", "a.ts — my (Workspace)"],
    ["a remote", "a.ts — app [SSH: box]"],
    ["no folder of the file", "a.ts — elsewhere"],
    ["only the file", "a.ts"],
    ["the file's own name as project", "a.ts — a.ts"],
  ])("keeps the file without a project when the title names %s", (_, title) => {
    expect(
      codePlace(code, "/Users/anna/dev/my/a.ts", title, "Code")
    ).toStrictEqual({
      file: "/Users/anna/dev/my/a.ts",
      line: null,
      root: null,
    });
  });

  it("drops a path longer than the shelf keeps, whole", () => {
    const file = `/${"a".repeat(4096)}`;

    expect(file).toHaveLength(4097);
    expect(codePlace(code, file, "a — b", "Code")).toBeNull();
  });

  it.each([
    ["no document", null],
    ["an empty document", ""],
    ["a relative path", "src/a.ts"],
  ])("has no place with %s", (_, document) => {
    expect(codePlace(code, document, "a.ts — proj", "Code")).toBeNull();
  });

  it("has no place for an app without a row, or a row whose document is not confirmed", () => {
    const document = "/Users/anna/dev/proj/a.ts";

    expect(
      codePlace(codeEditor("Notes"), document, "a.ts — proj", "Notes")
    ).toBeNull();
    expect(
      codePlace(rowOf("Cursor"), document, "a.ts — proj", "Cursor")
    ).toBeNull();
  });
});

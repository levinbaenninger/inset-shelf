import { describe, expect, it } from "vite-plus/test";

import { codeEditor, titleParts } from "./code-editors";
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
    // A file's name with a dash in it: the title's own dash is the longer one.
    [
      "Code",
      "Design - notes.md — inset-shelf",
      "Design - notes.md",
      "inset-shelf",
    ],
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

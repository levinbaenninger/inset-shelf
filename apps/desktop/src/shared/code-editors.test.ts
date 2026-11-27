import { describe, expect, it } from "vite-plus/test";

import { codeEditor, codeLabel, codePlace, titleParts } from "./code-editors";
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
    // On Windows the title's dash is the short one, whatever a file's name holds.
    [
      "Visual Studio Code",
      "Design — notes.md - alpha",
      "Design — notes.md",
      "alpha",
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
    [
      "the file's name",
      "/Users/anna/proj/src/report — draft.ts",
      "report — draft.ts — proj",
      "/Users/anna/proj",
    ],
    [
      "the project folder's name",
      "/Users/anna/my — proj/src/a.ts",
      "a.ts — my — proj",
      "/Users/anna/my — proj",
    ],
    [
      "both, with a profile after them",
      "/Users/anna/my — proj/src/report — draft.ts",
      "report — draft.ts — my — proj — Work",
      "/Users/anna/my — proj",
    ],
    [
      // The title's own dash is known from the file's name: a shorter one in the folder's name is part of the name.
      "neither, with another dash in the project's name and a folder named like its start inside",
      "/Users/anna/my - proj/my/a.ts",
      "a.ts — my - proj",
      "/Users/anna/my - proj",
    ],
  ])(
    "finds the project when the title's dash is in %s",
    (_, file, title, root) => {
      expect(codePlace(code, file, title, "Code")?.root).toBe(root);
    }
  );

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

describe(codeLabel, () => {
  const file =
    "/Users/anna/Developer/inset-shelf/apps/desktop/src/shared/recall.ts";

  const root = "/Users/anna/Developer/inset-shelf";

  it("names the file at its line and the project, with the path from home", () => {
    expect(codeLabel({ file, line: 147, root }, "/Users/anna")).toStrictEqual({
      file: "recall.ts:147",
      path: "~/Developer/inset-shelf/apps/desktop/src/shared/recall.ts",
      project: "inset-shelf",
    });
  });

  it("names the file alone when no line is stored", () => {
    expect(codeLabel({ file, line: null, root }, "/Users/anna/").file).toBe(
      "recall.ts"
    );
  });

  it("names no project without a project folder", () => {
    expect(
      codeLabel({ file, line: null, root: null }, "/Users/anna")
    ).toStrictEqual({
      file: "recall.ts",
      path: "~/Developer/inset-shelf/apps/desktop/src/shared/recall.ts",
      project: null,
    });
  });

  it.each([
    ["the path inside the project", root, "apps/desktop/src/shared/recall.ts"],
    ["the file's name without a project", null, "recall.ts"],
  ])(
    "shows %s when the home folder is not known, never the whole path",
    (_, folder, path) => {
      expect(codeLabel({ file, line: 147, root: folder }, null).path).toBe(
        path
      );
    }
  );

  it.each([
    ["/opt/src/proj/lib/a.ts", "/opt/src/proj"],
    // The same disk by another name: the home folder's path doesn't start it.
    [
      "/System/Volumes/Data/Users/anna/proj/lib/a.ts",
      "/System/Volumes/Data/Users/anna/proj",
    ],
  ])(
    "shows %s, outside the home folder, by its path inside the project, never whole",
    (outside, folder) => {
      expect(
        codeLabel({ file: outside, line: null, root: folder }, "/Users/anna")
          .path
      ).toBe("lib/a.ts");
    }
  );

  it("writes no ~ for a home folder whose name only starts the same", () => {
    expect(codeLabel({ file, line: null, root }, "/Users/an").path).toBe(
      "apps/desktop/src/shared/recall.ts"
    );
  });
});

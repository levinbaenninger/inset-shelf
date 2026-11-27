import { describe, expect, it } from "vite-plus/test";

import {
  CODE_EDITORS,
  codeEditor,
  codeLabel,
  codeAction,
  codePlace,
  codeWay,
  lineOfText,
  openAddress,
  titleParts,
} from "./code-editors";
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

/** The file and line an address names, as the editor reads them back. */
const opened = (address: string | null): string | null =>
  address === null ? null : decodeURIComponent(new URL(address).pathname);

describe(openAddress, () => {
  const code = rowOf("Code");

  it("opens a file in Code at its line", () => {
    expect(
      openAddress(code, { file: "/Users/anna/p/a.ts", line: 9, root: null }, 12)
    ).toBe("vscode://file/Users/anna/p/a.ts:12");
  });

  it.each([
    // An editor reads a colon and a number at an address's end as a line, encoded or not.
    ["a name that ends like a line", "/Users/anna/p/report:12", null],
    ["a name that ends like a line, at a line", "/Users/anna/p/report:12", 5],
    ["a name that ends like a line and a column", "/Users/anna/p/a:3:9", null],
    // Code splits the whole path on colons and takes a number wherever one stands alone.
    ["a number between colons in a name", "/Users/anna/p/a:12:b.ts", null],
    ["a folder with a colon", "/Users/anna/p:3/src/a.ts", null],
    ["a colon and no number", "/Users/anna/p/a:b.ts", 4],
    // Code opens a workspace file as a workspace, leaving the window's own.
    ["a workspace file", "/Users/anna/p/all.code-workspace", null],
    ["a workspace file at a line", "/Users/anna/p/all.code-workspace", 4],
  ])(
    "gives no address for %s, which it could not open as itself",
    (_, file, line) => {
      expect(openAddress(code, { file, line, root: null }, line)).toBeNull();
    }
  );

  it("opens the file alone when no line is known", () => {
    expect(
      openAddress(
        code,
        { file: "/Users/anna/p/a.ts", line: 9, root: null },
        null
      )
    ).toBe("vscode://file/Users/anna/p/a.ts");
  });

  it.each([
    ["a space", "/Users/anna/My Code/a b.ts"],
    ["a #", "/Users/anna/p/#notes/a#1.ts"],
    ["a ?", "/Users/anna/p/why?.ts"],
    ["a %", "/Users/anna/p/100%/a%20.ts"],
    ["a non-ASCII letter", "/Users/anna/Projekte/Zürich/straße.ts"],
    ["a $ and an &", "/Users/anna/p/$&a.ts"],
  ])("keeps a path with %s whole", (_, file) => {
    const place = { file, line: null, root: null };

    expect(opened(openAddress(code, place, 7))).toBe(`${file}:7`);
    expect(opened(openAddress(code, place, null))).toBe(file);
  });

  it("leaves no part of the path to be read as the address's query or fragment", () => {
    const address = new URL(
      openAddress(code, { file: "/p/a?b#c.ts", line: null, root: null }, 3) ??
        ""
    );

    expect([address.search, address.hash]).toStrictEqual(["", ""]);
  });

  it("gives no address for an editor not known to open a file", () => {
    expect(
      openAddress(rowOf("Cursor"), { file: "/p/a.ts", line: 1, root: null }, 1)
    ).toBeNull();
  });

  it("knows how to open every editor whose window names its file", () => {
    expect(
      CODE_EDITORS.filter(
        (editor) => editor.document === "file" && editor.open === null
      )
    ).toStrictEqual([]);
  });
});

/** A source file of `count` lines, each naming its own number, with `lines` put in at their 1-based number. */
const source = (count: number, lines: Readonly<Record<number, string>> = {}) =>
  Array.from(
    { length: count },
    (_, index) =>
      lines[index + 1] ?? `export const value${index + 1} = ${index + 1};`
  ).join("\n");

describe(lineOfText, () => {
  it("finds the line the captured text begins on when it is in the file once", () => {
    expect(lineOfText(source(40), "export const value12 = 12;")).toBe(12);
  });

  it("finds the first line of a capture over several lines, begun inside a line", () => {
    expect(
      lineOfText(source(40), "value12 = 12;\nexport const value13 = 13;")
    ).toBe(12);
  });

  it("gives no line for text that is in the file twice", () => {
    const twice = source(40, { 3: "retry();", 30: "retry();" });

    expect(lineOfText(twice, "retry();")).toBeNull();
  });

  it("gives no line for text that is not in the file", () => {
    expect(lineOfText(source(40), "a thought from no file")).toBeNull();
  });

  it.each([
    ["a file saved with CRLF, captured with LF", "\r\n", "\n"],
    ["a file saved with LF, captured with CRLF", "\n", "\r\n"],
    ["a file saved with CR alone, captured with LF", "\r", "\n"],
  ])("finds the line in %s", (_, saved, copied) => {
    const text = source(40).replaceAll("\n", saved);

    expect(
      lineOfText(
        text,
        `export const value12 = 12;${copied}export const value13 = 13;`
      )
    ).toBe(12);
  });

  it("gives no line when only the capture's first line is in the file", () => {
    // A copy from an unsaved buffer: its second line is not on disk, and its first is also a comment elsewhere.
    const file = source(40, { 7: "// const total = items.length;" });

    expect(
      lineOfText(file, "const total = items.length;\nreturn total + 1;")
    ).toBeNull();
  });

  it("gives no line when the lines after the first were copied with other indentation", () => {
    const file = source(40, {
      21: "    const total = items.length;",
      22: "    return total;",
    });

    expect(
      lineOfText(file, "  const total = items.length;\nreturn total;")
    ).toBeNull();
  });

  it("tells two places apart by the blanks the capture holds", () => {
    // The same words twice: only the selected one ends in two blanks.
    const file = source(40, { 9: "\tretry();", 30: "\tretry();  " });

    expect(lineOfText(file, "\tretry();  ")).toBe(30);
    expect(
      lineOfText(`\uFEFF${file.replaceAll("\n", "\r\n")}`, "\tretry();  ")
    ).toBe(30);
  });

  it("finds a whole selected line by its line break, before trimming loses it", () => {
    // Selecting the whole line run(); copies its break: only line 1 holds that.
    expect(lineOfText("run();\nrun(); // note\n", "run();\n")).toBe(1);
  });

  it.each([
    [
      "the line now holds more after it",
      "a();\nrun(); // unrelated\n",
      "run();\n",
    ],
    [
      "the next line's indent was selected too",
      "a();\nrun(); // unrelated\n",
      "run();\n  ",
    ],
  ])(
    "gives no line for a capture that ended its line when %s",
    (_, file, captured) => {
      expect(lineOfText(file, captured)).toBeNull();
    }
  );

  it.each([
    // A drag begun at the end of the line above copies its break: the capture began a line.
    [
      "the same words now end another line",
      "if (ready) run();\na();\nrun(); // ready is checked above\n",
      "\nrun();\n",
    ],
    [
      "the same words now end another line, its break copied twice",
      "if (ready) run();\n",
      "\n\nrun();  \n",
    ],
  ])(
    "gives no line for a capture that began its line when %s",
    (_, file, captured) => {
      expect(lineOfText(file, captured)).toBeNull();
    }
  );

  it("finds a capture that began its line where it still begins one", () => {
    expect(lineOfText("if (ready) go();\nrun();  \n", "\nrun();\n")).toBe(2);
  });

  it.each([
    ["blanks now end its line", "a();\nrun();  \nb();\n", 2],
    ["its line is now the file's last", "a();\nrun();", 2],
    ["the same words begin another line first", "run(); // x\nrun();\t\n", 2],
  ])("finds a capture that ended its line where %s", (_, file, line) => {
    expect(lineOfText(file, "run();\n")).toBe(line);
  });

  it("gives no line when the whole capture is in the file twice, however its trimmed form reads", () => {
    const file = source(40, { 9: "  retry();", 30: "  retry();" });

    expect(lineOfText(file, "  retry();")).toBeNull();
  });

  it("finds a capture whose blank end is not in the file, by all the lines it selected", () => {
    const file = source(40, {
      21: "  const total = 1;",
      22: "  return total;",
    });

    expect(lineOfText(file, "  const total = 1;\n  return total;   \n\n")).toBe(
      21
    );
  });

  it("gives no line when the capture without its blank ends is in the file twice", () => {
    const file = source(40, { 9: "retry();", 30: "retry();" });

    expect(lineOfText(file, "retry();  \n")).toBeNull();
  });

  it("gives no line for a capture whose two places in the file overlap", () => {
    expect(lineOfText("go();\ngo();\ngo();\n", "go();\ngo();")).toBeNull();
  });

  it("finds a capture just after a place that began the same way", () => {
    const file = source(40, {
      21: "  retry(1);",
      22: "  retry(1);",
      23: "  done();",
    });

    expect(lineOfText(file, "  retry(1);\n  done();")).toBe(22);
  });

  it("finds a line near the end of a file of 100,000 lines", () => {
    expect(
      lineOfText(source(100_000), "export const value99990 = 99990;")
    ).toBe(99_990);
  });

  it("starts at the first line that holds text, not a line break copied before it", () => {
    expect(lineOfText(source(40), "\n  \nexport const value12 = 12;\n")).toBe(
      12
    );
  });

  it("gives no line for a capture of only blank space", () => {
    expect(lineOfText(source(40), " \n\t\n")).toBeNull();
  });
});

const at = (file: string) => ({ file, line: null, root: null });

describe(codeWay, () => {
  it("opens a file in the editor it came from", () => {
    expect(codeWay("Code", at("/Users/anna/p/a.ts"))).toBe("editor");
  });

  it.each([
    ["a path with a colon", "/Users/anna/p/a:12.ts"],
    ["a workspace file", "/Users/anna/p/all.code-workspace"],
  ])(
    "shows %s in its folder, since no address opens it as itself",
    (_, file) => {
      expect(codeWay("Code", at(file))).toBe("folder");
    }
  );

  it.each([
    ["an app with no row", "Zed"],
    ["no app", null],
  ])("has no way to a file for %s", (_, app) => {
    expect(codeWay(app, at("/Users/anna/p/a.ts"))).toBeNull();
  });

  it("knows only the editors it is given", () => {
    expect(codeWay("Code", at("/Users/anna/p/a.ts"), [])).toBeNull();
  });
});

describe(codeAction, () => {
  it.each([
    ["editor", true, "Open in Code"],
    ["folder", true, "Show in Finder"],
    ["folder", false, "Show in Folder"],
  ] as const)("says what a click does: %s, on a Mac %s", (way, mac, words) => {
    expect(codeAction("Code", way, mac)).toBe(words);
  });
});

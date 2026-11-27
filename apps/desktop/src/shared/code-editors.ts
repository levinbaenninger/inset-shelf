import {
  atLine,
  CodePlaceSchema,
  fileName,
  fromHome,
  pathInProject,
} from "./code-place";
import type { CodePlace } from "./code-place";
import { cleanTitle } from "./window-title";

/**
 * The dashes an editor's title is split on, longest first: Code writes " — "
 * on macOS and " - " on Windows. A file's name may hold a dash too.
 */
const TITLE_DASHES = [" — ", " – ", " - "] as const;

export type TitleDash = (typeof TITLE_DASHES)[number];

/** What one part of an editor's window title names. */
export type TitlePart = "file" | "project";

export interface CodeEditor {
  /** The app names get-windows reports for it. */
  readonly apps: readonly string[];
  /** The parts of the cleaned title in order, split on a dash with spaces. Later parts are ignored. */
  readonly title: readonly TitlePart[];
  /** What the window's document attribute (AXDocument) names on macOS: the open file, or null when that is not confirmed. */
  readonly document: "file" | null;
  /**
   * The dash an app name's titles are split on, where the name tells the
   * platform. A name it leaves out, or a title without that dash (the user
   * can set another), is split on the longest dash the title holds.
   */
  readonly dash?: Readonly<Record<string, TitleDash>>;
}

/** What a window title names, by an editor's row. */
export interface TitleParts {
  readonly file: string | null;
  readonly project: string | null;
}

/**
 * The code editors, and how each one's window title reads. A row is added
 * only with a title read from the running app, kept as a test fixture.
 */
export const CODE_EDITORS: readonly CodeEditor[] = [
  {
    // "Code" on macOS, "Visual Studio Code" on Windows. Its title can go on
    // with a folder location and a profile after the project.
    apps: ["Code", "Visual Studio Code"],
    dash: { Code: " — ", "Visual Studio Code": " - " },
    // From Code's bundle, which sets the window's document to the active
    // editor's local file; not read from a running window with a file open.
    document: "file",
    title: ["file", "project"],
  },
  {
    // Inferred from Code, which it forks; not read from a running Cursor.
    apps: ["Cursor"],
    document: null,
    title: ["file", "project"],
  },
];

const EDITOR_NAMES: ReadonlySet<string> = new Set(
  CODE_EDITORS.flatMap((editor) => editor.apps)
);

/** The row for an app among `editors`, or undefined. */
export const codeEditor = (
  app: string | null,
  editors: readonly CodeEditor[] = CODE_EDITORS
): CodeEditor | undefined =>
  app === null
    ? undefined
    : editors.find((editor) => editor.apps.includes(app));

/** The dashes a title of `app` may be split on: its platform's own first. */
const dashesOf = (
  editor: CodeEditor,
  app: string | null
): readonly TitleDash[] => {
  const own = app === null ? undefined : editor.dash?.[app];

  return own === undefined ? TITLE_DASHES : [own, ...TITLE_DASHES];
};

/**
 * The file's and the project's name in a window title, by the editor's row.
 * A title with fewer parts than the row names gives neither: an editor drops
 * an empty part with its dash, so a lone part may be a file or a project.
 */
export const titleParts = (
  editor: CodeEditor,
  title: string | null,
  app: string | null
): TitleParts => {
  const clean = cleanTitle(title, app);

  const dash = dashesOf(editor, app).find(
    (each) => clean?.includes(each) === true
  );

  const parts =
    clean === null || dash === undefined
      ? []
      : clean.split(dash).map((each) => each.trim());

  const named = (part: TitlePart): string | null => {
    const text =
      parts.length < editor.title.length
        ? undefined
        : parts[editor.title.indexOf(part)];

    return text === undefined || text === "" || EDITOR_NAMES.has(text)
      ? null
      : text;
  };

  return { file: named("file"), project: named("project") };
};

/**
 * Which of a file's folders the title names as the project: the deepest one
 * of that name, or -1. The title is read after the file's own name, against
 * whole folder names, so a dash inside a name splits nothing. A title that
 * doesn't start with the file's name is read by the row's parts.
 */
const projectFolder = (
  editor: CodeEditor,
  file: { readonly folders: readonly string[]; readonly name: string },
  title: string | null,
  app: string | null
): number => {
  const clean = cleanTitle(title, app);

  // The dash after the file's name is the title's own: any other dash is part of a name.
  const dash = dashesOf(editor, app).find(
    (each) => clean?.startsWith(`${file.name}${each}`) === true
  );

  if (clean === null || dash === undefined) {
    const { project } = titleParts(editor, title, app);

    return project === null ? -1 : file.folders.lastIndexOf(project);
  }

  const rest = clean.slice(file.name.length + dash.length);

  return file.folders.findLastIndex(
    (folder) =>
      folder !== "" &&
      !EDITOR_NAMES.has(folder) &&
      (rest === folder || rest.startsWith(folder + dash))
  );
};

/**
 * Where in the code a window is: the file its document names, and the
 * deepest folder above it that the title names as the project. Only for an
 * editor whose document is confirmed to be the file; reads no disk.
 */
export const codePlace = (
  editor: CodeEditor | undefined,
  document: string | null,
  title: string | null,
  app: string | null
): CodePlace | null => {
  if (editor?.document !== "file" || document?.startsWith("/") !== true) {
    return null;
  }

  const folders = document.split("/").slice(0, -1);
  const name = document.slice(document.lastIndexOf("/") + 1);
  const deepest = projectFolder(editor, { folders, name }, title, app);

  const parsed = CodePlaceSchema.safeParse({
    file: document,
    line: null,
    root: deepest < 1 ? null : folders.slice(0, deepest + 1).join("/"),
  });

  return parsed.success ? parsed.data : null;
};

/** How a code place reads on an item. */
export interface CodeLabel {
  /** The file's name, with ":line" when a line is stored. */
  readonly file: string;
  /** The project folder's name, or null without one. */
  readonly project: string | null;
  /**
   * Where the file is, for a tooltip: from the home folder as "~/…". Without
   * a known home, only the part inside the project, so no user name shows.
   */
  readonly path: string;
}

/** The words an item from code shows: "recall.ts:147", "inset-shelf", and the path from home. */
export const codeLabel = (place: CodePlace, home: string | null): CodeLabel => {
  const root = place.root?.replace(/\/$/u, "") ?? "";

  return {
    file: atLine(fileName(place), place),
    path:
      home === null
        ? pathInProject(place)
        : (fromHome(place.file, home) ?? place.file),
    project: root === "" ? null : root.slice(root.lastIndexOf("/") + 1),
  };
};

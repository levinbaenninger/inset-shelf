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
    title: ["file", "project"],
  },
  {
    // Inferred from Code, which it forks; not read from a running Cursor.
    apps: ["Cursor"],
    title: ["file", "project"],
  },
];

const EDITOR_NAMES: ReadonlySet<string> = new Set(
  CODE_EDITORS.flatMap((editor) => editor.apps)
);

/** The row for an app, or undefined. */
export const codeEditor = (app: string | null): CodeEditor | undefined =>
  app === null
    ? undefined
    : CODE_EDITORS.find((editor) => editor.apps.includes(app));

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
  const own = app === null ? undefined : editor.dash?.[app];

  const dash = [...(own === undefined ? [] : [own]), ...TITLE_DASHES].find(
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

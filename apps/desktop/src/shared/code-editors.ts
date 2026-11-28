import {
  atLine,
  CodePlaceSchema,
  fileName,
  fromHome,
  pathInProject,
} from "./code-place";
import type { CodePlace } from "./code-place";
import type { TextItem } from "./shelf";
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
  /**
   * The addresses that open a file in the editor, with `{path}` the file's
   * absolute path and `{line}` its line: `atLine` when a line is known, `file`
   * when not. Null when how the editor opens a file is not confirmed.
   */
  readonly open: {
    readonly file: string;
    readonly atLine: string;
    /** An address that names only the editor's scheme: it finds the app that takes the others, and opens nothing. */
    readonly scheme: string;
    /** The ends of file names the address opens as something other than the file itself, a workspace say. */
    readonly not?: readonly string[];
  } | null;
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
    // Code's documented way in from outside (code.visualstudio.com/docs/configure/command-line).
    // A workspace file opens as a workspace there, in place of the window's own.
    open: {
      atLine: "vscode://file{path}:{line}",
      file: "vscode://file{path}",
      not: [".code-workspace"],
      scheme: "vscode://",
    },
    title: ["file", "project"],
  },
  {
    // Inferred from Code, which it forks; not read from a running Cursor.
    apps: ["Cursor"],
    document: null,
    open: null,
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

/** The cleaned title split on the dash the app's titles use, with that dash; no parts without one. */
const splitTitle = (
  editor: CodeEditor,
  title: string | null,
  app: string | null
): { readonly dash: TitleDash; readonly parts: readonly string[] } | null => {
  const clean = cleanTitle(title, app);

  const dash = dashesOf(editor, app).find(
    (each) => clean?.includes(each) === true
  );

  return clean === null || dash === undefined
    ? null
    : { dash, parts: clean.split(dash).map((each) => each.trim()) };
};

/** The cleaned title's parts, split on the dash the app's titles use; none without that dash. */
const partsOf = (
  editor: CodeEditor,
  title: string | null,
  app: string | null
): readonly string[] => splitTitle(editor, title, app)?.parts ?? [];

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
  const parts = partsOf(editor, title, app);

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
 * The file's and the project's name for showing: only from a title that
 * holds exactly the row's parts. With more, a dash may sit inside a name or
 * a location may follow the project, and the title alone can't say which, so
 * neither is given and nothing wrong is shown.
 */
export const shownTitleParts = (
  editor: CodeEditor,
  title: string | null,
  app: string | null
): TitleParts =>
  partsOf(editor, title, app).length === editor.title.length
    ? titleParts(editor, title, app)
    : { file: null, project: null };

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
   * a known home, or for a file outside it, only the part inside the project,
   * so no user name shows.
   */
  readonly path: string;
}

/** The words an item from code shows: "recall.ts:147", "inset-shelf", and the path from home. */
export const codeLabel = (place: CodePlace, home: string | null): CodeLabel => {
  const root = place.root?.replace(/\/$/u, "") ?? "";

  return {
    file: atLine(fileName(place), place),
    path:
      (home === null ? null : fromHome(place.file, home)) ??
      pathInProject(place),
    project: root === "" ? null : root.slice(root.lastIndexOf("/") + 1),
  };
};

/**
 * The address that opens a code place in its editor, at `line` when given,
 * or null when the editor's row knows no way to open a file, or the address
 * would open something other than this file: a path that holds a colon,
 * which an editor reads as a line wherever it stands and however the address
 * encodes it, or a name the row says it opens as something else. Each part of
 * the path is encoded, so a space, "#", "?", "%" or a letter outside ASCII
 * stays part of the path. The only place an editor's address is built.
 */
export const openAddress = (
  editor: CodeEditor,
  place: CodePlace,
  line: number | null
): string | null => {
  if (
    editor.open === null ||
    place.file.includes(":") ||
    editor.open.not?.some((end) => place.file.endsWith(end)) === true
  ) {
    return null;
  }

  const path = place.file.split("/").map(encodeURIComponent).join("/");
  const template = line === null ? editor.open.file : editor.open.atLine;

  return template
    .replace("{path}", () => path)
    .replace("{line}", () => String(line));
};

/** Line breaks as Windows, old Macs and the rest write them, made one. Text without a CR is left as it is. */
const oneLineBreak = (text: string): string =>
  text.includes("\r") ? text.replaceAll(/\r\n?/gu, "\n") : text;

/** The blank lines a capture can begin with: a drag begun at the end of the line above copies that line's break first. */
const BLANK_START = /^(?:[ \t]*\n)+/u;

/** Where a text was found: `at` its first place, `times` how often, counted to two. */
interface Found {
  readonly at: number;
  readonly times: 0 | 1 | 2;
}

/**
 * The UTF-16 unit at `at`. The search compares units, not code points: the
 * shelf's cap can cut a pair in two, and the half kept is still in the file.
 */
// oxlint-disable-next-line unicorn/prefer-code-point -- a unit, as above.
const unitAt = (text: string, at: number): number => text.charCodeAt(at);

/**
 * Where `wanted` is in `text`: at one place, at more than one, or nowhere.
 * Stops at the second. One pass over `text`, never back (Knuth, Morris and Pratt): no
 * file and no capture make it slower than their two lengths, where a
 * built-in search can compare most of a long capture at each place.
 */
const placeOf = (text: string, wanted: string): Found => {
  if (wanted === "") {
    return { at: -1, times: 0 };
  }

  // For each start of `wanted`, how long a start of it that start also ends with.
  const border = new Int32Array(wanted.length);

  for (let index = 1, length = 0; index < wanted.length; index += 1) {
    const code = unitAt(wanted, index);

    while (length > 0 && code !== unitAt(wanted, length)) {
      length = border[length - 1] ?? 0;
    }

    if (code === unitAt(wanted, length)) {
      length += 1;
    }

    border[index] = length;
  }

  let at = -1;

  for (let index = 0, matched = 0; index < text.length; index += 1) {
    const code = unitAt(text, index);

    while (matched > 0 && code !== unitAt(wanted, matched)) {
      matched = border[matched - 1] ?? 0;
    }

    if (code === unitAt(wanted, matched)) {
      matched += 1;
    }

    if (matched === wanted.length) {
      if (at !== -1) {
        return { at, times: 2 };
      }

      at = index + 1 - wanted.length;

      matched = border[matched - 1] ?? 0;
    }
  }

  return { at, times: at === -1 ? 0 : 1 };
};

/** The 1-based line the character at `index` is on: its breaks are counted, and no list of lines is built. */
const lineAt = (text: string, index: number): number => {
  let line = 1;

  for (
    let next = text.indexOf("\n");
    next !== -1 && next < index;
    next = text.indexOf("\n", next + 1)
  ) {
    line += 1;
  }

  return line;
};

/**
 * The 1-based line where `captured` begins in `text`, when it is there
 * exactly once; else null. Line endings count as one. Only the whole
 * capture counts, blanks and all: a part of it, or the capture without its
 * blanks, can be the end of another line or the other of two places, and a
 * click would then land on code that was never selected. No line is better
 * than a wrong one, since the file still opens.
 *
 * The file on disk is not the editor's buffer: a selection from unsaved
 * edits may be nowhere in it. And a capture whose own place has changed
 * since may now be found once elsewhere, where the same words stand: without
 * the editor's own cursor this can't be told apart.
 */
export const lineOfText = (text: string, captured: string): number | null => {
  const whole = oneLineBreak(captured);
  const blankStart = BLANK_START.exec(whole)?.[0].length ?? 0;

  if (whole.slice(blankStart).trim() === "") {
    return null;
  }

  const file = oneLineBreak(text);
  const found = placeOf(file, whole);

  // The line that holds the capture's first text, not a break copied before it.
  return found.times === 1 ? lineAt(file, found.at + blankStart) : null;
};

/** How a click on a code item reaches its file: opened in its editor, or shown in its folder. */
export type CodeWay = "editor" | "folder";

/**
 * What a click on a code item does. Only an item whose app has a row among
 * `editors` reaches a file at all: null for any other. A file no address
 * opens as itself is shown in its folder.
 */
export const codeWay = (
  app: string | null,
  place: CodePlace,
  editors: readonly CodeEditor[] = CODE_EDITORS
): CodeWay | null => {
  const editor = codeEditor(app, editors);

  if (editor === undefined) {
    return null;
  }

  return openAddress(editor, place, null) === null ? "folder" : "editor";
};

/** A code item's click in the words its tooltip and its menu entry use. */
export const codeAction = (app: string, way: CodeWay, mac: boolean): string => {
  if (way === "editor") {
    return `Open in ${app}`;
  }

  return mac ? "Show in Finder" : "Show in Folder";
};

/**
 * Files whose words are prose, plain text and markup written to be read,
 * which read as Markdown even from a code editor. None ends as a site's
 * domain does (.org): a Windows title's project can be named for its site.
 */
const PROSE_FILES = new Set([
  ".adoc",
  ".asciidoc",
  ".markdown",
  ".md",
  ".mdown",
  ".mdx",
  ".mkd",
  ".rst",
  ".text",
  ".textile",
  ".txt",
]);

/** A file name's extension, lower case, or "" for none (a dot file such as .env has none). */
const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf(".");

  return dot > 0 ? name.slice(dot).toLowerCase() : "";
};

/**
 * The file a code editor's title names, for telling code from prose: by the
 * row's parts, else the whole title when it holds no dash, as Code titles a
 * file opened on its own, unless what follows its last dot has a space, as a
 * workspace's label does. Null when a dash may sit inside the name of a
 * prose file: "v1.2 - Notes.md - inset-shelf" names v1.2 by the row, but may
 * name "v1.2 - Notes.md", and the title alone can't say which. Prose wins, so
 * its selection keeps what it was copied with.
 */
const titleFile = (
  editor: CodeEditor,
  title: string | null,
  app: string | null
): string | null => {
  const split = splitTitle(editor, title, app);

  if (split === null) {
    const lone = cleanTitle(title, app);

    // A file's name has no space in its extension; a label such as "release.v2 (Workspace)" does.
    return lone === null ||
      /\s/u.test(extensionOf(lone)) ||
      PROSE_FILES.has(extensionOf(lone))
      ? null
      : lone;
  }

  const prose = split.parts.some((_, index) =>
    PROSE_FILES.has(
      extensionOf(split.parts.slice(0, index + 1).join(split.dash))
    )
  );

  return prose ? null : titleParts(editor, title, app).file;
};

/**
 * The file a code capture came from, or null for a text item that is not
 * code: a selection from a file a code editor showed, that is not prose
 * (`PROSE_FILES`). The file is the code place's (macOS), else the one the
 * title names (`titleFile`) by the editor's row among `editors` (Windows),
 * where a name without an extension (Welcome, Untitled-1) is not taken for
 * a file. A selection from an editor with no file named, such as a panel, is
 * prose.
 */
const codeFile = (
  { context, via }: Pick<TextItem, "context" | "via">,
  editors: readonly CodeEditor[]
): string | null => {
  if (via !== "selection" || context === null) {
    return null;
  }

  // Read as the source line reads it (web-source.ts): a context may hold no code field at all.
  const place = context.code ?? null;

  if (place !== null) {
    const name = fileName(place);

    return PROSE_FILES.has(extensionOf(name)) ? null : name;
  }

  const editor = codeEditor(context.app, editors);

  const file =
    editor === undefined ? null : titleFile(editor, context.title, context.app);

  return file === null || extensionOf(file) === "" ? null : file;
};

/** Whether a text item is code (`codeFile`), which reads and edits with every line's whitespace kept. */
export const isCodeCapture = (
  item: Pick<TextItem, "context" | "via">,
  editors: readonly CodeEditor[] = CODE_EDITORS
): boolean => codeFile(item, editors) !== null;

/** An extension that can name a language in a class name and after a fence. */
const LANGUAGE = /^[a-z0-9]+$/u;

/**
 * The language a code capture copies as, from its file's extension: "ts"
 * for recall.ts. Null for an item that is not code, or whose file's
 * extension names no language.
 */
export const codeLanguage = (
  item: Pick<TextItem, "context" | "via">,
  editors: readonly CodeEditor[] = CODE_EDITORS
): string | null => {
  const language = extensionOf(codeFile(item, editors) ?? "").slice(1);

  return LANGUAGE.test(language) ? language : null;
};

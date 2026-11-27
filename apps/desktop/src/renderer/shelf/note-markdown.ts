import { Strike } from "@tiptap/extension-strike";
import { Markdown, MarkdownManager } from "@tiptap/markdown";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { JSONContent } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { z } from "zod";

/**
 * ~~text~~ still strikes through, but ⇧⌘S is Next steps in every Inset app,
 * so the editor leaves that chord to the menu.
 */
const StrikeWithoutKey = Strike.extend({ addKeyboardShortcuts: () => ({}) });

const MARKED_OPTIONS = { breaks: true, gfm: true };

const WEB_ADDRESS = /^(?:https?:\/\/|www\.)/iu;
const EMAIL_ADDRESS = /^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/u;

/**
 * Whether an address typed in a note links as it is typed: only those the
 * shelf links when it shows the note (GFM), so the note is stored as typed.
 * "example.com" alone stays text, or it would be stored as Markdown link syntax.
 */
export const autolinks = (address: string): boolean =>
  WEB_ADDRESS.test(address) || EMAIL_ADDRESS.test(address);

/** What a note field knows of Markdown: the nodes and marks it edits, and how it reads and writes them. */
export const NOTE_EXTENSIONS = [
  StarterKit.configure({
    dropcursor: false,
    heading: { levels: [1, 2, 3] },
    // Links open from the list, through the app, never inside the field.
    link: { autolink: true, openOnClick: false, shouldAutoLink: autolinks },
    strike: false,
    trailingNode: false,
    underline: false,
  }),
  StrikeWithoutKey,
  Markdown.configure({ markedOptions: MARKED_OPTIONS }),
];

/** Reads and writes notes as a note field does, without one. */
export const noteMarkdownManager = (): MarkdownManager =>
  new MarkdownManager({
    extensions: NOTE_EXTENSIONS,
    markedOptions: MARKED_OPTIONS,
  });

/** Characters that pair up into formatting: emphasis, strikethrough and code spans. */
const PAIRING = new Set(["*", "_", "~", "`"]);

/** The paired characters each kind of formatting is written with. */
const WRITTEN_WITH = new Map([
  ["bold", ["*", "_"]],
  ["code", ["`"]],
  ["italic", ["*", "_"]],
  ["strike", ["~"]],
]);

const WHITESPACE = /^[\t\n\f\r\p{Zs}]$/u;
const PUNCTUATION = /^[\p{P}\p{S}]$/u;
const ASCII_PUNCTUATION = /^[!-/:-@[-`{-~]$/u;
const OPENS_HTML = /^[!/?A-Za-z]$/u;

const CHARACTER_REFERENCE =
  /^&(?:#\d{1,7}|#[Xx][\dA-Fa-f]{1,6}|[A-Za-z][\dA-Za-z]{0,31});/u;

const TASK_BOX = /^\[[ Xx]\](?:\s|$)/u;

/** Formatting TipTap writes beside a text node; "" is the edge of its block and "\n" a line break. */
const MARKUP = "markup";

const isSpace = (char: string): boolean => char === "" || WHITESPACE.test(char);

const isPunctuation = (char: string): boolean => PUNCTUATION.test(char);

/**
 * Whether a run of `char` between `before` and `after` could open or close
 * formatting (CommonMark's flanking rules), with markup beside it read as
 * anything at all.
 */
const canPair = (char: string, before: string, after: string): boolean => {
  if (char === "`" || before === MARKUP || after === MARKUP) {
    return true;
  }

  const left =
    !isSpace(after) &&
    (!isPunctuation(after) || isSpace(before) || isPunctuation(before));

  const right =
    !isSpace(before) &&
    (!isPunctuation(before) || isSpace(after) || isPunctuation(after));

  return char === "_"
    ? (left && (!right || isPunctuation(before))) ||
        (right && (!left || isPunctuation(after)))
    : left || right;
};

/** A run of one paired character in a text node. */
interface Run {
  readonly char: string;
  readonly start: number;
  readonly end: number;
  readonly canPair: boolean;
  /** First on its line, where `* ` starts a list, `***` a rule and ``` a code block. */
  readonly startsBlock: boolean;
}

/** One text node's characters, what the written note holds after them, and its runs. */
interface Piece {
  readonly chars: readonly string[];
  readonly after: string;
  readonly runs: readonly Run[];
}

/** Whether a line has held only indentation once it holds `char` too. */
const stillLineStart = (lineStart: boolean, char: string): boolean =>
  char === "\n" || (lineStart && (char === " " || char === "\t"));

const piece = (text: string, before: string, after: string): Piece => {
  // Code points, as CommonMark reads them.
  const chars = Array.from(text, (char) => char);
  const runs: Run[] = [];
  // Whatever is before a text node can end a line: a block's edge, a line break, or markup TipTap drops around a formatted space.
  let lineStart = true;

  for (let start = 0; start < chars.length;) {
    const char = chars[start] ?? "";

    if (!PAIRING.has(char)) {
      lineStart = stillLineStart(lineStart, char);
      start += 1;

      continue;
    }

    let end = start + 1;

    while (chars[end] === char) {
      end += 1;
    }

    const next = chars[end] ?? after;

    runs.push({
      canPair: canPair(char, chars[start - 1] ?? before, next),
      char,
      end,
      start,
      startsBlock:
        lineStart &&
        (char === "*" || char === "_"
          ? isSpace(next) || next === MARKUP
          : end - start >= 3),
    });
    lineStart = false;
    start = end;
  }

  return { after, chars, runs };
};

/** Where a character stands in a text node as it is written. */
interface Spot {
  readonly next: string;
  /** The characters from this one on, as far as any rule below reads. */
  readonly ahead: string;
  readonly lineStart: boolean;
  readonly startsListItem: boolean;
  /** In a link's words, which a bracket of their own would end or break. */
  readonly inLink: boolean;
}

const AHEAD = 34;

/** Each character besides the paired ones that a reader can take for syntax, in TipTap's escaped form, and where it needs escaping. */
const SYNTAX = new Map<
  string,
  { readonly escaped: string; readonly needed: (spot: Spot) => boolean }
>([
  // Before punctuation it escapes that; before a line break it is one.
  [
    "\\",
    {
      escaped: "\\\\",
      needed: ({ next }) =>
        ASCII_PUNCTUATION.test(next) || next === "\n" || next === MARKUP,
    },
  ],
  // HTML, which the shelf hides and the field reads as formatting.
  ["<", { escaped: "&lt;", needed: ({ next }) => OPENS_HTML.test(next) }],
  // A character reference such as &copy;, which the shelf shows as ©.
  [
    "&",
    {
      escaped: "&amp;",
      needed: ({ ahead }) => CHARACTER_REFERENCE.test(ahead),
    },
  ],
  [">", { escaped: "&gt;", needed: ({ lineStart }) => lineStart }],
  // The end of a link's words, or of a link definition's name.
  [
    "]",
    {
      escaped: "\\]",
      needed: ({ inLink, next }) =>
        inLink ||
        next === "(" ||
        next === "[" ||
        next === ":" ||
        next === MARKUP,
    },
  ],
  [
    "[",
    {
      escaped: "\\[",
      needed: ({ ahead, inLink, startsListItem, lineStart }) =>
        inLink || (startsListItem && lineStart && TASK_BOX.test(ahead)),
    },
  ],
]);

/** Where a text node is written: first in a list item, or in a link's words. */
interface Place {
  readonly startsListItem: boolean;
  readonly inLink: boolean;
}

const NOWHERE: Place = { inLink: false, startsListItem: false };

/**
 * One text node written as Markdown: a character is escaped only where a
 * reader of the note would take it for syntax, in TipTap's own forms.
 */
const written = (
  { after, chars, runs }: Piece,
  paired: (char: string) => boolean,
  { inLink, startsListItem }: Place
): string => {
  let out = "";
  let lineStart = true;
  let run = 0;

  for (let at = 0; at < chars.length; at += 1) {
    const char = chars[at] ?? "";
    const current = runs[run];

    if (current?.start === at) {
      const text = chars.slice(at, current.end).join("");

      out +=
        current.startsBlock || (current.canPair && paired(char))
          ? text.replaceAll(char, `\\${char}`)
          : text;
      at = current.end - 1;
      run += 1;
      lineStart = false;

      continue;
    }

    const syntax = SYNTAX.get(char);

    out +=
      syntax?.needed({
        ahead: chars.slice(at, at + AHEAD).join(""),
        inLink,
        lineStart,
        next: chars[at + 1] ?? after,
        startsListItem,
      }) === true
        ? syntax.escaped
        : char;
    lineStart = stillLineStart(lineStart, char);
  }

  return out;
};

/** A web address the shelf links bare: a dotted host with no underscore, ending where GFM ends a link. */
const WEB_LINK =
  /^(?:https?:\/\/|www\.)(?:[\dA-Za-z-]+\.)+[\dA-Za-z-]+(?:[#/:?]\S*)?(?<=[\dA-Za-z/])$/u;

const EMAIL_LINK = /^[\w.+-]+@(?:[\dA-Za-z-]+\.)+[\dA-Za-z]+$/u;
const OPENS_ADDRESS = /[\s(]$/u;
const CLOSES_ADDRESS = /^[!),.:?]*\s/u;
const ENDS_ADDRESS = /^[!),.:?]*$/u;

const LinkMarkSchema = z.object({
  attrs: z.object({ href: z.string(), title: z.string().nullish() }),
  type: z.literal("link"),
});

const marksOf = (node: JSONContent | undefined): readonly JSONContent[] =>
  node?.marks ?? [];

/** Where a text node links to, when a link is all the formatting it has. */
const onlyLink = (
  node: JSONContent | undefined
): z.output<typeof LinkMarkSchema>["attrs"] | null => {
  const [only, ...others] = marksOf(node);
  const link = LinkMarkSchema.safeParse(only);

  return node?.type === "text" && others.length === 0 && link.success
    ? link.data.attrs
    : null;
};

const isLink = (mark: JSONContent): boolean => mark.type === "link";

const isPlainText = (node: JSONContent | undefined): boolean =>
  node?.type === "text" && marksOf(node).length === 0;

/** Whether the line can end right after `node`: at the block's edge or a line break. */
const endsLine = (node: JSONContent | undefined): boolean =>
  node === undefined || node.type === "hardBreak";

/** Whether a link to `href` is the address it reads, written as GFM links it bare. */
const linksItself = (text: string, href: string): boolean => {
  if (href === `mailto:${text}`) {
    return EMAIL_LINK.test(text);
  }

  return (
    href === (text.startsWith("www.") ? `http://${text}` : text) &&
    WEB_LINK.test(text)
  );
};

/** Whether a bare address can start right after `node`: GFM links one only after a space or "(". */
const opensAddress = (node: JSONContent | undefined): boolean =>
  endsLine(node) || (isPlainText(node) && OPENS_ADDRESS.test(node?.text ?? ""));

/** Whether a bare address ends before `node`, followed by `next`: at a space, or at the end of the line after closing punctuation. */
const closesAddress = (
  node: JSONContent | undefined,
  next: JSONContent | undefined
): boolean => {
  const text = node?.text ?? "";

  return (
    endsLine(node) ||
    (isPlainText(node) &&
      (CLOSES_ADDRESS.test(text) ||
        (ENDS_ADDRESS.test(text) && endsLine(next))))
  );
};

/**
 * Whether the link at `index` is an address linked to itself that the shelf
 * links again when it shows the note bare: no formatting inside it, nothing
 * beside it that would join it, and nothing in it that needs escaping.
 */
const isOwnAddress = (
  content: readonly JSONContent[],
  index: number
): boolean => {
  const node = content[index];
  const link = onlyLink(node);
  const text = node?.text ?? "";

  return (
    link !== null &&
    // Bare, it would lose its title.
    (link.title ?? null) === null &&
    linksItself(text, link.href) &&
    opensAddress(content[index - 1]) &&
    closesAddress(content[index + 1], content[index + 2]) &&
    written(piece(text, "", ""), () => true, NOWHERE) === text
  );
};

/**
 * The Markdown each explicit link of an opened note was written with, by
 * its words, where it goes and its title: `[words](address)` or
 * `<address>`, whose words are the link's only formatting.
 */
type KeptLinks = ReadonlyMap<string, string>;

const linkKey = (node: JSONContent | undefined): string | null => {
  const link = onlyLink(node);

  return link === null
    ? null
    : JSON.stringify([node?.text ?? "", link.href, link.title ?? null]);
};

/** Text written into the note as it is: a link the edit did not change, as the note was opened with it. */
const VERBATIM = new WeakSet<JSONContent>();

const verbatim = (markdown: string): JSONContent => {
  const node = { text: markdown, type: "text" };

  VERBATIM.add(node);

  return node;
};

const sameMarks = (a: JSONContent, b: JSONContent): boolean =>
  !VERBATIM.has(a) &&
  !VERBATIM.has(b) &&
  JSON.stringify(marksOf(a)) === JSON.stringify(marksOf(b));

/** Neighbouring text nodes with the same formatting as one, as the note reads. */
const joined = (content: readonly JSONContent[]): JSONContent[] => {
  const out: JSONContent[] = [];

  for (const node of content) {
    const last = out.at(-1);

    if (
      last?.type === "text" &&
      node.type === "text" &&
      sameMarks(last, node)
    ) {
      out[out.length - 1] = {
        ...last,
        text: `${last.text ?? ""}${node.text ?? ""}`,
      };
    } else {
      out.push(node);
    }
  }

  return out;
};

const isCode = (node: JSONContent): boolean =>
  marksOf(node).some((mark) => mark.type === "code");

/** What a block's text node has beside it in the written note. */
const beside = (node: JSONContent | undefined): string => {
  if (node === undefined) {
    return "";
  }

  return node.type === "hardBreak" ? "\n" : MARKUP;
};

/**
 * A block's words written as Markdown. A link the edit did not change is
 * written as it was. A paired character is escaped where it could pair with
 * another in the block, or with formatting written in it.
 */
const writtenInline = (
  content: readonly JSONContent[],
  startsListItem: boolean,
  kept: KeptLinks
): JSONContent[] => {
  const inline = joined(
    joined(content).map((node, index, nodes) => {
      const was = kept.get(linkKey(node) ?? "");

      if (was !== undefined) {
        return verbatim(was);
      }

      return isOwnAddress(nodes, index)
        ? { text: node.text, type: "text" }
        : node;
    })
  );

  const pieces = inline.map((node, index) => {
    if (node.type !== "text" || isCode(node) || VERBATIM.has(node)) {
      return null;
    }

    // A formatted node is written between its own markup.
    const edge = marksOf(node).length > 0 ? MARKUP : null;

    return piece(
      node.text ?? "",
      edge ?? beside(inline[index - 1]),
      edge ?? beside(inline[index + 1])
    );
  });

  const pairing = new Map<string, number>();

  for (const run of pieces.flatMap((each) => each?.runs ?? [])) {
    if (run.canPair) {
      pairing.set(run.char, (pairing.get(run.char) ?? 0) + 1);
    }
  }

  for (const mark of inline.flatMap(marksOf)) {
    for (const char of WRITTEN_WITH.get(mark.type ?? "") ?? []) {
      pairing.set(char, Infinity);
    }
  }

  const paired = (char: string): boolean => (pairing.get(char) ?? 0) > 1;

  return inline.map((node, index) => {
    const each = pieces[index];

    return each === null || each === undefined
      ? node
      : {
          ...node,
          text: written(each, paired, {
            inLink: marksOf(node).some(isLink),
            startsListItem,
          }),
        };
  });
};

/** `node` with every block's words written as Markdown; code blocks keep theirs. */
const withWrittenText = (
  node: JSONContent,
  kept: KeptLinks,
  startsListItem = false
): JSONContent => {
  if (node.type === "codeBlock" || node.content === undefined) {
    return node;
  }

  if (node.type === "paragraph" || node.type === "heading") {
    return {
      ...node,
      content: writtenInline(node.content, startsListItem, kept),
    };
  }

  return {
    ...node,
    content: node.content.map((child, index) =>
      withWrittenText(child, kept, node.type === "listItem" && index === 0)
    ),
  };
};

/**
 * Writes notes. TipTap escapes every *, _, `, [, ], ~ and \ in a text node
 * and writes every &, < and > as an entity, in one method it has no option
 * for. A note's words reach it already written, so they pass through as they are.
 */
const writer = noteMarkdownManager();

if (!("encodeTextForMarkdown" in writer)) {
  throw new Error(
    "TipTap no longer writes text through encodeTextForMarkdown."
  );
}

Object.assign(writer, {
  encodeTextForMarkdown: (text: string): string => text,
});

/** Written as a link and nothing else: `[words](address)` or `<address>`, not a bare address. */
const EXPLICIT_LINK = /^[<[]/u;

/** The Markdown of every explicit link in a note's Markdown, however deep. */
const linkSources = (markdown: string): ReadonlySet<string> => {
  const sources = new Set<string>();

  // Each callback returns nothing, so the walk has nothing to wait for.
  void writer.instance.walkTokens(writer.instance.lexer(markdown), (token) => {
    if (token.type === "link" && EXPLICIT_LINK.test(token.raw)) {
      sources.add(token.raw);
    }
  });

  return sources;
};

/**
 * The explicit links of a note's Markdown, each kept only when it reads back
 * on its own as one link whose words carry no other formatting.
 */
const keptLinks = (markdown: string): KeptLinks => {
  const kept = new Map<string, string>();

  for (const source of linkSources(markdown)) {
    const [block, ...blocks] = writer.parse(source).content ?? [];
    const [node, ...nodes] = joined(block?.content ?? []);
    const key = linkKey(node);

    if (
      block?.type === "paragraph" &&
      blocks.length === 0 &&
      nodes.length === 0 &&
      key !== null &&
      !kept.has(key)
    ) {
      kept.set(key, source);
    }
  }

  return kept;
};

const NO_LINKS: KeptLinks = new Map();

/**
 * The note a field holds, as the Markdown stored for it: what was typed, with
 * a character escaped only where the shelf, or the field when the note is
 * opened again, would read it as syntax, and an address linked to itself
 * written bare, as the shelf links it again. One pass over the note.
 * A hard break is written as two spaces and a newline; the shelf shows a plain
 * newline as a break anyway (remark-breaks), so notes keep plain newlines.
 */
export const noteMarkdown = (
  doc: JSONContent,
  kept: KeptLinks = NO_LINKS
): string =>
  writer.serialize(withWrittenText(doc, kept)).replaceAll("  \n", "\n");

/** A note as a field opened it: the Markdown it was given, and the document it shows for that. */
export interface OpenedNote {
  readonly markdown: string;
  readonly doc: ProseMirrorNode;
}

/** Each opened note's explicit links, read at its first change and not at every keystroke. */
const linksOpened = new WeakMap<OpenedNote, KeptLinks>();

const linksOf = (opened: OpenedNote): KeptLinks => {
  const known = linksOpened.get(opened);

  if (known !== undefined) {
    return known;
  }

  const kept = keptLinks(opened.markdown);

  linksOpened.set(opened, kept);

  return kept;
};

/**
 * The Markdown a field stores for its note, `doc` as JSON in `json`. While
 * the note is still the one the field opened, that is the Markdown it was
 * given, so a note opened and closed unchanged is stored and copied byte for
 * byte as before, however its Markdown was written. Once it has changed, each
 * explicit link the change left as it was is still written as it was.
 */
export const storedNote = (
  opened: OpenedNote,
  doc: ProseMirrorNode,
  json: JSONContent
): string =>
  doc.eq(opened.doc) ? opened.markdown : noteMarkdown(json, linksOf(opened));

import { Strike } from "@tiptap/extension-strike";
import { Markdown, MarkdownManager } from "@tiptap/markdown";
import type { JSONContent } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";

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

/** A backslash escape or an HTML entity, as TipTap writes them around plain characters. */
const ESCAPE = /\\[\\`*_[\]~]|&(?:amp|lt|gt);/gu;

const ENTITY: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&gt;": ">",
  "&lt;": "<",
};

/** A link written out, which reads the same bare when its words are its own address. */
const LINK = /\[([^\]\n]*)\]\([^)\s]*\)/gu;

/**
 * `text` with as many of `pattern`'s matches written bare as `same` allows,
 * found by halving the matches that can't all go at once.
 */
const withoutNeedless = (
  text: string,
  pattern: RegExp,
  bare: (match: RegExpExecArray) => string,
  same: (candidate: string) => boolean
): string => {
  const matches = [...text.matchAll(pattern)];
  const dropped = new Set<RegExpExecArray>();

  const write = (drop: ReadonlySet<RegExpExecArray>): string => {
    let out = "";
    let from = 0;

    for (const match of matches) {
      if (drop.has(match)) {
        out += text.slice(from, match.index) + bare(match);
        from = match.index + match[0].length;
      }
    }

    return out + text.slice(from);
  };

  const settle = (group: readonly RegExpExecArray[]): void => {
    if (group.length === 0) {
      return;
    }

    if (same(write(new Set([...dropped, ...group])))) {
      for (const match of group) {
        dropped.add(match);
      }

      return;
    }

    if (group.length > 1) {
      const half = Math.ceil(group.length / 2);

      settle(group.slice(0, half));
      settle(group.slice(half));
    }
  };

  settle(matches);

  return write(dropped);
};

/** TipTap's Markdown for `doc`, with plain newlines for hard breaks. */
const written = (markdown: MarkdownManager, doc: JSONContent): string =>
  markdown.serialize(doc).replaceAll("  \n", "\n");

/** One block's Markdown with every escape, entity and link syntax it reads the same without left out. */
const simplest = (markdown: MarkdownManager, block: string): string => {
  const meaning = JSON.stringify(markdown.parse(block));

  const same = (candidate: string): boolean =>
    JSON.stringify(markdown.parse(candidate)) === meaning;

  const unescaped = withoutNeedless(
    block,
    ESCAPE,
    ([match]) => ENTITY[match] ?? match.slice(1),
    same
  );

  return withoutNeedless(unescaped, LINK, ([, words]) => words ?? "", same);
};

/**
 * The note a field holds, as the Markdown stored for it: what was typed, with
 * only the syntax its formatting needs. TipTap escapes every *, _, [, \ and &
 * and writes a linked address as [address](address); each of those that the
 * note reads the same without is left out, so Copy gives the note as typed.
 * A hard break is written as two spaces and a newline; the shelf shows a plain
 * newline as a break anyway (remark-breaks), so notes keep plain newlines.
 * Block by block, so a long note costs little more per keystroke than a short
 * one; if the blocks read differently together, TipTap's own Markdown is kept.
 */
export const noteMarkdown = (
  markdown: MarkdownManager,
  doc: JSONContent
): string => {
  const whole = written(markdown, doc);

  const joined = (doc.content ?? [])
    .map((block) =>
      simplest(markdown, written(markdown, { content: [block], type: "doc" }))
    )
    .join("\n\n");

  return JSON.stringify(markdown.parse(joined)) ===
    JSON.stringify(markdown.parse(whole))
    ? joined
    : whole;
};

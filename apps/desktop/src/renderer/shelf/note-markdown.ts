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

/** What a note field knows of Markdown: the nodes and marks it edits, and how it reads and writes them. */
export const NOTE_EXTENSIONS = [
  StarterKit.configure({
    dropcursor: false,
    heading: { levels: [1, 2, 3] },
    // Links open from the list, through the app, never inside the field.
    link: { autolink: true, openOnClick: false },
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

/**
 * The note a field holds, as the Markdown stored for it. A hard break is
 * written as two spaces and a newline; the shelf shows a plain newline as a
 * break anyway (remark-breaks), so notes keep plain newlines.
 */
export const noteMarkdown = (
  markdown: MarkdownManager,
  doc: JSONContent
): string => markdown.serialize(doc).replaceAll("  \n", "\n");

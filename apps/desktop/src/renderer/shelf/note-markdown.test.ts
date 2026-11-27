import { getSchema } from "@tiptap/react";
import type { JSONContent } from "@tiptap/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Markdown } from "./markdown";
import {
  autolinks,
  NOTE_EXTENSIONS,
  noteMarkdown,
  noteMarkdownManager,
} from "./note-markdown";

const markdown = noteMarkdownManager();
const schema = getSchema(NOTE_EXTENSIONS);

/** The Markdown a note field stores for the note it holds. */
const stored = (doc: JSONContent): string => noteMarkdown(doc);

/** Words typed as they are. */
const plain = (text: string): JSONContent => ({ text, type: "text" });

/** Words with formatting the field shows as it is typed. */
const marked = (text: string, ...marks: readonly string[]): JSONContent => ({
  marks: marks.map((type) => ({ type })),
  text,
  type: "text",
});

/** An address the field linked as it was typed. */
const linked = (text: string, href: string): JSONContent => ({
  marks: [{ attrs: { href, title: null }, type: "link" }],
  text,
  type: "text",
});

const lineBreak: JSONContent = { type: "hardBreak" };

/** One typed line, empty for a blank one. */
const line = (...runs: readonly JSONContent[]): JSONContent =>
  runs.length === 0
    ? { type: "paragraph" }
    : { content: [...runs], type: "paragraph" };

/** A note as the field holds it, block by block. */
const note = (...blocks: readonly JSONContent[]): JSONContent => ({
  content: [...blocks],
  type: "doc",
});

/** A one-line note as the field holds it. */
const typed = (...runs: readonly JSONContent[]): JSONContent =>
  note(line(...runs));

const bulleted = (...runs: readonly JSONContent[]): JSONContent =>
  note({
    content: [{ content: [line(...runs)], type: "listItem" }],
    type: "bulletList",
  });

/** Opened for editing and closed again, as an edit in place does. */
const reopened = (text: string): string => stored(markdown.parse(text));

/** What an open card on the shelf shows for a note's Markdown. */
const shown = (text: string): string =>
  renderToStaticMarkup(
    createElement(Markdown, {
      interactive: true,
      onOpenLink: () => {},
      text,
    })
  );

/** TipTap's own Markdown for a note, every Markdown character escaped: what the shelf showed before notes were stored as typed. */
const escapedEverywhere = (doc: JSONContent): string =>
  markdown.serialize(doc).replaceAll("  \n", "\n");

/** Whether two notes hold the same words, formatting and links. */
const sameNote = (a: JSONContent, b: JSONContent): boolean =>
  schema.nodeFromJSON(a).eq(schema.nodeFromJSON(b));

/** Typed notes, each with the Markdown it is stored as. */
const TYPED: readonly { readonly doc: JSONContent; readonly text: string }[] = [
  { doc: typed(plain("use <draft> here")), text: "use &lt;draft> here" },
  { doc: typed(plain("x <b>y</b> z")), text: "x &lt;b>y&lt;/b> z" },
  {
    doc: typed(plain("type &copy; or &#123; here")),
    text: "type &amp;copy; or &amp;#123; here",
  },
  {
    doc: typed(plain("Tom & Jerry, R&D, a < b, x -> y")),
    text: "Tom & Jerry, R&D, a < b, x -> y",
  },
  {
    doc: typed(plain("a_b_c and snake_case_name")),
    text: "a_b_c and snake_case_name",
  },
  { doc: typed(plain("__init__")), text: String.raw`\_\_init\_\_` },
  { doc: typed(plain("_private and b_")), text: String.raw`\_private and b\_` },
  { doc: typed(plain("*not bold*")), text: String.raw`\*not bold\*` },
  {
    doc: typed(plain(String.raw`\*not bold\*`)),
    text: String.raw`\\\*not bold\\\*`,
  },
  { doc: typed(plain("2 * 3 = 6, *.ts")), text: "2 * 3 = 6, *.ts" },
  { doc: typed(plain("~/dev")), text: "~/dev" },
  { doc: typed(plain("~x~")), text: String.raw`\~x\~` },
  { doc: typed(plain(String.raw`C:\Users\x`)), text: String.raw`C:\Users\x` },
  { doc: typed(plain("C:\\Users\\x\\")), text: "C:\\Users\\x\\" },
  { doc: typed(plain("[x] and [x](y)")), text: String.raw`[x] and [x\](y)` },
  { doc: typed(plain("don`t, a `b` c")), text: "don\\`t, a \\`b\\` c" },
  {
    doc: typed(plain("ticket #42 | priority high")),
    text: "ticket #42 | priority high",
  },
  { doc: typed(plain("> quote")), text: "&gt; quote" },
  { doc: typed(plain("* item")), text: String.raw`\* item` },
  {
    doc: typed(plain("run "), marked("a_b*c\\ <b>", "code"), plain(" now")),
    text: "run `a_b*c\\ <b>` now",
  },
  { doc: typed(plain("a*"), marked("b", "bold")), text: String.raw`a\***b**` },
  {
    doc: typed(plain("~/dev "), marked("old", "strike")),
    text: String.raw`\~/dev ~~old~~`,
  },
  {
    doc: typed(plain("_x "), marked("y", "italic"), plain(" z_")),
    text: String.raw`\_x *y* z\_`,
  },
  {
    doc: typed(plain("x\\"), lineBreak, plain("> y")),
    text: "x\\\\\n&gt; y",
  },
  { doc: typed(plain("a"), lineBreak, plain("* item")), text: "a\n\\* item" },
  { doc: bulleted(plain("[x] task")), text: String.raw`- \[x] task` },
  {
    doc: typed(
      plain("email "),
      linked("bob@example.com", "mailto:bob@example.com"),
      plain(".")
    ),
    text: "email bob@example.com.",
  },
  {
    doc: typed(
      plain("see "),
      linked("https://example.com/a_b?x=1", "https://example.com/a_b?x=1"),
      plain(" and "),
      linked("www.example.com", "http://www.example.com"),
      plain(", then")
    ),
    text: "see https://example.com/a_b?x=1 and www.example.com, then",
  },
  {
    doc: typed(
      plain("("),
      linked("https://a.co/x", "https://a.co/x"),
      plain(") ok")
    ),
    text: "(https://a.co/x) ok",
  },
  {
    doc: typed(linked("https://a.co", "https://a.co"), plain("x and")),
    text: "[https://a.co](https://a.co)x and",
  },
  {
    doc: typed(plain("x"), linked("https://a.co", "https://a.co")),
    text: "x[https://a.co](https://a.co)",
  },
  {
    doc: typed(linked("https://a.co/_next", "https://a.co/_next")),
    text: "[https://a.co/_next](https://a.co/_next)",
  },
  {
    doc: typed(plain("see "), linked("docs", "https://example.com/docs")),
    text: "see [docs](https://example.com/docs)",
  },
  {
    doc: typed(linked("http://localhost:3000", "http://localhost:3000")),
    text: "[http://localhost:3000](http://localhost:3000)",
  },
  {
    doc: note({
      content: [line(plain("> nested and snake_case"))],
      type: "blockquote",
    }),
    text: "> &gt; nested and snake_case",
  },
  {
    doc: note({
      attrs: { level: 2 },
      content: [plain("snake_case & *.ts")],
      type: "heading",
    }),
    text: "## snake_case & *.ts",
  },
  {
    doc: note({
      attrs: { language: null },
      content: [plain("<b>*x*</b> & a_b\\")],
      type: "codeBlock",
    }),
    text: "```\n<b>*x*</b> & a_b\\\n```",
  },
];

describe(noteMarkdown, () => {
  it("stores a typed note, which Copy puts on the clipboard as it is, with the address it linked written as typed", () => {
    expect(
      stored(
        typed(
          plain("email "),
          linked("bob@example.com", "mailto:bob@example.com"),
          plain(" about ticket #42 | priority high")
        )
      )
    ).toBe("email bob@example.com about ticket #42 | priority high");
  });

  it("writes a linked web address as typed, underscores and all", () => {
    expect(
      stored(
        typed(
          plain("see "),
          linked("https://example.com/a_b?x=1", "https://example.com/a_b?x=1"),
          plain(" and "),
          linked("www.example.com", "http://www.example.com")
        )
      )
    ).toBe("see https://example.com/a_b?x=1 and www.example.com");
  });

  it.each([
    "snake_case_name",
    "Tom & Jerry",
    String.raw`C:\Users\bob`,
    "2 * 3 = 6",
    "[draft] plan",
    "ticket #42 | priority high",
  ])("stores %s as typed", (text) => {
    expect(stored(typed(plain(text)))).toBe(text);
  });

  it("stores a note of several blocks as typed, blank lines and lists included", () => {
    const email = line(
      plain("email "),
      linked("bob@example.com", "mailto:bob@example.com")
    );

    const list = {
      content: [{ content: [email], type: "listItem" }],
      type: "bulletList",
    };

    expect(
      [
        note(email, line(), line(plain("snake_case"))),
        note(list, line(plain("snake_case"))),
      ].map(stored)
    ).toStrictEqual([
      "email bob@example.com\n\n\n\nsnake_case",
      "- email bob@example.com\n\nsnake_case",
    ]);
  });

  it.each([
    "email bob@example.com about ticket #42 | priority high",
    "see https://example.com/a_b?x=1 and www.example.com",
    "snake_case_name, Tom & Jerry",
    String.raw`C:\Users\bob`,
    "**bold** and [docs](https://example.com/docs)",
    String.raw`\*not bold\*`,
    "one\ntwo",
  ])("leaves %s as it was when the note is edited and closed", (text) => {
    expect(reopened(text)).toBe(text);
  });

  it.each(TYPED)(
    "stores $text, which reads back as the same note, shows on the shelf as typed and is stored the same again",
    ({ doc, text }) => {
      const again = markdown.parse(stored(doc));

      expect({
        readsBack: sameNote(again, doc),
        shows: shown(stored(doc)),
        storedAgain: stored(again),
        text: stored(doc),
      }).toStrictEqual({
        readsBack: true,
        shows: shown(escapedEverywhere(doc)),
        storedAgain: text,
        text,
      });
    }
  );

  it("stores a long line of links within a keystroke", () => {
    const links = typed(
      ...Array.from({ length: 1000 }, (_, index) => [
        ...(index === 0 ? [] : [plain(" ")]),
        linked("x", "https://a.co"),
      ]).flat()
    );

    const start = performance.now();

    stored(links);

    expect(performance.now() - start).toBeLessThan(500);
  });
});

describe(autolinks, () => {
  it("links as typed only what the shelf links when it shows the note", () => {
    expect({
      bare: autolinks("example.com"),
      email: autolinks("bob@example.com"),
      scheme: autolinks("https://example.com"),
      www: autolinks("www.example.com"),
    }).toStrictEqual({ bare: false, email: true, scheme: true, www: true });
  });
});

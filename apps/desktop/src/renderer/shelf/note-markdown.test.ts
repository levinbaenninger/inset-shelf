import type { JSONContent } from "@tiptap/react";
import { describe, expect, it } from "vite-plus/test";

import { autolinks, noteMarkdown, noteMarkdownManager } from "./note-markdown";

const markdown = noteMarkdownManager();

/** Words typed as they are. */
const plain = (text: string): JSONContent => ({ text, type: "text" });

/** An address the field linked as it was typed. */
const linked = (text: string, href: string): JSONContent => ({
  marks: [{ attrs: { href, title: null }, type: "link" }],
  text,
  type: "text",
});

/** One typed line as the field holds it. */
const typed = (...runs: readonly JSONContent[]): JSONContent => ({
  content: [{ content: [...runs], type: "paragraph" }],
  type: "doc",
});

/** Opened for editing and closed again, as an edit in place does. */
const reopened = (stored: string): string =>
  noteMarkdown(markdown, markdown.parse(stored));

describe(noteMarkdown, () => {
  it("stores a typed note, which Copy puts on the clipboard as it is, with the address it linked written as typed", () => {
    expect(
      noteMarkdown(
        markdown,
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
      noteMarkdown(
        markdown,
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
    expect(noteMarkdown(markdown, typed(plain(text)))).toBe(text);
  });

  it("keeps the one escape a note needs to read as typed", () => {
    expect(noteMarkdown(markdown, typed(plain("*not bold*")))).toBe(
      String.raw`*not bold\*`
    );
  });

  it.each([
    "email bob@example.com about ticket #42 | priority high",
    "see https://example.com/a_b?x=1 and www.example.com",
    "snake_case_name, Tom & Jerry",
    String.raw`C:\Users\bob`,
    "**bold** and [docs](https://example.com/docs)",
    String.raw`*not bold\*`,
    "one\ntwo",
  ])("leaves %s as it was when the note is edited and closed", (stored) => {
    expect(reopened(stored)).toBe(stored);
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

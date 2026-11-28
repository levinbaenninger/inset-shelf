import type { ElementContent, Root as HtmlRoot, RootContent } from "hast";
import { toHtml } from "hast-util-to-html";
import type { List, Nodes, Root, RootContent as Block } from "mdast";
import { toHast } from "mdast-util-to-hast";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

/** How the shelf reads a note: GitHub's Markdown (lists, tasks, tables, strikethrough), with a line break wherever one was typed. */
export const NOTE_PLUGINS = [remarkGfm, remarkBreaks];

const newReader = () => unified().use(remarkParse).use(NOTE_PLUGINS);

// Made at the first note read, so a bundle that never reads one (a preload) leaves it out.
let reader: ReturnType<typeof newReader> | null = null;

/** A note's Markdown as the shelf reads it. Words the shelf shows as one code block are a tree of one `code` node. */
export const noteTree = (markdown: string): Root => {
  reader ??= newReader();

  const tree = reader.parse(markdown);

  // The plugins change the tree in place.
  reader.runSync(tree);

  return tree;
};

/** Words the shelf shows as one block of code, which is the words themselves: every space and line kept, nothing read as Markdown. */
const codeTree = (code: string, language: string | null): Root => ({
  children: [{ lang: language, type: "code", value: code }],
  type: "root",
});

/** Code as a Markdown fence that names its language, longer than any run of backticks inside it. */
export const fencedCode = (code: string, language: string | null): string => {
  let fence = "```";

  while (code.includes(fence)) {
    fence += "`";
  }

  return `${fence}${language ?? ""}\n${code.replace(/\n$/u, "")}\n${fence}`;
};

/** The words of inline content as they read. HTML, which the shelf hides, reads as nothing, as does a footnote's mark; a picture reads as its words. */
const inlineText = (node: Nodes): string => {
  if (node.type === "text" || node.type === "inlineCode") {
    return node.value;
  }

  if (node.type === "break") {
    return "\n";
  }

  if (node.type === "image" || node.type === "imageReference") {
    return node.alt ?? "";
  }

  return "children" in node ? node.children.map(inlineText).join("") : "";
};

/** The line breaks between two blocks as they were typed, one blank line at most: the shelf shows more as one gap. */
const breaksBetween = (before: Block, after: Block): string =>
  "\n".repeat(
    Math.min(
      2,
      Math.max(
        1,
        (after.position?.start.line ?? 0) - (before.position?.end.line ?? 0)
      )
    )
  );

/** A block as text, or null for one the shelf doesn't show. */
type BlockText = (block: Block) => string | null;

/** Blocks as lines of text, each `textOf` it, as far apart as they were typed. */
const blocksText = (blocks: readonly Block[], textOf: BlockText): string => {
  const shown = blocks.flatMap((block) => {
    const text = textOf(block);

    return text === null ? [] : [{ block, text }];
  });

  return shown
    .map(({ block, text }, index) => {
      const previous = shown[index - 1];

      return previous === undefined
        ? text
        : `${breaksBetween(previous.block, block)}${text}`;
    })
    .join("");
};

/** A list as lines: each item after its bullet, number or box, its further lines under its words. */
const listText = (list: List, textOf: BlockText): string =>
  blocksText(list.children, (item) => {
    if (item.type !== "listItem") {
      return textOf(item);
    }

    const index = list.children.indexOf(item);

    const marker =
      list.ordered === true ? `${(list.start ?? 1) + index}. ` : "- ";

    const box =
      item.checked === null || item.checked === undefined
        ? ""
        : `[${item.checked ? "x" : " "}] `;

    const indent = " ".repeat(marker.length);
    const [first = "", ...rest] = blocksText(item.children, textOf).split("\n");

    return [
      `${marker}${box}${first}`,
      ...rest.map((line) => (line === "" ? "" : `${indent}${line}`)),
    ].join("\n");
  });

/** A block as the shelf shows it, as text; null for one it doesn't show, such as HTML or a link definition. */
const blockText: BlockText = (block) => {
  if (block.type === "paragraph" || block.type === "heading") {
    return inlineText(block);
  }

  if (block.type === "code") {
    return block.value;
  }

  if (block.type === "blockquote") {
    return blocksText(block.children, blockText);
  }

  if (block.type === "list") {
    return listText(block, blockText);
  }

  if (block.type === "table") {
    return block.children
      .map((row) => row.children.map(inlineText).join("\t"))
      .join("\n");
  }

  return block.type === "thematicBreak" ? "---" : null;
};

const SAFE_PROTOCOL = /^(?:https?|ircs?|mailto|xmpp)$/iu;

/**
 * An address as the shelf links it: as it is when relative or of a safe
 * kind, else none, as react-markdown's defaultUrlTransform has it. Written
 * out here because importing that brings React into the main process.
 */
export const shownUrl = (url: string): string => {
  const colon = url.indexOf(":");

  const before = (char: string): boolean => {
    const at = url.indexOf(char);

    return at !== -1 && colon > at;
  };

  return colon === -1 ||
    before("/") ||
    before("?") ||
    before("#") ||
    SAFE_PROTOCOL.test(url.slice(0, colon))
    ? url
    : "";
};

/** The shelf's rendering of HTML content on its own: a link only where the shelf would follow it, a picture as its words. */
const standalone = <Content extends RootContent>(
  nodes: readonly Content[]
): (Content | ElementContent)[] =>
  nodes.map((node) => {
    if (node.type !== "element") {
      return node;
    }

    if (node.tagName === "img") {
      return { type: "text", value: node.properties.alt ?? "" };
    }

    const { href } = node.properties;

    return {
      ...node,
      children: standalone(node.children),
      properties:
        href === undefined || href === null
          ? node.properties
          : { ...node.properties, href: shownUrl(href) },
    };
  });

/** What Copy puts on the clipboard for words. */
export interface Copied {
  /** The words as the shelf shows them, line breaks kept, nothing escaped. */
  readonly text: string;
  /** The shelf's own rendering of them, as HTML that stands on its own. */
  readonly html: string;
}

/**
 * Words as Copy puts them on the clipboard, `tree` as the shelf reads them.
 * Both come from the one tree, so they never disagree; a code block is its
 * code as plain text and `<pre><code>` as HTML.
 */
export const copiedWords = (tree: Root): Copied => {
  // Raw HTML is left out, as the shelf's skipHtml leaves it out.
  const rendered = toHast(tree);

  const html: HtmlRoot = {
    children: standalone(rendered.type === "root" ? rendered.children : []),
    type: "root",
  };

  return {
    html: toHtml(html, { characterReferences: { useNamedReferences: true } }),
    text: blocksText(tree.children, blockText),
  };
};

/**
 * Code as Copy puts it on the clipboard: the code itself as plain text, so
 * it runs where it is pasted, and one `<pre><code class="language-ts">`
 * block as HTML, so an app that pastes formatting shows it as code.
 */
export const copiedCode = (code: string, language: string | null): Copied => ({
  // The block ends its last line itself: a line break the code ends with would be a blank line.
  html: copiedWords(codeTree(code.replace(/\n$/u, ""), language)).html,
  text: code,
});

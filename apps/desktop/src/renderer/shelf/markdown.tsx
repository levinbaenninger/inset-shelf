import { cn } from "@inset/ui/lib/utils";
import { NOTE_PLUGINS } from "@shared/shown-note";
import { createContext, use, useMemo } from "react";
import type { ComponentProps, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";

import { tooltipText } from "@/shared/clamp";

interface MarkdownMode {
  /** An open card: real blocks and links. A closed one: spans only, inside the card's select button. */
  readonly interactive: boolean;
  readonly onOpenLink: (url: string) => void;
}

const ignore = (): void => undefined;

const Mode = createContext<MarkdownMode>({
  interactive: false,
  onOpenLink: ignore,
});

interface Children {
  readonly children?: ReactNode;
}

/** A block in an open card, a span shown as a block in a closed one. */
const Block = ({
  children,
  className,
}: Children & { readonly className?: string }) => {
  const { interactive } = use(Mode);
  const Tag = interactive ? "div" : "span";

  return <Tag className={cn("block", className)}>{children}</Tag>;
};

const Link = ({ children, href }: Children & { readonly href?: string }) => {
  const { interactive, onOpenLink } = use(Mode);

  if (!interactive || href === undefined) {
    return <span className="underline underline-offset-2">{children}</span>;
  }

  return (
    <a
      className="text-pin underline underline-offset-2"
      href={href}
      onClick={(event) => {
        event.preventDefault();
        onOpenLink(href);
      }}
      title={tooltipText(href)}
    >
      {children}
    </a>
  );
};

const Paragraph = ({ children }: Children) => <Block>{children}</Block>;

const Heading = ({ children }: Children) => (
  <Block className="font-semibold">{children}</Block>
);

const Quote = ({ children }: Children) => (
  <Block className="border-foreground/20 text-muted-foreground border-l-2 pl-2">
    {children}
  </Block>
);

const Code = ({ children }: Children) => (
  <code className="bg-foreground/10 rounded-sm px-1 font-mono text-xs">
    {children}
  </code>
);

/**
 * An open card wraps a long code line, so reading it takes no sideways scroll.
 * A closed one keeps its lines and clips them, so a two-line clamp counts
 * lines of code and not lines of wrapping.
 */
const CodeBlock = ({ children }: Children) => {
  const { interactive } = use(Mode);

  return (
    <Block
      className={cn(
        "bg-foreground/5 rounded-md px-2 font-mono text-xs [&_code]:bg-transparent [&_code]:p-0",
        // Padding under a clamped block would show a sliver of the line after the cut.
        interactive
          ? "py-1.5 wrap-anywhere whitespace-pre-wrap"
          : "whitespace-pre"
      )}
    >
      {children}
    </Block>
  );
};

const List = ({ children }: Children) => (
  <Block className="list-disc pl-5">{children}</Block>
);

const NumberedList = ({ children }: Children) => (
  <Block className="list-decimal pl-5">{children}</Block>
);

const ListItem = ({ children }: Children) => (
  <Block className="list-item">{children}</Block>
);

const Rule = () => <Block className="border-foreground/15 my-1 border-t" />;

/**
 * A table keeps its columns and scrolls sideways in an open card. A closed one
 * clips it instead: a scroller starts its own layout, which a two-line clamp
 * cannot see into.
 */
const Table = ({ children }: Children) => (
  <Block className={cn(use(Mode).interactive && "overflow-x-auto")}>
    {children}
  </Block>
);

/** Pictures from the web are not fetched; their words stand in. */
const Picture = ({ alt }: { readonly alt?: string }) => <span>{alt}</span>;

/** The blocks in a card, small and tight like the rest of the shelf. Raw HTML is never rendered. */
const COMPONENTS: Components = {
  a: Link,
  blockquote: Quote,
  code: Code,
  h1: Heading,
  h2: Heading,
  h3: Heading,
  h4: Heading,
  h5: Heading,
  h6: Heading,
  hr: Rule,
  img: Picture,
  li: ListItem,
  ol: NumberedList,
  p: Paragraph,
  pre: CodeBlock,
  table: Table,
  ul: List,
};

/** A text item's words as Markdown. */
export const Markdown = ({
  className,
  interactive,
  onOpenLink,
  text,
}: MarkdownMode & { readonly text: string } & Pick<
    ComponentProps<"div">,
    "className"
  >) => {
  const Root = interactive ? "div" : "span";

  const mode = useMemo(
    () => ({ interactive, onOpenLink }),
    [interactive, onOpenLink]
  );

  return (
    <Mode value={mode}>
      <Root
        className={cn(
          "block space-y-1.5",
          // Closed, a table reads as lines of text, so a clamp can count them.
          !interactive &&
            "[&_:is(td,th)]:inline [&_:is(td,th)]:pr-3 [&_:is(thead,tbody,tr)]:block",
          className
        )}
      >
        <ReactMarkdown
          components={COMPONENTS}
          remarkPlugins={NOTE_PLUGINS}
          skipHtml
        >
          {text}
        </ReactMarkdown>
      </Root>
    </Mode>
  );
};

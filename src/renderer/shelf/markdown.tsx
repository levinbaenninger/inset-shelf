import { createContext, use, useMemo } from "react";
import type { ComponentProps, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

/** GitHub's Markdown (lists, tasks, tables, strikethrough), with a line break wherever one was typed. */
const PLUGINS = [remarkGfm, remarkBreaks];

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
      title={href}
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

const CodeBlock = ({ children }: Children) => (
  <Block className="bg-foreground/5 overflow-x-auto rounded-md px-2 py-1.5 font-mono text-xs whitespace-pre [&_code]:bg-transparent [&_code]:p-0">
    {children}
  </Block>
);

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

const Table = ({ children }: Children) => (
  <Block className="overflow-x-auto">{children}</Block>
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
      <Root className={cn("block space-y-1.5", className)}>
        <ReactMarkdown components={COMPONENTS} remarkPlugins={PLUGINS} skipHtml>
          {text}
        </ReactMarkdown>
      </Root>
    </Mode>
  );
};

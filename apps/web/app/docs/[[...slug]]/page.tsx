import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/layouts/docs/page";
import defaultMdxComponents, { createRelativeLink } from "fumadocs-ui/mdx";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { source } from "@/lib/source";

interface Props {
  params: Promise<{ slug?: string[] }>;
}

const Page = async ({ params }: Props) => {
  const { slug } = await params;
  const page = source.getPage(slug);

  if (page === undefined) {
    notFound();
  }

  const Body = page.data.body;

  return (
    <DocsPage toc={page.data.toc}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <Body
          components={{
            ...defaultMdxComponents,
            a: createRelativeLink(source, page),
          }}
        />
      </DocsBody>
    </DocsPage>
  );
};

export const generateStaticParams = () => source.generateParams();

export const generateMetadata = async ({
  params,
}: Props): Promise<Metadata> => {
  const { slug } = await params;
  const page = source.getPage(slug);

  if (page === undefined) {
    notFound();
  }

  return {
    title: `${page.data.title} · Inset Shelf docs`,
    description: page.data.description,
  };
};

export default Page;

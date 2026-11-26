import type { ReactNode } from "react";

import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

// A page of plain text under the site’s header: the imprint and the privacy notice.
export const LegalPage = ({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) => (
  <>
    <SiteHeader />
    <main id="main" className="rails gutter pt-36 pb-12 md:pt-44">
      <article className="[&_a]:text-brand mx-auto max-w-[680px] text-[16px] leading-7 text-neutral-700 [&_a]:underline [&_a]:decoration-current/30 [&_a]:underline-offset-[3px] [&_a:hover]:decoration-current [&_h2]:mt-12 [&_h2]:text-[22px] [&_h2]:leading-snug [&_h2]:font-medium [&_h2]:tracking-[-0.02em] [&_h2]:text-neutral-950 [&_li]:mt-2 [&_p]:mt-4 [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:pl-5">
        <h1 className="text-title text-neutral-950">{title}</h1>
        <p className="text-muted-foreground text-[15px]">
          Last updated {updated}
        </p>
        {children}
      </article>
    </main>
    <SiteFooter />
  </>
);

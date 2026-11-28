import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";

import { DocsActions } from "@/components/docs/actions";
import { DocsProvider } from "@/components/docs/provider";
import { ShelfMark } from "@/components/logo";
import { source } from "@/lib/source";

const Layout = ({ children }: { children: ReactNode }) => (
  <DocsProvider>
    <DocsLayout
      tree={source.getPageTree()}
      nav={{
        title: (
          <>
            <ShelfMark className="size-[22px]" />
            <span className="text-[15px] font-semibold tracking-[-0.02em]">
              Inset Shelf
            </span>
          </>
        ),
        url: "/",
      }}
      sidebar={{ footer: <DocsActions /> }}
      themeSwitch={{ enabled: false }}
    >
      {children}
    </DocsLayout>
  </DocsProvider>
);

export default Layout;

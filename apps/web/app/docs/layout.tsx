import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";

import { DocsProvider } from "@/components/docs/provider";
import { ShelfMark } from "@/components/logo";
import { DOWNLOADS, REPO_URL } from "@/lib/site";
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
      githubUrl={REPO_URL}
      links={[
        { text: "Home", url: "/" },
        { text: "Download for macOS", url: DOWNLOADS.mac },
        { text: "Download for Windows", url: DOWNLOADS.windows },
      ]}
      themeSwitch={{ enabled: false }}
    >
      {children}
    </DocsLayout>
  </DocsProvider>
);

export default Layout;

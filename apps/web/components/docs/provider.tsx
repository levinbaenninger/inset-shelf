"use client";

import { RootProvider } from "fumadocs-ui/provider/next";
import type { ReactNode } from "react";

import { StaticSearchDialog } from "./search-dialog";

// The page is light only, so the docs skip next-themes and its toggle.
export const DocsProvider = ({ children }: { children: ReactNode }) => (
  <RootProvider
    theme={{ enabled: false }}
    search={{ SearchDialog: StaticSearchDialog }}
  >
    {children}
  </RootProvider>
);

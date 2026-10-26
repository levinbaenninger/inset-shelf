import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { isMac } from "./platform";

/**
 * The header of Inset's titled windows, Settings and the drawing window, so
 * both look alike: 48 points tall (WINDOW_HEADER_DIP) with a rule below. It
 * moves the window and holds the window's own buttons: the traffic lights at
 * its left on macOS, the caption buttons at its right on Windows.
 */
export const WindowHeader = ({
  children,
}: {
  readonly children: ReactNode;
}) => (
  <header
    className={cn(
      "drag-region caption-clear relative flex h-12 shrink-0 items-center gap-1.5 border-b",
      isMac ? "pl-20" : "pl-4"
    )}
  >
    {children}
  </header>
);

/** The window's name: centred like a Mac window's, at the left as a Windows title is. */
export const WindowTitle = ({ children }: { readonly children: ReactNode }) => (
  <h1
    className={cn(
      "pointer-events-none text-sm font-medium",
      isMac ? "absolute inset-x-0 text-center" : "mr-auto min-w-0 truncate"
    )}
  >
    {children}
  </h1>
);

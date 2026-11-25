"use client";

import { GithubIcon, Menu01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@inset/ui/components/button";
import { cn } from "@inset/ui/lib/utils";
import { useEffect, useState } from "react";

import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { DOWNLOADS, NAV_LINKS, REPO_URL } from "@/lib/site";
import { useBrowserValue } from "@/lib/use-browser-value";

import { DownloadButtons } from "./download-buttons";
import { Logo } from "./logo";

const useScrolled = () => {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => {
      setScrolled(window.scrollY > 8);
    };

    update();
    window.addEventListener("scroll", update, { passive: true });

    return () => {
      window.removeEventListener("scroll", update);
    };
  }, []);

  return scrolled;
};

// The header's one button fetches the build for the visitor's system: Windows when the browser says so, else the Mac.
const useDownloadUrl = () =>
  useBrowserValue(
    () =>
      /Win/u.test(navigator.userAgent) ? DOWNLOADS.windows : DOWNLOADS.mac,
    DOWNLOADS.mac
  );

const LINK =
  "text-foreground/75 hover:text-foreground rounded-md px-3 py-1.5 text-sm font-medium transition-colors hover:bg-black/5";

// Over the hero it sits inside the sky frame's rounded top, clear of its corners; once the page moves it becomes a
// white bar with a hairline at the top of the window.
export const SiteHeader = () => {
  const scrolled = useScrolled();
  const download = useDownloadUrl();

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-30 border-b transition-[background-color,border-color,padding] duration-200",
        scrolled
          ? "border-border bg-white/85 backdrop-blur-md"
          : "border-transparent pt-3 sm:pt-4"
      )}
    >
      <a
        href="#main"
        className="sr-only rounded-md bg-white px-3 py-2 text-sm font-medium focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-40 focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <div
        className={cn(
          "rails relative flex items-center gap-1 px-7 transition-[height] duration-200 sm:px-10 xl:px-6",
          scrolled ? "h-16" : "h-[72px] sm:h-20"
        )}
      >
        <Logo />

        <nav
          aria-label="Main"
          className="absolute left-1/2 hidden -translate-x-1/2 lg:block"
        >
          <ul className="flex gap-1">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a href={link.href} className={LINK}>
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <a
          href={REPO_URL}
          aria-label="Inset Shelf on GitHub"
          title="Inset Shelf on GitHub"
          className="text-foreground/75 hover:text-foreground ml-auto hidden size-9 items-center justify-center rounded-md transition-colors hover:bg-black/5 sm:flex"
        >
          <HugeiconsIcon
            icon={GithubIcon}
            size={20}
            strokeWidth={1.8}
            aria-hidden="true"
          />
        </a>
        <Button
          asChild
          className="ml-2 hidden h-9 rounded-[9px] px-4 sm:inline-flex"
        >
          <a href={download}>Download</a>
        </Button>

        <Sheet>
          <SheetTrigger asChild>
            <Button
              variant="light"
              size="icon"
              className="ml-auto size-10 rounded-[10px] sm:ml-2 lg:hidden"
              aria-label="Open menu"
            >
              <HugeiconsIcon icon={Menu01Icon} className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-full gap-0 sm:max-w-sm">
            <SheetTitle className="flex h-16 items-center px-7">
              <Logo />
            </SheetTitle>
            <nav aria-label="Menu" className="grid gap-8 px-7 pt-4">
              <ul className="grid">
                {[...NAV_LINKS, { href: REPO_URL, label: "GitHub" }].map(
                  (link) => (
                    <li key={link.href}>
                      <SheetClose asChild>
                        <a
                          href={link.href}
                          className="flex h-14 items-center border-b text-lg font-medium tracking-[-0.02em]"
                        >
                          {link.label}
                        </a>
                      </SheetClose>
                    </li>
                  )
                )}
              </ul>
              <DownloadButtons />
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
};

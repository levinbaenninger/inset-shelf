"use client";

import { Menu01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/components/ui/button";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { NAV_LINKS } from "@/lib/site";

import { DownloadButton } from "./cta";
import { Logo } from "./logo";

const CAPTURE_MENU = [
  { href: "#capture", label: "Selected text", line: "Tap Shift twice in any app" },
  { href: "#capture", label: "Screenshots", line: "A card beside the shelf" },
  { href: "#capture", label: "Window links", line: "Reopen a set of windows" },
  { href: "#sources", label: "Sources", line: "Open the page it came from" },
];

// The fixed bar. From 1024px the words sit in the bar and Capture opens a menu; below that a button opens a sheet.
export function SiteHeader() {
  return (
    <header className="fixed inset-x-0 top-0 z-20 h-14 border-b bg-background sm:h-[72px]">
      <div className="wrap flex h-full items-center gap-3 lg:gap-10">
        <a
          href="#top"
          className="sr-only rounded-lg bg-background px-3 py-2 focus:not-sr-only focus:absolute focus:z-30"
        >
          Skip to content
        </a>
        <Logo className="shrink-0" />

        <NavigationMenu className="hidden lg:flex">
          <NavigationMenuList>
            <NavigationMenuItem>
              <NavigationMenuTrigger className="text-[15px]">Capture</NavigationMenuTrigger>
              <NavigationMenuContent>
                <div className="grid w-[560px] grid-cols-[1fr_220px] gap-6 p-2">
                  <ul className="grid gap-1">
                    {CAPTURE_MENU.map((item) => (
                      <li key={item.label}>
                        <NavigationMenuLink asChild>
                          <a href={item.href} className="grid gap-0.5">
                            <span className="font-medium">{item.label}</span>
                            <span className="text-muted-foreground">{item.line}</span>
                          </a>
                        </NavigationMenuLink>
                      </li>
                    ))}
                  </ul>
                  <NavigationMenuLink asChild>
                    <a href="#capture" className="group/card grid content-start gap-2">
                      <span className="block aspect-video overflow-hidden rounded-lg bg-sky">
                        <img
                          src="/img/menu-windows.webp"
                          alt="The window picker with two windows picked"
                          width={560}
                          height={316}
                          loading="lazy"
                          className="size-full object-cover transition-transform duration-300 group-hover/card:scale-[1.03]"
                        />
                      </span>
                      <span className="font-medium">Window links</span>
                      <span className="text-muted-foreground">Pick windows, reopen them later</span>
                    </a>
                  </NavigationMenuLink>
                </div>
              </NavigationMenuContent>
            </NavigationMenuItem>
            {NAV_LINKS.filter((link) => link.label !== "Capture").map((link) => (
              <NavigationMenuItem key={link.href}>
                <NavigationMenuLink asChild>
                  <a href={link.href} className="text-[15px] font-medium">
                    {link.label}
                  </a>
                </NavigationMenuLink>
              </NavigationMenuItem>
            ))}
          </NavigationMenuList>
        </NavigationMenu>

        <DownloadButton className="ml-auto hidden px-5 text-[15px] sm:inline-flex" />

        <Sheet>
          <SheetTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="ml-auto size-11 sm:ml-0 lg:hidden"
              aria-label="Menu"
            >
              <HugeiconsIcon icon={Menu01Icon} />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-full sm:max-w-sm">
            <SheetTitle className="sr-only">Menu</SheetTitle>
            <nav aria-label="Menu" className="grid px-6 pt-16">
              {NAV_LINKS.map((link) => (
                <SheetClose asChild key={link.href}>
                  <a
                    href={link.href}
                    className="flex h-14 items-center border-b text-lg font-medium"
                  >
                    {link.label}
                  </a>
                </SheetClose>
              ))}
              <SheetClose asChild>
                <DownloadButton className="mt-6 h-12 w-full sm:hidden" />
              </SheetClose>
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}

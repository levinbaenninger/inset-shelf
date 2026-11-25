import { Button } from "@/components/ui/button";
import { SOURCE } from "@/lib/site";

import { DownloadButton } from "./cta";
import { DeskMock } from "./desk-mock";

// The dealt hero, centred: the claim over one window that fills the rest of the first screen.
export function Hero() {
  return (
    <section
      className="relative flex min-h-svh flex-col pt-24 pb-6 sm:h-svh sm:pt-[120px] sm:pb-16"
      aria-labelledby="hero-h"
    >
      <div className="wrap flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mx-auto flex w-full max-w-[880px] flex-col items-center gap-4 text-center">
            <p className="text-sm text-muted-foreground">
              Free test build for macOS and Windows 11
            </p>
            <h1 id="hero-h" className="max-w-[16ch] text-h1 font-medium">
              A capture shelf beside your work
            </h1>
            <p className="max-w-[52ch] text-lead">
              Tap Shift twice on selected text, or take a screenshot. Inset Shelf keeps it beside your
              work with the page it came from.
            </p>
            <div className="mt-2 flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row">
              <DownloadButton arrow />
              <Button asChild variant="outline" size="cta">
                <a href={SOURCE.href}>{SOURCE.label}</a>
              </Button>
            </div>
          </div>
          <div
            role="img"
            aria-label="A GitHub issue in the browser with a sentence selected, and the shelf docked beside it holding that sentence with GitHub as its source"
            className="relative mt-8 min-h-[240px] flex-1 overflow-hidden rounded-[20px] bg-sky [mask-image:linear-gradient(to_bottom,#000_calc(100%-28px),transparent)] sm:[mask-image:linear-gradient(to_bottom,#000_82%,transparent)]"
          >
            <div className="absolute top-4 left-4 w-[calc(100%-32px)] sm:top-6 sm:left-1/2 sm:w-[min(880px,calc(100%-48px))] sm:-translate-x-1/2">
              <DeskMock />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

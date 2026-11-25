import { Button } from "@inset/ui/components/button";
import { cn } from "@inset/ui/lib/utils";

import { DOWNLOADS, FIRST_OPEN, RELEASES_URL } from "@/lib/site";

import { AppleGlyph, WindowsGlyph } from "./glyphs";

const SMALL_LINK =
  "text-foreground/75 hover:text-foreground underline decoration-foreground/25 underline-offset-[3px] transition-colors hover:decoration-foreground/60";

// The page's one action, the same in the hero, the menu and the close: each button fetches its installer directly.
export const DownloadButtons = ({ className }: { className?: string }) => (
  <div className={cn("flex flex-col items-center gap-4", className)}>
    <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
      <div className="flex flex-col gap-2.5">
        <Button asChild size="cta">
          <a href={DOWNLOADS.mac}>
            <AppleGlyph className="-mt-0.5 size-[17px]" />
            Download for macOS
          </a>
        </Button>
        {/* Stacked on a phone, the Intel build sits right under the Mac button. */}
        <a
          href={DOWNLOADS.macIntel}
          className={cn(SMALL_LINK, "self-center text-[13px] sm:hidden")}
        >
          Intel Mac?
        </a>
      </div>
      <Button asChild size="cta" variant="light">
        <a href={DOWNLOADS.windows}>
          <WindowsGlyph className="size-[14px]" />
          Download for Windows
        </a>
      </Button>
    </div>
    <p className="text-foreground/60 max-w-[44ch] text-center text-[13px] leading-5 md:max-w-none">
      <span className="max-sm:hidden">
        <a href={DOWNLOADS.macIntel} className={SMALL_LINK}>
          Intel Mac?
        </a>
        <span aria-hidden="true" className="mx-2">
          ·
        </span>
      </span>
      <a href={RELEASES_URL} className={SMALL_LINK}>
        All releases
      </a>
      <span className="mt-1 block">{FIRST_OPEN}</span>
    </p>
  </div>
);

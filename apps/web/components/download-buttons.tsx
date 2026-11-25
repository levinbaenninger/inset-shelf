import { Button } from "@inset/ui/components/button";
import { FIRST_OPEN, RELEASE_URL } from "@/lib/site";
import { cn } from "@inset/ui/lib/utils";

import { AppleGlyph, WindowsGlyph } from "./glyphs";

// The page's one action, the same in the hero and the close: both builds sit on the preview release.
export function DownloadButtons({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-4", className)}>
      <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
        <Button asChild size="cta">
          <a href={RELEASE_URL}>
            <AppleGlyph className="-mt-0.5 size-[17px]" />
            Download for macOS
          </a>
        </Button>
        <Button asChild size="cta" variant="light">
          <a href={RELEASE_URL}>
            <WindowsGlyph className="size-[14px]" />
            Download for Windows
          </a>
        </Button>
      </div>
      <p className="max-w-[44ch] text-center text-[13px] md:max-w-none leading-5 text-foreground/60">
        {FIRST_OPEN}
      </p>
    </div>
  );
}

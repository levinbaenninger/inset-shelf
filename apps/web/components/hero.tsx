import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { RELEASES_URL } from "@/lib/site";

import { DownloadButtons } from "./download-buttons";
import { HeroScene } from "./hero-scene";
import { SkyFrame } from "./sky-frame";

const SCENE_LABEL =
  "A GitHub issue in the browser with one sentence selected. The shelf is open over the browser's right edge with that sentence saved at the top, its source line reading GitHub, inset/shelf #482. Beside the shelf, a new screenshot card offers Copy and Add to Shelf.";

export const Hero = () => (
  <section aria-labelledby="hero-h" className="px-3 pt-3 sm:px-4 sm:pt-4">
    <SkyFrame>
      <div className="flex flex-col items-center px-5 pt-28 text-center sm:pt-32 lg:pt-36">
        <a
          href={RELEASES_URL}
          className="group text-foreground/80 hover:text-foreground inline-flex h-7 items-center gap-1 rounded-full bg-white/55 px-3 text-[13px] font-medium ring-1 ring-black/8 backdrop-blur-sm transition-colors hover:bg-white/80"
        >
          Free test build for macOS and Windows
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            size={14}
            className="transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </a>
        <h1 id="hero-h" className="text-display mt-6 max-w-[15ch] text-balance">
          Keep what you find, right where you work.
        </h1>
        <p className="text-lead text-foreground/70 mt-5 max-w-[44ch]">
          Tap Shift twice on selected text, and Inset Shelf keeps it in a small
          side window, with the page it came from.
        </p>
        <DownloadButtons className="mt-8" />
      </div>
      <div
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a drawn scene of live elements, not an image file.
        role="img"
        aria-label={SCENE_LABEL}
        className="mt-12 flex h-[524px] justify-end overflow-hidden pr-3 sm:mt-14 sm:h-[499px] sm:pr-6 lg:h-[537px] lg:justify-center lg:pr-0 xl:h-[624px]"
      >
        <HeroScene />
      </div>
    </SkyFrame>
  </section>
);

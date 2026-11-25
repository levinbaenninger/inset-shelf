import { DownloadButtons } from "./download-buttons";
import { SkyFrame } from "./sky-frame";

export function Closing() {
  return (
    <section aria-labelledby="closing-h" className="px-3 sm:px-4">
      <SkyFrame className="flex flex-col items-center px-5 py-24 text-center md:py-32">
        <h2 id="closing-h" className="max-w-[16ch] text-title">
          Try Inset Shelf beside your work.
        </h2>
        <p className="mt-5 max-w-[42ch] text-lead text-foreground/70">
          Free while it is tested. The Mac builds and the Windows installer update themselves.
        </p>
        <DownloadButtons className="mt-8" />
      </SkyFrame>
    </section>
  );
}

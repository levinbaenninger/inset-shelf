import { DownloadButtons } from "./download-buttons";
import { SkyFrame } from "./sky-frame";

export const Closing = () => (
  <section id="download" aria-labelledby="closing-h" className="px-3 sm:px-4">
    <SkyFrame className="flex flex-col items-center px-5 py-24 text-center md:py-32">
      <h2 id="closing-h" className="text-title max-w-[16ch]">
        Try Inset Shelf beside your work.
      </h2>
      <p className="text-lead text-foreground/70 mt-5 max-w-[42ch]">
        Free while it is tested. The Mac builds and the Windows installer update
        themselves.
      </p>
      <DownloadButtons className="mt-8" />
    </SkyFrame>
  </section>
);

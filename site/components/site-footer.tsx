import { SOURCE } from "@/lib/site";

import { DownloadButton } from "./cta";
import { Logo } from "./logo";

const COLUMNS = [
  { title: "Why", links: [{ href: "#why", label: "Why it exists" }] },
  { title: "Capture", links: [{ href: "#capture", label: "Three ways in" }] },
  {
    title: "Keep",
    links: [
      { href: "#sources", label: "Sources" },
      { href: "#details", label: "Details" },
    ],
  },
  {
    title: "Questions",
    links: [
      { href: "#questions", label: "Test build" },
      { href: SOURCE.href, label: SOURCE.label },
    ],
  },
];

// The close and the footer as the page's last screen, on the neutral surface.
export function SiteFooter() {
  return (
    <footer
      id="contact"
      aria-labelledby="close-h"
      className="closing flex min-h-lvh flex-col bg-muted pt-24 pb-12 sm:h-svh sm:min-h-0 sm:pt-[120px] sm:pb-[72px]"
    >
      <div className="wrap flex flex-1 flex-col justify-between gap-24">
        <div className="grid gap-6 sm:gap-10">
          <div className="grid gap-4">
            <h2 id="close-h" className="text-h2 font-medium">
              Try Inset on your Mac
            </h2>
            <p className="max-w-[62ch] text-muted-foreground">
              Free and unsigned: on the first open, click Open Anyway in System Settings &gt;
              Privacy &amp; Security.
            </p>
          </div>
          <DownloadButton size="cta-xl" arrow />
        </div>
        <div className="grid gap-10">
          <div className="grid grid-cols-12 gap-x-6 gap-y-10">
            <div className="col-span-12 flex flex-col items-start gap-4 lg:col-span-4">
              <Logo lazy />
              <p className="text-lg font-medium">
                A side window for what you mean to come back to.
              </p>
            </div>
            {COLUMNS.map((column) => (
              <div
                key={column.title}
                className="col-span-6 grid content-start gap-3 sm:col-span-3 lg:col-span-2"
              >
                <h3 className="text-label font-medium text-muted-foreground">{column.title}</h3>
                <ul className="grid gap-2">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      <a href={link.href} className="link-draw text-sm">
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="flex flex-col justify-between gap-2 border-t pt-6 text-label text-muted-foreground sm:flex-row">
            <span>© 2026 Inset, a school innovation project</span>
            <span>Product names and logos are trademarks of their owners</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

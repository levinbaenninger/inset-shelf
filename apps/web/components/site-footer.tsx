import { NAV_LINKS, RELEASE_URL, REPO_URL } from "@/lib/site";

import { Logo } from "./logo";

const COLUMNS = [
  { title: "Product", links: NAV_LINKS },
  {
    title: "Download",
    links: [
      { href: RELEASE_URL, label: "macOS" },
      { href: RELEASE_URL, label: "Windows 11" },
      { href: `${REPO_URL}/releases`, label: "All releases" },
    ],
  },
  {
    title: "Project",
    links: [
      { href: REPO_URL, label: "Source on GitHub" },
      {
        href: `${REPO_URL}/blob/main/IMPLEMENTATION_REPORT.md`,
        label: "Implementation report",
      },
      {
        href: "https://github.com/levinbaenninger/inset-pin",
        label: "Inset Context Pin",
      },
    ],
  },
];

export const SiteFooter = () => (
  <footer className="rails gutter pt-20 pb-10 md:pt-24">
    <div className="grid gap-12 md:grid-cols-[1fr_auto] md:gap-8">
      <div className="flex max-w-[34ch] flex-col items-start gap-4">
        <Logo />
        <p className="text-muted-foreground text-[15px]">
          A side window for what you mean to come back to, beside the window you
          work in.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-3 md:gap-x-20">
        {COLUMNS.map((column) => (
          <div key={column.title}>
            <h2 className="text-sm font-medium">{column.title}</h2>
            <ul className="mt-4 grid gap-3">
              {column.links.map((link) => (
                <li key={link.label}>
                  <a
                    href={link.href}
                    className="text-muted-foreground hover:text-foreground text-sm transition-colors"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
    <div className="text-muted-foreground mt-16 flex flex-col gap-2 border-t pt-6 text-[13px] sm:flex-row sm:justify-between">
      <p>© 2026 Inset Shelf</p>
      <p>Product names and logos are trademarks of their owners</p>
    </div>
  </footer>
);

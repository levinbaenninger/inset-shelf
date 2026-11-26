"use client";

import { Download01Icon, GithubIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { DropdownMenu } from "radix-ui";

import { DOWNLOADS, REPO_URL } from "@/lib/site";

const DOWNLOAD_CHOICES = [
  { label: "Apple silicon", url: DOWNLOADS.mac },
  { label: "Intel Mac", url: DOWNLOADS.macIntel },
  { label: "Windows", url: DOWNLOADS.windows },
];

const ICON_BUTTON =
  "inline-flex size-8 items-center justify-center rounded-md transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground";

export const DocsActions = () => (
  <div className="bg-fd-secondary/50 text-fd-muted-foreground flex w-fit items-center gap-0.5 self-start rounded-lg border p-0.5">
    <a
      href={REPO_URL}
      aria-label="Inset Shelf on GitHub"
      title="Inset Shelf on GitHub"
      className={ICON_BUTTON}
    >
      <HugeiconsIcon icon={GithubIcon} size={18} aria-hidden="true" />
    </a>
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Download Inset Shelf"
          title="Download Inset Shelf"
          className={ICON_BUTTON}
        >
          <HugeiconsIcon icon={Download01Icon} size={18} aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="start"
          sideOffset={8}
          className="bg-fd-popover text-fd-popover-foreground z-50 min-w-44 rounded-lg border p-1 text-sm shadow-lg"
        >
          <DropdownMenu.Label className="text-fd-muted-foreground px-2 py-1.5 text-xs font-medium">
            Download Inset Shelf
          </DropdownMenu.Label>
          {DOWNLOAD_CHOICES.map(({ label, url }) => (
            <DropdownMenu.Item key={url} asChild>
              <a
                href={url}
                className="data-highlighted:bg-fd-accent data-highlighted:text-fd-accent-foreground block rounded-md px-2 py-2 outline-none"
              >
                {label}
              </a>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  </div>
);

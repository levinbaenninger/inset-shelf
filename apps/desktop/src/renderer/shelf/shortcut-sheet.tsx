import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { shortcutSheet } from "@shared/shortcuts";
import { Dialog } from "radix-ui";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { isMac } from "@/shared/platform";

/**
 * Keyboard Shortcuts (⌘/, Ctrl+/ on Windows): every key the shelf answers,
 * as this system writes it, over the shelf. Escape closes it.
 */
export const ShortcutSheet = ({
  onOpenChange,
  open,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) => (
  <Dialog.Root onOpenChange={onOpenChange} open={open}>
    <Dialog.Portal>
      <Dialog.Overlay className="data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 fixed inset-0 z-50 bg-black/40 duration-100" />
      <Dialog.Content
        aria-describedby={undefined}
        // The sheet itself takes focus and scrolls, so the arrow keys move through it; Escape or the button closes.
        onOpenAutoFocus={(event) => {
          event.preventDefault();

          if (event.currentTarget instanceof HTMLElement) {
            event.currentTarget.focus();
          }
        }}
        className="bg-popover text-popover-foreground ring-foreground/10 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 shelf-list fixed inset-2 z-50 flex flex-col overflow-y-auto rounded-xl shadow-lg ring-1 duration-100 outline-none"
      >
        <div className="bg-popover sticky top-0 z-10 flex h-11 shrink-0 items-center gap-2 border-b pr-1.5 pl-3.5">
          <Dialog.Title className="flex-1 text-sm font-medium">
            Keyboard Shortcuts
          </Dialog.Title>
          <Dialog.Close asChild>
            <Button aria-label="Close" size="icon-sm" variant="ghost">
              <HugeiconsIcon icon={Cancel01Icon} />
            </Button>
          </Dialog.Close>
        </div>
        <div className="px-3.5 pt-2 pb-4">
          {shortcutSheet(isMac).map((group) => (
            <section
              aria-label={group.title}
              className="pt-2"
              key={group.title}
            >
              <h3 className="text-muted-foreground pb-1 text-xs font-medium">
                {group.title}
              </h3>
              <dl className="flex flex-col">
                {group.rows.map((row) => (
                  <div
                    className="border-foreground/[0.06] flex min-h-7 items-center gap-3 border-b py-1 last:border-b-0"
                    key={row.label}
                  >
                    <dt className="min-w-0 flex-1 text-sm leading-snug">
                      {row.label}
                    </dt>
                    <dd className="flex shrink-0 items-center gap-1">
                      {row.keys.map((keys) => (
                        <Kbd key={keys}>{keys}</Kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        {/* A fade at the foot says the list goes on below. */}
        <div
          aria-hidden="true"
          className="from-popover pointer-events-none sticky bottom-0 -mt-8 h-8 shrink-0 bg-linear-to-t to-transparent"
        />
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
);

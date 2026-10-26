import { InboxIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { shortcutLabels } from "@shared/shortcut";

import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";
import { isMac, isWindows } from "@/shared/platform";

const keys = shortcutLabels(isMac);

/** The system's own screenshot keys; a screenshot taken with them shows a card to keep it. */
const screenshotKeys = (): string | null => {
  if (isMac) {
    return "⇧⌘4";
  }

  return isWindows ? "Win+Shift+S" : null;
};

const shot = screenshotKeys();

/** The ways in from another app, each with its key; the note field speaks for itself. */
const STEPS = [
  { keys: keys.doubleShift, text: "Save selected text" },
  ...(shot === null ? [] : [{ keys: shot, text: "Take a screenshot" }]),
];

/** A first-run guide in place of an empty list. */
export const EmptyShelf = () => (
  // Centred in the list, between the search field and the note field.
  <div className="flex min-h-full flex-col justify-center">
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon icon={InboxIcon} />
        </EmptyMedia>
        <EmptyTitle>Your shelf is empty</EmptyTitle>
      </EmptyHeader>
      <EmptyContent>
        <ul className="flex w-full max-w-56 flex-col gap-2 text-left text-sm">
          {STEPS.map((step) => (
            <li
              className="flex items-center justify-between gap-3"
              key={step.text}
            >
              <span className="text-muted-foreground">{step.text}</span>
              <Kbd>{step.keys}</Kbd>
            </li>
          ))}
        </ul>
      </EmptyContent>
    </Empty>
  </div>
);

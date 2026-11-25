import { Alert02Icon, ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { NotSavedItem, ShelfStatus } from "@shared/contracts";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { Clamp } from "./clamp";

export interface BannersProps {
  readonly status: ShelfStatus;
  /** Opens the onboarding at Accessibility. */
  readonly onSetUpDoubleShift: () => void;
  readonly onDismissProblem: () => void;
  readonly onRetrySave: () => void;
}

interface BannerAction {
  readonly label: string;
  readonly run: () => void;
  /** Throws something away: the red tint (Round 7). */
  readonly destructive?: boolean;
}

type Tone = "notice" | "error";

const TONE: Readonly<Record<Tone, string>> = {
  error: "bg-destructive/10 text-destructive",
  notice: "bg-foreground/5",
};

/** How many lines of its reason a banner shows before Show full message. */
const BANNER_LINES = 4;

const Banner = ({
  actions,
  text,
  title,
  tone,
}: {
  readonly title: string;
  readonly text: string;
  readonly tone: Tone;
  readonly actions: readonly BannerAction[];
}) => (
  <div
    className={cn(
      "mx-3 mb-1.5 flex flex-col gap-1 rounded-lg px-3 py-2 text-xs",
      TONE[tone]
    )}
    role={tone === "error" ? "alert" : "status"}
  >
    <p className="text-sm font-medium">{title}</p>
    {/* Four lines at most, so a long reason never pushes the list away; the rest opens in place, by keyboard too. */}
    <Clamp
      className={cn(
        "break-words",
        tone === "notice" && "text-muted-foreground"
      )}
      less="Show less"
      lines={BANNER_LINES}
      more="Show full message"
    >
      {text}
    </Clamp>
    {actions.length === 0 ? null : (
      <div className="mt-1 flex flex-wrap gap-1.5">
        {actions.map((action) => (
          <Button
            key={action.label}
            onClick={() => {
              action.run();
            }}
            size="xs"
            variant={action.destructive === true ? "destructive" : "outline"}
          >
            {action.label}
          </Button>
        ))}
      </div>
    )}
  </div>
);

/** How much of an item's words a row's Retry or Discard names. */
const NAME_MAX = 60;

const UNDO_LABEL = {
  delete: "Delete",
  discard: "Discard changes",
} as const;

/** What an item a failed save left unwritten offers: Retry, and Discard changes, or Delete when the disk has never held it. */
const notSavedActions = (
  undo: NotSavedItem["undo"],
  onRetry: () => void,
  onDiscard: () => void
): readonly BannerAction[] => [
  { label: "Retry", run: onRetry },
  ...(undo === null
    ? []
    : [{ destructive: true, label: UNDO_LABEL[undo], run: onDiscard }]),
];

const UNDO_TEXT = {
  delete: "This item has never been saved.",
  discard: "Discard changes puts back what was saved.",
} as const;

/** "Not saved" on a row whose changes a failed save left unwritten, with what can be done about it. */
export const NotSavedLine = ({
  name,
  onDiscard,
  onRetry,
  undo,
}: {
  /** The item's words or title, so each row's buttons say which item they act on. */
  readonly name: string;
  readonly undo: NotSavedItem["undo"];
  readonly onRetry: () => void;
  readonly onDiscard: () => void;
}) => (
  <div className="text-destructive flex min-h-6 items-center gap-1 text-xs">
    <HugeiconsIcon className="size-3.5 shrink-0" icon={Alert02Icon} />
    <span className="mr-auto font-medium">Not saved</span>
    {notSavedActions(undo, onRetry, onDiscard).map((action) => (
      <Button
        aria-label={`${action.label}: ${name.slice(0, NAME_MAX)}`}
        key={action.label}
        onClick={() => {
          action.run();
        }}
        // Focus stays in a text field open on the row, so closing it doesn't move the button out from under the click.
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        size="xs"
        variant={action.destructive === true ? "destructive" : "quiet"}
      >
        {action.label}
      </Button>
    ))}
  </div>
);

/** Details of an item whose changes aren't on the disk: why, and Retry or Discard changes. */
export const NotSavedBanner = ({
  message,
  onDiscard,
  onRetry,
  undo,
}: {
  readonly undo: NotSavedItem["undo"];
  readonly message: string;
  readonly onRetry: () => void;
  readonly onDiscard: () => void;
}) => (
  <Banner
    actions={notSavedActions(undo, onRetry, onDiscard)}
    text={undo === null ? message : `${message} ${UNDO_TEXT[undo]}`}
    title="Not saved"
    tone="error"
  />
);

interface BannerEntry {
  readonly id: "keys" | "save" | "problem";
  readonly title: string;
  readonly text: string;
  readonly tone: Tone;
  readonly actions: readonly BannerAction[];
}

/** What needs the user, oldest kind first: a missing permission, a failed save, a failed capture. */
const entriesOf = ({
  onDismissProblem,
  onRetrySave,
  onSetUpDoubleShift,
  status,
}: BannersProps): readonly BannerEntry[] => [
  ...(status.keys === "missing"
    ? [
        {
          actions: [{ label: "Turn On…", run: onSetUpDoubleShift }],
          id: "keys" as const,
          text: "Allow Accessibility to save selected text.",
          title: "Double Shift is off",
          tone: "notice" as const,
        },
      ]
    : []),
  ...(status.saveError === null
    ? []
    : [
        {
          actions: status.readOnly ? [] : [{ label: "Retry", run: onRetrySave }],
          id: "save" as const,
          text: status.saveError,
          title: "Not saved to disk",
          tone: "error" as const,
        },
      ]),
  ...(status.problem === null
    ? []
    : [
        {
          actions: [{ label: "Dismiss", run: onDismissProblem }],
          id: "problem" as const,
          text: status.problem,
          title: "Needs your attention",
          tone: "error" as const,
        },
      ]),
];

/** A banner folded to its title, one line; a click opens it. */
const FoldedBanner = ({
  entry,
  onOpen,
}: {
  readonly entry: BannerEntry;
  readonly onOpen: () => void;
}) => (
  <button
    aria-expanded={false}
    className={cn(
      "focus-visible:ring-ring/50 mx-3 mb-1.5 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-left text-xs font-medium outline-none focus-visible:ring-3",
      TONE[entry.tone]
    )}
    onClick={onOpen}
    type="button"
  >
    <span className="min-w-0 flex-1 truncate">{entry.title}</span>
    <HugeiconsIcon className="size-3.5 shrink-0" icon={ArrowDown01Icon} />
  </button>
);

/**
 * One banner per thing that needs the user. With more than one, only the
 * newest shows open; the others fold to one line each, and a click opens
 * one instead.
 */
export const Banners = (props: BannersProps) => {
  const entries = entriesOf(props);
  const ids = entries.map((entry) => entry.id);
  const [seen, setSeen] = useState(ids);
  const [open, setOpen] = useState(ids.at(-1) ?? null);

  // A banner that wasn't there before is the newest: it opens.
  if (ids.join() !== seen.join()) {
    const arrived = ids.findLast((id) => !seen.includes(id));

    setSeen(ids);

    if (arrived !== undefined) {
      setOpen(arrived);
    }
  }

  const shown = open !== null && ids.includes(open) ? open : ids.at(-1);

  return entries.map((entry) =>
    entry.id === shown ? (
      <Banner
        actions={entry.actions}
        key={entry.id}
        text={entry.text}
        title={entry.title}
        tone={entry.tone}
      />
    ) : (
      <FoldedBanner
        entry={entry}
        key={entry.id}
        onOpen={() => {
          setOpen(entry.id);
        }}
      />
    )
  );
};

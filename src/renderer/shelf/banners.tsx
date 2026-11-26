import {
  Alert02Icon,
  ArrowDown01Icon,
  ArrowUp01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { NotSavedItem, ShelfStatus } from "@shared/contracts";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Clamp } from "@/shared/clamp";

import { bySeverity, nextNews, signature } from "./banner-order";
import type { Signed } from "./banner-order";

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
  focused = false,
  text,
  title,
  tone,
}: {
  readonly title: string;
  readonly text: string;
  readonly tone: Tone;
  readonly actions: readonly BannerAction[];
  /** Opened from the keyboard: its title takes focus, so the next Tab reaches Show full message. */
  readonly focused?: boolean;
}) => {
  const heading = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (focused) {
      heading.current?.focus();
    }
  }, [focused]);

  return (
    <div
      className={cn(
        "mx-3 mb-1.5 flex flex-col gap-1 rounded-lg px-3 py-2 text-xs",
        TONE[tone]
      )}
      role={tone === "error" ? "alert" : "status"}
    >
      <p
        className="focus-visible:ring-ring/50 -mx-1 rounded-sm px-1 text-sm font-medium outline-none focus-visible:ring-3"
        ref={heading}
        tabIndex={focused ? -1 : undefined}
      >
        {title}
      </p>
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
};

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
  // Reaches under the ⋯ column, as the badges and Details do. Its words stay on one line; in a shelf too narrow for both, the buttons take the next line together.
  <div className="text-destructive -mr-9 flex min-h-6 flex-wrap items-center gap-1 text-xs">
    <HugeiconsIcon className="size-3.5 shrink-0" icon={Alert02Icon} />
    <span className="font-medium whitespace-nowrap">Not saved</span>
    <span className="ml-auto flex items-center gap-1">
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
    </span>
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

interface BannerEntry extends Signed {
  readonly title: string;
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
          actions: status.readOnly
            ? []
            : [{ label: "Retry", run: onRetrySave }],
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

/** A click from the keyboard (Enter, Space) has no pointer: where it leads, focus follows. */
const byKey = (): boolean =>
  document.activeElement?.matches(":focus-visible") === true;

const LINE_CLASS =
  "focus-visible:ring-ring/50 mx-3 mb-1.5 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-left text-xs outline-none focus-visible:ring-3";

/** The banners not open, as one line: how many, and their titles; a click opens them all. */
const MoreBanners = ({
  entries,
  focused,
  onOpen,
}: {
  readonly entries: readonly BannerEntry[];
  /** Folded again from the keyboard: the line takes focus back. */
  readonly focused: boolean;
  readonly onOpen: () => void;
}) => {
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (focused) {
      button.current?.focus();
    }
  }, [focused]);

  return (
    <button
      aria-expanded={false}
      className={cn(
        LINE_CLASS,
        TONE[
          entries.some((entry) => entry.tone === "error") ? "error" : "notice"
        ]
      )}
      onClick={onOpen}
      ref={button}
      type="button"
    >
      <span className="shrink-0 font-medium">{entries.length} more</span>
      <span
        className="min-w-0 flex-1 truncate opacity-80"
        title={entries.map((entry) => entry.title).join(", ")}
      >
        {entries.map((entry) => entry.title).join(", ")}
      </span>
      <HugeiconsIcon className="size-3.5 shrink-0" icon={ArrowDown01Icon} />
    </button>
  );
};

/** Under the banners opened together: folds them back to the most severe one. */
const FewerBanners = ({ onFold }: { readonly onFold: () => void }) => (
  <button
    aria-expanded
    className={cn(LINE_CLASS, "text-muted-foreground hover:text-foreground")}
    onClick={onFold}
    type="button"
  >
    <span className="flex-1 font-medium">Show fewer</span>
    <HugeiconsIcon className="size-3.5 shrink-0" icon={ArrowUp01Icon} />
  </button>
);

type Fold = "folded" | "folded-by-key" | "open" | "opened-by-key";

const banner = (entry: BannerEntry, focused = false) => (
  <Banner
    actions={entry.actions}
    focused={focused}
    // New words make it a new banner: it shows them fresh, folded to its first lines.
    key={signature(entry)}
    text={entry.text}
    title={entry.title}
    tone={entry.tone}
  />
);

/**
 * One banner per thing that needs the user. With more than one, the most
 * severe shows open (unsaved data first), and of equals the newest; the
 * others share one line that opens them all, in the same order, with Show
 * fewer under them. A banner whose words change, or that comes back after
 * it cleared, counts as new.
 */
export const Banners = (props: BannersProps) => {
  const entries = entriesOf(props);
  const signatures = entries.map(signature);
  // Signatures in the order they first showed: later is newer.
  const [news, setNews] = useState<readonly string[]>(signatures);
  const [fold, setFold] = useState<Fold>("folded");

  const latest = nextNews(news, signatures);

  if (latest !== news) {
    setNews(latest);

    // Something new arrived: the open slot is decided again, and the others fold.
    if (signatures.some((each) => !news.includes(each))) {
      setFold("folded");
    }
  }

  const ordered = bySeverity(entries, latest);
  const [first, ...rest] = ordered;
  const opened = fold === "open" || fold === "opened-by-key";

  if (first === undefined) {
    return null;
  }

  if (rest.length === 0) {
    return banner(first);
  }

  if (opened) {
    return (
      <>
        {ordered.map((entry) =>
          banner(entry, fold === "opened-by-key" && entry === rest[0])
        )}
        <FewerBanners
          onFold={() => {
            setFold(byKey() ? "folded-by-key" : "folded");
          }}
        />
      </>
    );
  }

  return (
    <>
      {banner(first)}
      <MoreBanners
        entries={rest}
        focused={fold === "folded-by-key"}
        onOpen={() => {
          setFold(byKey() ? "opened-by-key" : "open");
        }}
      />
    </>
  );
};

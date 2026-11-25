import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { NotSavedItem, ShelfStatus } from "@shared/contracts";

import { Button } from "@/components/ui/button";

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

const Banner = ({
  actions,
  text,
  title,
  tone,
}: {
  readonly title: string;
  readonly text: string;
  readonly tone: "notice" | "error";
  readonly actions: readonly BannerAction[];
}) => (
  <div
    className={
      tone === "error"
        ? "bg-destructive/10 text-destructive mx-3 flex flex-col gap-1 rounded-lg px-3 py-2 text-xs"
        : "bg-foreground/5 mx-3 flex flex-col gap-1 rounded-lg px-3 py-2 text-xs"
    }
    role={tone === "error" ? "alert" : "status"}
  >
    <p className="text-sm font-medium">{title}</p>
    <p className={tone === "error" ? undefined : "text-muted-foreground"}>
      {text}
    </p>
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

/**
 * A failed save, with Retry. The shelf keeps every change in memory, so it
 * shows over details too: an entry opened again shows what was typed and
 * that it isn't on disk yet.
 */
export const SaveErrorBanner = ({
  onRetry,
  status,
}: {
  readonly status: ShelfStatus;
  readonly onRetry: () => void;
}) =>
  status.saveError === null ? null : (
    <Banner
      actions={status.readOnly ? [] : [{ label: "Retry", run: onRetry }]}
      text={status.saveError}
      title="Not saved to disk"
      tone="error"
    />
  );

/** One line per thing that needs the user: a missing permission, a failed save, a failed capture. */
export const Banners = ({
  onDismissProblem,
  onRetrySave,
  onSetUpDoubleShift,
  status,
}: BannersProps) => (
  <>
    {status.keys === "missing" ? (
      <Banner
        actions={[
          {
            label: "Turn On…",
            run: onSetUpDoubleShift,
          },
        ]}
        text="Allow Accessibility to save selected text."
        title="Double Shift is off"
        tone="notice"
      />
    ) : null}
    <SaveErrorBanner onRetry={onRetrySave} status={status} />
    {status.problem === null ? null : (
      <Banner
        actions={[{ label: "Dismiss", run: onDismissProblem }]}
        text={status.problem}
        title="Needs your attention"
        tone="error"
      />
    )}
  </>
);

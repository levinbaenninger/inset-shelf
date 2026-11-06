import type { ShelfStatus } from "@shared/contracts";

import { Button } from "@/components/ui/button";

export interface BannersProps {
  readonly status: ShelfStatus;
  readonly onOpenKeySettings: () => void;
  readonly onDismissProblem: () => void;
  readonly onRetrySave: () => void;
}

const Banner = ({
  action,
  text,
  title,
  tone,
}: {
  readonly title: string;
  readonly text: string;
  readonly tone: "notice" | "error";
  readonly action: { readonly label: string; readonly run: () => void } | null;
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
    {action === null ? null : (
      <Button
        className="mt-1 self-start"
        onClick={() => {
          action.run();
        }}
        size="xs"
        variant="outline"
      >
        {action.label}
      </Button>
    )}
  </div>
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
      action={status.readOnly ? null : { label: "Retry", run: onRetry }}
      text={status.saveError}
      title="Not saved to disk"
      tone="error"
    />
  );

/** One line per thing that needs the user: a missing permission, a failed save, a failed capture. */
export const Banners = ({
  onDismissProblem,
  onOpenKeySettings,
  onRetrySave,
  status,
}: BannersProps) => (
  <>
    {status.keys === "missing" ? (
      <Banner
        action={{
          label: "Open Accessibility settings",
          run: onOpenKeySettings,
        }}
        text="Allow Accessibility to save selected text."
        title="Double Shift is off"
        tone="notice"
      />
    ) : null}
    <SaveErrorBanner onRetry={onRetrySave} status={status} />
    {status.problem === null ? null : (
      <Banner
        action={{ label: "Dismiss", run: onDismissProblem }}
        text={status.problem}
        title="Needs your attention"
        tone="error"
      />
    )}
  </>
);

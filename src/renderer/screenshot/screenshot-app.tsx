import {
  Cancel01Icon,
  Download01Icon,
  PaintBrush01Icon,
  PinIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ScreenshotView, ShotSaveTo } from "@shared/contracts";
import type { TutorialAction, TutorialView } from "@shared/tutorial";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { screenshotBridge } from "@/shared/bridge";
import { tooltipText, Truncated } from "@/shared/clamp";
import { usePushedView } from "@/shared/use-pushed-view";
import { coach } from "@/tutorial/anchors";
import { PageHints } from "@/tutorial/hint-layer";

const api = screenshotBridge();

const tutorialSource = {
  load: async () => await api.getTutorial(),
  subscribe: (listener: (view: TutorialView) => void) =>
    api.on("tutorial", listener),
};

const actTutorial = (action: TutorialAction): void => {
  api.tutorial(action);
};

const load = async (): Promise<ScreenshotView | null> => await api.getView();

const subscribe = (listener: (view: ScreenshotView | null) => void) =>
  api.on("view", listener);

/** A round white button in a corner of the card, named on hover. */
const CornerButton = ({
  className,
  icon,
  label,
  onClick,
  pressed,
}: {
  readonly className: string;
  readonly icon: typeof Cancel01Icon;
  readonly label: string;
  readonly onClick: () => void;
  readonly pressed?: boolean;
}) => (
  <div className={cn("absolute", className)}>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          aria-pressed={pressed}
          onClick={onClick}
          size="icon-round"
          variant="overlay"
        >
          <HugeiconsIcon icon={icon} strokeWidth={pressed === true ? 2.5 : 2} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  </div>
);

/** Shows with the card's other actions: while the pointer or the keyboard is on the card, and while a failed save keeps it open. */
const REVEAL =
  "opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 group-data-[failed]:opacity-100";

/** A save button's label: Saving… while it writes, Retry once it failed. */
const saveLabel = (
  save: ScreenshotView["save"],
  to: ShotSaveTo,
  label: ReactNode
): ReactNode => {
  if (save.state === "idle" || save.to !== to) {
    return label;
  }

  return save.state === "saving" ? "Saving…" : "Retry";
};

/** Why the save failed, in a compact bar under the picture: two lines, the rest in its tooltip and, with the keyboard on it, scrolled into view. */
const FailureBar = ({ message }: { readonly message: string }) => (
  <div className="shrink-0 bg-black/80 px-3 py-1.5 text-white">
    <p
      className="-mx-1 line-clamp-2 max-h-16 rounded-sm px-1 text-xs leading-4 wrap-break-word outline-none focus-visible:line-clamp-none focus-visible:overflow-y-auto focus-visible:ring-2 focus-visible:ring-white"
      role="alert"
      // The keyboard reaches the whole message: on focus it unclamps and scrolls.
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a clamped message the keyboard must be able to read whole.
      tabIndex={0}
      title={tooltipText(message)}
    >
      {message}
    </p>
  </div>
);

/**
 * A screenshot card beside the shelf. Add to Shelf shows at once and is the
 * first key stop, with Add to “…” over it when an item can be named; on
 * hover or keyboard focus the picture dims, Copy shows beside Add to Shelf,
 * and the corner actions show. While a save runs its button reads Saving…;
 * a failed save keeps every action in view, says why under the picture, and
 * offers Retry. Dragging the picture into another app drops it as a file.
 */
const Card = ({ view }: { readonly view: ScreenshotView }) => {
  const { save, seq } = view;
  const [held, setHeld] = useState(false);
  const saving = save.state === "saving";

  return (
    <main
      className="group bg-muted ring-foreground/10 relative flex h-svh flex-col overflow-hidden rounded-2xl ring-1 ring-inset"
      data-failed={save.state === "failed" ? "" : undefined}
      {...coach("screenshot-card")}
    >
      <div className="relative min-h-0 flex-1">
        {/* First in the page, so Tab lands on Add to Shelf first; drawn above the picture and its dimming. */}
        <div className="absolute inset-x-12 bottom-3.5 z-10 flex flex-col-reverse items-center gap-1.5">
          <div className="flex items-center gap-1.5">
            <Button
              aria-disabled={saving ? true : undefined}
              onClick={() => {
                if (!saving) {
                  api.addToShelf(seq);
                }
              }}
              size="pill-xs"
              variant="overlay"
            >
              {saveLabel(save, "shelf", "Add to Shelf")}
            </Button>
            <Button
              className="hidden group-hover:inline-flex group-has-[:focus-visible]:inline-flex group-data-[failed]:inline-flex"
              onClick={() => {
                api.copy(seq);
              }}
              size="pill-xs"
              variant="overlay"
            >
              Copy
            </Button>
          </div>
          {view.target === null ? null : (
            <Button
              aria-disabled={saving ? true : undefined}
              className="max-w-full"
              onClick={() => {
                if (!saving) {
                  api.addToItem(seq);
                }
              }}
              size="pill-xs"
              variant="overlay"
            >
              {saveLabel(
                save,
                "item",
                <Truncated
                  className="min-w-0"
                  text={`Add to “${view.target.label}”`}
                />
              )}
            </Button>
          )}
        </div>
        <button
          aria-label="Drag the screenshot into another app"
          className="block h-full w-full cursor-grab active:cursor-grabbing"
          draggable
          onDragStart={(event) => {
            event.preventDefault();
            api.startDrag(seq);
          }}
          type="button"
        >
          <img
            alt="New screenshot"
            className="h-full w-full object-cover transition duration-200 group-hover:blur-xs group-has-[:focus-visible]:blur-xs group-data-[failed]:blur-xs"
            draggable={false}
            src={view.imageUrl}
          />
        </button>
        {/* The other actions show while the pointer is on the card or the keyboard is on one of them; between them the picture still drags. */}
        <div
          className={cn(
            "pointer-events-none absolute inset-0 bg-black/35",
            REVEAL
          )}
        />
        <div
          className={cn(
            "pointer-events-none absolute inset-0 [&_button]:pointer-events-auto",
            REVEAL
          )}
        >
          <CornerButton
            className="top-2.5 left-2.5"
            icon={Cancel01Icon}
            label="Dismiss"
            onClick={() => {
              api.dismiss(seq);
            }}
          />
          <CornerButton
            className="top-2.5 right-2.5"
            icon={PinIcon}
            label={held ? "Kept on Screen" : "Keep on Screen"}
            onClick={() => {
              setHeld(true);
              api.hold(seq);
            }}
            pressed={held}
          />
          <CornerButton
            className="bottom-2.5 left-2.5"
            icon={PaintBrush01Icon}
            label="Annotate"
            onClick={() => {
              api.annotate(seq);
            }}
          />
          <CornerButton
            className="right-2.5 bottom-2.5"
            icon={Download01Icon}
            label="Save to Downloads"
            onClick={() => {
              api.saveToDownloads(seq);
            }}
          />
        </div>
      </div>
      {save.state === "failed" ? <FailureBar message={save.message} /> : null}
    </main>
  );
};

/**
 * While the pointer is on the card, or the keyboard is on one of its
 * actions, main keeps it on screen; once both leave, its time runs again.
 */
const useHoverReport = (): void => {
  useEffect(() => {
    const page = document.documentElement;
    let pointer = false;
    let keyboard = false;

    const report = (): void => {
      api.hover(pointer || keyboard);
    };

    const enter = (): void => {
      pointer = true;
      report();
    };

    const leave = (): void => {
      pointer = false;
      report();
    };

    // Only focus the keyboard moved, as the actions show for it: a clicked button keeps focus after the pointer leaves.
    const focusIn = (event: FocusEvent): void => {
      keyboard =
        event.target instanceof Element &&
        event.target.matches(":focus-visible");
      report();
    };

    const focusOut = (event: FocusEvent): void => {
      if (event.relatedTarget === null) {
        keyboard = false;
        report();
      }
    };

    page.addEventListener("pointerenter", enter);
    page.addEventListener("pointerleave", leave);
    page.addEventListener("focusin", focusIn);
    page.addEventListener("focusout", focusOut);

    return () => {
      page.removeEventListener("pointerenter", enter);
      page.removeEventListener("pointerleave", leave);
      page.removeEventListener("focusin", focusIn);
      page.removeEventListener("focusout", focusOut);
    };
  }, []);
};

export const ScreenshotApp = () => {
  useHoverReport();

  const view = usePushedView(load, subscribe, null);

  return (
    <>
      {view === null ? null : <Card key={view.seq} view={view} />}
      <PageHints act={actTutorial} source={tutorialSource} />
    </>
  );
};

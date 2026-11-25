import {
  Cancel01Icon,
  Copy01Icon,
  Download01Icon,
  PaintBrush01Icon,
  PinIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ScreenshotView, ShotSaveTo } from "@shared/contracts";
import type { TutorialAction, TutorialView } from "@shared/tutorial";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { screenshotBridge } from "@/shared/bridge";
import { tooltipText } from "@/shared/clamp";
import { usePushedView } from "@/shared/use-pushed-view";
import { coach } from "@/tutorial/anchors";
import { PageHints } from "@/tutorial/hint-layer";

import { fitName } from "./fit-name";

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

/** Takes clicks only while it shows. */
const REVEAL_CLICKS =
  "group-hover:pointer-events-auto group-has-[:focus-visible]:pointer-events-auto group-data-[failed]:pointer-events-auto";

/** Every label a button can read, drawn in one place so its size never changes; only `shown` can be seen. */
const Steady = ({
  labels,
  shown,
}: {
  readonly labels: readonly string[];
  readonly shown: string;
}) => (
  <span className="grid">
    {labels.map((label) => (
      <span
        className={cn(
          "col-start-1 row-start-1",
          label !== shown && "invisible"
        )}
        key={label}
      >
        {label}
      </span>
    ))}
  </span>
);

/** What a save button reads: its label, Saving… while it writes, Retry once it failed. */
const saveState = (
  save: ScreenshotView["save"],
  to: ShotSaveTo
): "idle" | "saving" | "failed" =>
  save.state === "idle" || save.to !== to ? "idle" : save.state;

const SHELF_LABEL = {
  failed: "Retry",
  idle: "Add to Shelf",
  saving: "Saving…",
} as const;

const SHELF_LABELS = Object.values(SHELF_LABEL);

/** What Add to “…” reads before the item's name. */
const ITEM_LEAD = { failed: "Retry adding to", idle: "Add to" } as const;

/**
 * “Name”, cut inside the quotes so the closing one always shows, right after
 * the ellipsis (fit-name.ts); `stacked` puts the name on a line of its own
 * under the lead.
 */
const Quoted = ({
  lead,
  name,
  stacked = false,
}: {
  readonly lead: string;
  readonly name: string;
  readonly stacked?: boolean;
}) => {
  const line = useRef<HTMLSpanElement>(null);
  const whole = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(name);

  useLayoutEffect(() => {
    const range = document.createRange();

    const fit = (): void => {
      const row = line.current;
      const text = whole.current?.firstChild;

      if (row === null || !(text instanceof Text)) {
        return;
      }

      const width = (from: number, to: number): number => {
        range.setStart(text, from);
        range.setEnd(text, to);

        return range.getBoundingClientRect().width;
      };

      // The line's width, less the lead and the quotes that share it with the name.
      let room = row.clientWidth;

      for (const part of row.children) {
        if (!part.contains(text)) {
          room -= part.getBoundingClientRect().width;
        }
      }

      setShown(
        fitName(name, room, {
          dots: width(name.length, name.length + 1),
          upTo: (end) => width(0, end),
        })
      );
    };

    let showing = true;
    const observer = new ResizeObserver(fit);

    if (line.current !== null) {
      observer.observe(line.current);
    }

    fit();

    // The words are measured again once their font has loaded.
    void (async () => {
      await document.fonts.ready;

      if (showing) {
        fit();
      }
    })();

    return () => {
      showing = false;
      observer.disconnect();
    };
  }, [name]);

  const leadText = (
    <span className="shrink-0 whitespace-pre">
      {stacked ? lead : `${lead} `}
    </span>
  );

  return (
    <span
      className={cn("flex w-full min-w-0", stacked && "flex-col items-center")}
      title={tooltipText(`${lead} “${name}”`)}
    >
      {stacked ? leadText : null}
      <span className="flex w-full min-w-0 justify-center" ref={line}>
        {stacked ? null : leadText}
        <span className="shrink-0">“</span>
        <span className="relative min-w-0 overflow-hidden whitespace-nowrap">
          {shown}
          {/* The whole name with an ellipsis, never seen: what the cut is measured on. */}
          <span
            aria-hidden="true"
            className="invisible absolute top-0 left-0"
            ref={whole}
          >
            {`${name}…`}
          </span>
        </span>
        <span className="shrink-0">”</span>
      </span>
    </span>
  );
};

/** Shown after the reason a save failed: what it means for the screenshot. */
const NOT_KEPT = "The screenshot isn’t saved yet.";

/** Why the save failed, reason first, in a compact bar under the picture: two lines, the rest in its tooltip and, with the keyboard on it, scrolled into view. */
const FailureBar = ({ message }: { readonly message: string }) => (
  <div className="shrink-0 bg-black/80 px-3 py-1.5 text-white">
    <p
      className="-mx-1 line-clamp-2 max-h-16 rounded-sm px-1 text-xs leading-4 wrap-break-word outline-none focus-visible:line-clamp-none focus-visible:overflow-y-auto focus-visible:ring-2 focus-visible:ring-white"
      role="alert"
      // The keyboard reaches the whole message: on focus it unclamps and scrolls.
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a clamped message the keyboard must be able to read whole.
      tabIndex={0}
      title={tooltipText(`${message} ${NOT_KEPT}`)}
    >
      <span className="font-semibold">{message}</span>{" "}
      <span className="text-white/75">{NOT_KEPT}</span>
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
  const { save, seq, target } = view;
  const [held, setHeld] = useState(false);
  const saving = save.state === "saving";
  const shelfLabel = SHELF_LABEL[saveState(save, "shelf")];
  const itemState = saveState(save, "item");

  return (
    <main
      className="group bg-muted ring-foreground/10 relative flex h-svh flex-col overflow-hidden rounded-2xl ring-1 ring-inset"
      data-failed={save.state === "failed" ? "" : undefined}
      {...coach("screenshot-card")}
    >
      <div className="relative min-h-0 flex-1">
        {/*
          First in the page, so Tab lands on Add to Shelf first, then Copy, then Add to “…”; drawn above the picture and its dimming.
          Add to Shelf is in the card's middle, and Copy shows beside it without taking room in the row, so it never moves; Add to “…” sits under Add to Shelf, never wider.
        */}
        <div className="absolute inset-x-12 bottom-3 z-10 flex justify-center">
          <div className="grid grid-cols-1 gap-y-1.5">
            <div className="relative flex">
              <Button
                aria-disabled={saving ? true : undefined}
                aria-label={shelfLabel}
                // Wide enough, with an item to name, that the line under it reads a name and is never wider.
                className={cn("flex-1", target !== null && "min-w-36")}
                onClick={() => {
                  if (!saving) {
                    api.addToShelf(seq);
                  }
                }}
                size="pill-sm"
                variant="overlay"
              >
                <Steady labels={SHELF_LABELS} shown={shelfLabel} />
              </Button>
              {/* An icon, not the word: beside Add to Shelf in the card's middle, the word would reach under the corner button. */}
              <span
                className={cn(
                  "pointer-events-none absolute inset-y-0 left-full ml-1.5 flex items-center",
                  REVEAL,
                  REVEAL_CLICKS
                )}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      aria-label="Copy"
                      onClick={() => {
                        api.copy(seq);
                      }}
                      size="icon-round-xs"
                      variant="overlay"
                    >
                      <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Copy</TooltipContent>
                </Tooltip>
              </span>
            </div>
            {target === null ? null : (
              <Button
                aria-disabled={saving ? true : undefined}
                aria-label={
                  itemState === "saving"
                    ? "Saving…"
                    : `${ITEM_LEAD[itemState]} “${target.label}”`
                }
                className="w-0 min-w-full"
                onClick={() => {
                  if (!saving) {
                    api.addToItem({ id: target.id, seq });
                  }
                }}
                size={itemState === "failed" ? "pill-xs-2" : "pill-xs"}
                variant="overlay-quiet"
              >
                {itemState === "saving" ? (
                  "Saving…"
                ) : (
                  <Quoted
                    lead={ITEM_LEAD[itemState]}
                    name={target.label}
                    stacked={itemState === "failed"}
                  />
                )}
              </Button>
            )}
          </div>
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

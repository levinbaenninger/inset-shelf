import {
  Cancel01Icon,
  Copy01Icon,
  Download01Icon,
  PaintBrush01Icon,
  PinIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@inset/ui/components/button";
import { cn } from "@inset/ui/lib/utils";
import type { ScreenshotView, ShotPlaced } from "@shared/contracts";
import type { ItemId } from "@shared/shelf";
import type { TutorialAction, TutorialView } from "@shared/tutorial";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { screenshotBridge } from "@/shared/bridge";
import { tooltipText } from "@/shared/clamp";
import { usePushedView } from "@/shared/use-pushed-view";
import { coach } from "@/tutorial/anchors";
import { PageHints } from "@/tutorial/hint-layer";

import { cardAdds, PILL_LABEL } from "./card-adds";
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

/** A round white button in a corner of the card, named on hover. With `off` it stays in its corner, dimmed, can't be pressed, and says that reason on hover. */
const CornerButton = ({
  className,
  icon,
  label,
  off,
  onClick,
  pressed,
}: {
  readonly className: string;
  readonly icon: typeof Cancel01Icon;
  readonly label: string;
  readonly off?: string;
  readonly onClick: () => void;
  readonly pressed?: boolean;
}) => {
  const button = (
    <Button
      aria-label={label}
      aria-pressed={pressed}
      disabled={off !== undefined}
      onClick={onClick}
      size="icon-round"
      variant="overlay"
    >
      <HugeiconsIcon icon={icon} strokeWidth={pressed === true ? 2.5 : 2} />
    </Button>
  );

  return (
    <div className={cn("absolute", className)}>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* A disabled button takes no pointer: the span around it does, among corners that let the pointer through to the picture, and says why the button is off. */}
          {off === undefined ? (
            button
          ) : (
            <span className="pointer-events-auto flex">{button}</span>
          )}
        </TooltipTrigger>
        <TooltipContent>{off ?? label}</TooltipContent>
      </Tooltip>
    </div>
  );
};

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

const PILL_LABELS = Object.values(PILL_LABEL);

/** Why Annotate is off while Retry is the only add: it would add the screenshot to the shelf, and the shelf holds it on its item. Its tile there opens to annotate, saved or not. The dimmed button says where on hover; the failure message says it for the keyboard (ON_SHELF). */
const ANNOTATE_OFF = "Annotate it in its item’s details";

/** “Name”, cut inside the quotes so the closing one always shows, right after the ellipsis (fit-name.ts). */
const Quoted = ({
  lead,
  name,
}: {
  readonly lead: string;
  readonly name: string;
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

  return (
    <span
      className="flex w-full min-w-0"
      title={tooltipText(`${lead} “${name}”`)}
    >
      <span className="flex w-full min-w-0 justify-center" ref={line}>
        <span className="shrink-0 whitespace-pre">{`${lead} `}</span>
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

/** The words under Retry that only name the item: white words on the picture's darkened foot, not a button. */
const FOOT_CAPTION =
  "w-full px-0.5 py-0.5 text-xs leading-4 tracking-tight text-white/90 text-shadow-xs text-shadow-black/60";

/** Shown after the reason a save failed: what it means for the screenshot. */
const NOT_KEPT = "The screenshot isn’t saved yet.";

/** While the shelf holds the screenshot, Retry is the only add: that it isn't saved, and what the user does on the shelf to get the other add back. For an attachment the place to act comes first, so the card's two lines hold it. There the tile opens to annotate, which the keyboard can't learn from a button that is off, and the tile's own removal brings the other add back (not Discard changes, which would put back the item's other changes too). */
const ON_SHELF = {
  item: "The screenshot is in its item’s details, not saved yet. Annotate it there, or remove it to add it elsewhere.",
  shelf: `${NOT_KEPT} Delete it on the shelf to add it elsewhere.`,
} as const;

/** What follows the reason a save failed: the screenshot isn't saved, and where the shelf holds it, what to do there. */
const afterFailure = (placed: ShotPlaced | null): string =>
  placed === null ? NOT_KEPT : ON_SHELF[placed.to];

/** Why the save failed, reason first, then what `after` says it means for the screenshot, in a compact bar under the picture: two lines, the rest in its tooltip and, with the keyboard on it, scrolled into view. */
const FailureBar = ({
  after,
  message,
}: {
  readonly after: string;
  readonly message: string;
}) => (
  <div className="shrink-0 bg-black/80 px-3 py-1.5 text-white">
    <p
      className="-mx-1 line-clamp-2 max-h-16 rounded-sm px-1 text-xs leading-4 wrap-break-word outline-none focus-visible:line-clamp-none focus-visible:overflow-y-auto focus-visible:ring-2 focus-visible:ring-white"
      role="alert"
      // The keyboard reaches the whole message: on focus it unclamps and scrolls.
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a clamped message the keyboard must be able to read whole.
      tabIndex={0}
      title={tooltipText(`${message} ${after}`)}
    >
      <span className="font-semibold">{message}</span>{" "}
      <span className="text-white/75">{after}</span>
    </p>
  </div>
);

/**
 * A screenshot card beside the shelf. Add to Shelf shows at once and is the
 * first key stop. On hover or keyboard focus the picture dims, Copy shows
 * beside Add to Shelf, and the corner actions show. While a save runs the
 * pill reads Saving…; a failed save keeps every action in view, says why
 * under the picture, and offers Retry. Once the screenshot is on its item,
 * not saved, Retry is the one pill and a line under it only names the item.
 * Dragging the picture onto an item in the shelf attaches it there; into
 * another app, it drops as a file.
 */
const Card = ({ view }: { readonly view: ScreenshotView }) => {
  const { save, seq } = view;
  const [held, setHeld] = useState(false);
  const saving = save.state === "saving";
  const { line, pill, sole } = cardAdds(view);

  /** A press of the pill: to the item it named, or to the shelf. */
  const add = (item: ItemId | null): void => {
    if (saving) {
      return;
    }

    if (item === null) {
      api.addToShelf(seq);
    } else {
      api.addToItem({ id: item, seq });
    }
  };

  return (
    <main
      className="group bg-muted ring-foreground/10 relative flex h-svh flex-col overflow-hidden rounded-2xl ring-1 ring-inset"
      data-failed={save.state === "failed" ? "" : undefined}
      {...coach("screenshot-card")}
    >
      <div className="relative min-h-0 flex-1">
        {/*
          First in the page, so Tab lands on Add to Shelf first, then Copy; drawn above the picture and its dimming.
          Add to Shelf is in the card's middle, and Copy shows beside it without taking room in the row, so it never moves; under the only Retry, a line names its item, between the corner buttons.
        */}
        <div className="absolute inset-x-12 bottom-3 z-10 flex flex-col items-center gap-y-1">
          <div className="relative flex">
            {/* Keyed by its add, so React never turns it into the button of another add: a press goes where the button said when the keyboard came to it. */}
            <Button
              aria-disabled={saving ? true : undefined}
              aria-label={pill.name}
              key={pill.add}
              onClick={() => {
                add(pill.item);
              }}
              size="pill-sm"
              variant="overlay"
            >
              <Steady labels={PILL_LABELS} shown={pill.label} />
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
          {line === null ? null : (
            // The pill's name already says it all to a screen reader.
            <p aria-hidden="true" className={FOOT_CAPTION}>
              <Quoted lead={line.lead} name={line.name} />
            </p>
          )}
        </div>
        <button
          aria-label="Drag the screenshot onto an item or into another app"
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
        {/* The line under the pill is white words with no pill of their own: the picture's foot darkens under them, so they read on a white picture too. */}
        {line === null ? null : (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-linear-to-t from-black/80 via-black/60 to-transparent" />
        )}
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
            off={sole ? ANNOTATE_OFF : undefined}
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
      {save.state === "failed" ? (
        <FailureBar after={afterFailure(save.placed)} message={save.message} />
      ) : null}
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

import {
  Cancel01Icon,
  Download01Icon,
  PaintBrush01Icon,
  PinIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ScreenshotView } from "@shared/contracts";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { screenshotBridge } from "@/shared/bridge";
import { usePushedView } from "@/shared/use-pushed-view";

const api = screenshotBridge();

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

/**
 * A screenshot card beside the shelf. On hover the picture dims behind its
 * actions. Dragging it into another app drops it as a file.
 */
const Card = ({ view }: { readonly view: ScreenshotView }) => {
  const { seq } = view;
  const [held, setHeld] = useState(false);

  return (
    <main className="group bg-muted ring-foreground/10 relative h-svh overflow-hidden rounded-2xl ring-1 ring-inset">
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
          className="h-full w-full object-cover transition duration-200 group-hover:blur-xs"
          draggable={false}
          src={view.imageUrl}
        />
      </button>
      {/* The actions show while the pointer is on the card; between them the picture still drags. */}
      <div className="pointer-events-none absolute inset-0 bg-black/35 opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
      <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100 [&_button]:pointer-events-auto">
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <Button
            onClick={() => {
              api.copy(seq);
            }}
            size="pill"
            variant="overlay"
          >
            Copy
          </Button>
          <Button
            onClick={() => {
              api.addToShelf(seq);
            }}
            size="pill"
            variant="overlay"
          >
            Add to Shelf
          </Button>
        </div>
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
    </main>
  );
};

/** While the pointer is on the card, main keeps it on screen. */
const useHoverReport = (): void => {
  useEffect(() => {
    const page = document.documentElement;

    const enter = (): void => {
      api.hover(true);
    };

    const leave = (): void => {
      api.hover(false);
    };

    page.addEventListener("pointerenter", enter);
    page.addEventListener("pointerleave", leave);

    return () => {
      page.removeEventListener("pointerenter", enter);
      page.removeEventListener("pointerleave", leave);
    };
  }, []);
};

export const ScreenshotApp = () => {
  useHoverReport();

  const view = usePushedView(load, subscribe, null);

  return view === null ? null : <Card key={view.seq} view={view} />;
};

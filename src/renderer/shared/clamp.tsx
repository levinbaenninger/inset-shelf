import { useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";

import { cn } from "@/lib/utils";

/** A tooltip longer than this is cut: it is there to finish a line, not to be read like a page. */
const TOOLTIP_MAX = 300;

export const tooltipText = (text: string): string =>
  text.length > TOOLTIP_MAX
    ? `${text.slice(0, TOOLTIP_MAX - 1).trimEnd()}…`
    : text;

/** Calls `measure` with the element now, and again whenever it changes size. */
const useMeasure = (
  ref: RefObject<HTMLElement | null>,
  measure: (element: HTMLElement) => void,
  enabled = true
): void => {
  // Every render, as BadgeLine's observer: the words may have changed without the box changing size.
  useEffect(() => {
    const element = ref.current;

    const observer = new ResizeObserver(() => {
      if (element !== null) {
        measure(element);
      }
    });

    if (element !== null && enabled) {
      observer.observe(element);
      measure(element);
    }

    return () => {
      observer.disconnect();
    };
  });
};

const CUT = { 1: "truncate", 2: "line-clamp-2" } as const;

/**
 * Words that end in an ellipsis when they don't fit on one line (or two),
 * and only then show the whole of them on hover. `tooltip` replaces the
 * words in the tooltip when it says more, such as where a click goes.
 */
export const Truncated = ({
  className,
  lines = 1,
  text,
  tooltip = text,
}: {
  readonly text: string;
  readonly tooltip?: string;
  readonly lines?: keyof typeof CUT;
  readonly className?: string;
}) => {
  const ref = useRef<HTMLSpanElement>(null);
  const [cut, setCut] = useState(false);

  useMeasure(ref, (element) => {
    setCut(
      element.scrollWidth > element.clientWidth + 1 ||
        element.scrollHeight > element.clientHeight + 1
    );
  });

  return (
    <span
      className={cn(CUT[lines], className)}
      ref={ref}
      title={cut || tooltip !== text ? tooltipText(tooltip) : undefined}
    >
      {text}
    </span>
  );
};

/**
 * Words cut to `lines` lines, the last one fading, with a quiet button
 * under them that shows the rest in place; no ellipsis, so a sentence's
 * own full stop never meets one. Words that fit show whole, with no button.
 */
export const Clamp = ({
  children,
  className,
  less = "Show less",
  lines,
  more = "Show more",
}: {
  readonly children: ReactNode;
  readonly lines: number;
  /** Takes the line-height of the words, which `lines` counts in. */
  readonly className?: string;
  readonly more?: string;
  readonly less?: string;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);

  useMeasure(
    ref,
    (element) => {
      setCut(element.scrollHeight > element.clientHeight + 1);
    },
    !open
  );

  return (
    <>
      <div
        className={cn(
          className,
          // Only the lines below are cut: a space that hangs past a line's end isn't.
          !open && "max-h-[calc(var(--lines)*1lh)] overflow-y-clip",
          !open &&
            cut &&
            "[mask-image:linear-gradient(to_bottom,#000_calc(100%-1lh),rgb(0_0_0/0.3))]"
        )}
        ref={ref}
        style={{ "--lines": lines }}
      >
        {children}
      </div>
      {cut || open ? (
        <button
          aria-expanded={open}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -mt-0.5 self-start rounded-sm text-xs font-medium outline-none focus-visible:ring-3"
          onClick={(event) => {
            event.stopPropagation();
            setOpen(!open);
          }}
          type="button"
        >
          {open ? less : more}
        </button>
      ) : null}
    </>
  );
};

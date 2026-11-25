import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";

import { cn } from "@/lib/utils";

/** A tooltip longer than this is cut: it is there to finish a line, not to be read like a page. */
const TOOLTIP_MAX = 300;

export const tooltipText = (text: string): string =>
  text.length > TOOLTIP_MAX
    ? `${text.slice(0, TOOLTIP_MAX - 1).trimEnd()}…`
    : text;

/**
 * Calls `measure` with the element now, and again whenever what decides the
 * measurement changes: the box's size, or the words and classes inside it.
 * Nothing else re-measures, so a render that changes neither (a keystroke in
 * the composer above a long list) costs no layout reads.
 */
const useMeasure = (
  ref: RefObject<HTMLElement | null>,
  measure: (element: HTMLElement) => void,
  enabled = true
): void => {
  const run = useEffectEvent((element: HTMLElement) => {
    measure(element);
  });

  useEffect(() => {
    const element = ref.current;

    const again = (): void => {
      if (element !== null) {
        run(element);
      }
    };

    const resized = new ResizeObserver(again);
    const changed = new MutationObserver(again);

    if (element !== null && enabled) {
      resized.observe(element);
      changed.observe(element, {
        attributeFilter: ["class", "style"],
        characterData: true,
        childList: true,
        subtree: true,
      });
      run(element);
    }

    return () => {
      resized.disconnect();
      changed.disconnect();
    };
  }, [ref, enabled]);
};

/** Whether a box, or a box in it that clips, hides some of its words: an ellipsis, or a part wrapped out of sight. */
const hidesWords = (element: Element): boolean =>
  [element, ...element.querySelectorAll("*")].some(
    (box) =>
      getComputedStyle(box).overflow !== "visible" &&
      (box.scrollWidth > box.clientWidth + 1 ||
        box.scrollHeight > box.clientHeight + 1)
  );

/** Whether the words in `ref` show cut now, kept up as they and the box change. */
export const useCut = (ref: RefObject<HTMLElement | null>): boolean => {
  const [cut, setCut] = useState(false);

  useMeasure(ref, (element) => {
    setCut(hidesWords(element));
  });

  return cut;
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
  const cut = useCut(ref);

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

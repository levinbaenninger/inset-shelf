import { cn } from "@inset/ui/lib/utils";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";

/** A tooltip longer than this is cut: it is there to finish a line, not to be read like a page. */
export const TOOLTIP_MAX = 300;

/** `text` cut to `max` characters, ending "…" when cut; `max` leaves room for a line kept whole after it. */
export const tooltipText = (text: string, max = TOOLTIP_MAX): string =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/**
 * Calls `measure` with the element now, and again whenever what decides the
 * measurement changes: its size or its parent's, or the words and classes
 * inside it.
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

      // An inline box reports no size of its own: the box it sits in says when its room changes.
      if (element.parentElement !== null) {
        resized.observe(element.parentElement);
      }

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
      // A pixel past is cut too: its ellipsis shows.
      (box.scrollWidth > box.clientWidth ||
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

/** What a box's line-height is in pixels, from its computed style. */
export const lineHeight = (element: HTMLElement): number =>
  Number(getComputedStyle(element).lineHeight.replace("px", "")) || 20;

/** Controls in a box, which the keyboard reaches. */
const FOCUSABLE = "a[href], button, input, textarea, [tabindex]";

/** Marks a control the clamp took out of the Tab order, so it can put it back. */
const HIDDEN_BY_CLAMP = "data-clamp-hid";

/**
 * Keeps the keyboard off what the clamp hides: a link below the last line
 * shown can't be focused until Show more opens it, so Show more comes
 * before it. Everything goes back once the words show whole.
 */
export const hideCutControls = (
  element: HTMLElement,
  clipped: boolean
): void => {
  const { bottom } = element.getBoundingClientRect();

  for (const control of element.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    const below = clipped && control.getBoundingClientRect().top >= bottom - 1;

    if (below && control.tabIndex >= 0) {
      control.setAttribute(
        HIDDEN_BY_CLAMP,
        control.getAttribute("tabindex") ?? ""
      );
      control.tabIndex = -1;
    } else if (!below && control.hasAttribute(HIDDEN_BY_CLAMP)) {
      const before = control.getAttribute(HIDDEN_BY_CLAMP);

      if (before === "") {
        control.removeAttribute("tabindex");
      } else {
        control.setAttribute("tabindex", before ?? "");
      }

      control.removeAttribute(HIDDEN_BY_CLAMP);
    }
  }
};

/** How tall a box's words are whole, under any padding above them, whether or not they are cut now. */
const wordsHeight = (element: HTMLElement): number =>
  element.scrollHeight - Number.parseFloat(getComputedStyle(element).paddingTop);

/**
 * Words cut to `--lines` lines, the last one fading: only the lines below
 * are cut, so a space hanging past a line's end isn't. Padding above the
 * words (code's block) is kept whole. Space under them belongs inside them,
 * since padding there would show the line after the cut.
 */
export const CUT_LINES =
  "box-content max-h-[calc(var(--lines)*1lh)] overflow-y-clip [mask-image:linear-gradient(to_bottom,#000_calc(100%-1lh),rgb(0_0_0/0.3))]";

/**
 * Words cut to `lines` lines, the last one fading, with a quiet button
 * under them that shows the rest in place; no ellipsis, so a sentence's
 * own full stop never meets one. Words that fit in `lines` lines show whole,
 * with no button; one line more and they are cut, so the cap is the number
 * it says. A message passes `spare`: there a button that costs a line to
 * save one is worse than none, so one line over still shows whole. `what`
 * names the words for the button's accessible name ("Show more of the
 * description").
 */
export const Clamp = ({
  children,
  className,
  less = "Show less",
  lines,
  more = "Show more",
  onLines,
  spare = false,
  what,
}: {
  readonly children: ReactNode;
  readonly lines: number;
  /** One line over `lines` still shows whole: for a message, never for a part of a row with a stated cap. */
  readonly spare?: boolean;
  /** Told how many lines the words take whole, whether or not they are cut, each time they are measured. */
  readonly onLines?: (lines: number) => void;
  /** Takes the line-height of the words, which `lines` counts in, and any padding above them. */
  readonly className?: string;
  readonly more?: string;
  readonly less?: string;
  readonly what?: string;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  // The first control Show more brought into reach, until the keyboard has gone to it or left the button.
  const revealed = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  // More lines would hide than are spared: the words are cut until Show more opens them.
  const [long, setLong] = useState(false);
  const cut = long && !open;

  useMeasure(ref, (element) => {
    // The words' whole height, whether or not they are cut now.
    const whole = wordsHeight(element);
    const hidden = whole - lines * lineHeight(element);
    const isLong = hidden >= (spare ? 2 : 1) * lineHeight(element) - 1;

    setLong(isLong);
    hideCutControls(element, isLong && !open);
    onLines?.(Math.round(whole / lineHeight(element)));
  });

  const label = open ? less : more;

  return (
    <>
      <div
        className={cn(className, cut && CUT_LINES)}
        data-spare={spare ? "" : undefined}
        ref={ref}
        style={{ "--lines": lines }}
      >
        {children}
      </div>
      {long ? (
        <button
          aria-expanded={open}
          aria-label={what === undefined ? undefined : `${label} of ${what}`}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -mx-0.5 -mt-0.5 self-start rounded-sm px-0.5 text-xs font-medium outline-none focus-visible:ring-3"
          onBlur={() => {
            revealed.current = null;
          }}
          onClick={(event) => {
            event.stopPropagation();
            // What the cut kept the keyboard off comes before this button in the page: the next Tab goes there, not past it.
            revealed.current = open
              ? null
              : (ref.current?.querySelector<HTMLElement>(
                  `[${HIDDEN_BY_CLAMP}]`
                ) ?? null);
            setOpen(!open);
          }}
          onKeyDown={(event) => {
            if (
              event.key === "Tab" &&
              !event.shiftKey &&
              revealed.current?.isConnected === true
            ) {
              event.preventDefault();
              revealed.current.focus();
            }
          }}
          type="button"
        >
          {label}
        </button>
      ) : null}
    </>
  );
};

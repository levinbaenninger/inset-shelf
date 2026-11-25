import type { ShelfItem, Step } from "@shared/shelf";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { RefObject } from "react";

import { lineHeight } from "@/shared/clamp";

import {
  cutParts,
  fitOpenRow,
  keptBudget,
  OPEN_SHARE,
  ROW_CAPS,
  stepHeights,
} from "./open-row";
import type {
  Box,
  RowBudget,
  RowMeasure,
  TextMeasure,
  TextPart,
} from "./open-row";
import type { OpenRowView } from "./row-look";

// The open row's one measure (open-row.ts decides from it): what each part of the row takes, read from the page.

/** Parts not drawn now, measured as at least this tall (open-row.ts): Show more, the more line, a step, the windows' strip, each with its gap. */
const UNSEEN = { moreLine: 32, showMore: 26, step: 44, windows: 40 } as const;

/** A part's height and the gap between it and the part before it. */
const boxOf = (element: Element): Box => {
  const { bottom, top } = element.getBoundingClientRect();
  const before = element.previousElementSibling?.getBoundingClientRect();

  return {
    gap: before === undefined ? 0 : Math.max(0, top - before.bottom),
    height: bottom - top,
  };
};

/** What the page keeps between measures at one width: every step and the windows' strip as last seen. */
interface Seen {
  width: number;
  readonly steps: Map<string, number>;
  windows: Box | null;
}

/** What one drawn part of an open row says about it, gathered as the row is read. */
interface Read {
  rest: number;
  picture: RowMeasure["picture"];
  pin: RowMeasure["pin"];
  showMore: number;
  moreLine: number;
  stepsGap: number;
  readonly steps: Map<string, number>;
  readonly text: Partial<Record<TextPart, TextMeasure>>;
}

const readText = (part: HTMLElement, box: Box): TextMeasure => {
  const line = lineHeight(part);

  return {
    gap: box.gap,
    height: part.scrollHeight,
    line,
    lines: Math.round(part.scrollHeight / line),
  };
};

/** The picture as tall as the row's width makes it with no cap. */
const readPicture = (part: HTMLElement, box: Box): Box => {
  const image = part.querySelector("img");

  const ratio =
    Number(image?.getAttribute("height")) /
    Number(image?.getAttribute("width") ?? 1);

  return {
    gap: box.gap,
    height: (part.parentElement?.clientWidth ?? 0) * (ratio || 0),
  };
};

const readPins = (part: HTMLElement, box: Box): RowMeasure["pin"] => {
  const [first, second] = part.querySelectorAll("li");

  return {
    between:
      first === undefined || second === undefined ? 4 : boxOf(second).gap,
    gap: box.gap,
    height: first?.getBoundingClientRect().height ?? 0,
  };
};

/** Takes in one drawn part. */
const readPart = (part: HTMLElement, read: Read, seen: Seen): void => {
  const box = boxOf(part);
  const kind = part.dataset.rowPart ?? "";

  read.rest -= box.gap + box.height;

  switch (kind) {
    case "title":
    case "words":
    case "description": {
      read.text[kind] = readText(part, box);
      break;
    }

    case "picture": {
      read.picture = readPicture(part, box);
      break;
    }

    case "pins": {
      read.pin = readPins(part, box);
      break;
    }

    case "steps": {
      read.stepsGap = box.gap;

      for (const entry of part.querySelectorAll<HTMLElement>(
        "[data-step-id]"
      )) {
        read.steps.set(
          entry.dataset.stepId ?? "",
          entry.getBoundingClientRect().height
        );
      }

      break;
    }

    case "windows": {
      seen.windows = box;
      break;
    }

    case "show-more": {
      read.showMore = box.gap + box.height;
      break;
    }

    case "more-line": {
      read.moreLine = box.gap + box.height;
      break;
    }

    default: {
      break;
    }
  }
};

/**
 * Reads an open row for open-row.ts: every part whole, whatever the budget
 * it is drawn with, and the row without them. Parts not drawn now are as
 * last seen, or estimated no smaller than they can be.
 */
const measureRow = (
  row: HTMLElement,
  list: HTMLElement,
  item: ShelfItem,
  steps: readonly Step[],
  seen: Seen
): RowMeasure => {
  if (seen.width !== row.clientWidth) {
    seen.width = row.clientWidth;
    seen.steps.clear();
    seen.windows = null;
  }

  const read: Read = {
    moreLine: UNSEEN.moreLine,
    picture: null,
    pin: null,
    rest: row.getBoundingClientRect().height,
    showMore: UNSEEN.showMore,
    steps: new Map(),
    stepsGap: 0,
    text: {},
  };

  for (const part of row.querySelectorAll<HTMLElement>("[data-row-part]")) {
    readPart(part, read, seen);
  }

  const labelled =
    item.kind === "image"
      ? item.pins.filter((each) => each.label !== undefined).length
      : 0;

  return {
    budget: OPEN_SHARE * list.clientHeight,
    moreAnyway: labelled > ROW_CAPS.pins || steps.length > ROW_CAPS.steps,
    moreLine: read.moreLine,
    picture: read.picture,
    pin: read.pin,
    pinCount: labelled,
    rest: read.rest,
    showMore: read.showMore,
    steps:
      steps.length === 0
        ? null
        : {
            gap: read.stepsGap,
            heights: stepHeights(
              steps.slice(0, ROW_CAPS.steps).map((each) => each.id),
              read.steps,
              seen.steps,
              UNSEEN.step
            ),
          },
    text: read.text,
    windows:
      item.windows.length === 0
        ? null
        : (seen.windows ?? { gap: 8, height: UNSEEN.windows }),
  };
};

/** How much of an open row shows, and which of its words are cut. */
interface Fit {
  readonly budget: RowBudget;
  readonly cut: readonly TextPart[];
}

const OPEN_FIT: Fit = { budget: ROW_CAPS, cut: [] };

/**
 * How much of an open row shows (open-row.ts fitOpenRow): measured here
 * once, in one place, as the row or the list changes size. Every part is
 * measured whole, so the answer never depends on the budget it set, and a
 * row settles in one more pass.
 */
export const useOpenRow = (
  row: RefObject<HTMLElement | null>,
  open: boolean,
  item: ShelfItem,
  /** The steps in the order the row lists them (row-parts.ts rowSteps). */
  steps: readonly Step[]
): OpenRowView | null => {
  const [fit, setFit] = useState<Fit>(OPEN_FIT);
  const seen = useRef<Seen>({ steps: new Map(), width: 0, windows: null });

  const read = useEffectEvent((element: HTMLElement, list: HTMLElement) =>
    measureRow(element, list, item, steps, seen.current)
  );

  useEffect(() => {
    const element = row.current;
    const list = element?.closest<HTMLElement>(".shelf-list") ?? null;

    const measure = (): void => {
      if (element === null || list === null) {
        return;
      }

      const measured = read(element, list);
      const budget = fitOpenRow(measured);
      const cut = cutParts(measured, budget);

      setFit((now) => {
        const kept = keptBudget(now.budget, budget);

        return kept === now.budget && cut.join(",") === now.cut.join(",")
          ? now
          : { budget: kept, cut };
      });
    };

    const observer = new ResizeObserver(measure);

    if (open && element !== null && list !== null) {
      observer.observe(element);
      observer.observe(list);
      measure();
    }

    return () => {
      observer.disconnect();
    };
  }, [row, open]);

  const settled = open ? fit : null;

  // Once it has settled, the open row shows whole where it fits, its Details line included.
  useEffect(() => {
    const frame =
      settled === null
        ? null
        : requestAnimationFrame(() => {
            row.current?.scrollIntoView({ block: "nearest" });
          });

    return () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
    };
  }, [settled, row]);

  const [expanded, setExpanded] = useState(false);

  // Show more lasts while the row stays open.
  if (!open && expanded) {
    setExpanded(false);
  }

  return open
    ? {
        ...fit,
        expanded,
        names: {
          description: "the description",
          title: "the title",
          words: item.kind === "text" ? "the text" : "the note",
        },
        toggle: () => {
          setExpanded(!expanded);
        },
      }
    : null;
};

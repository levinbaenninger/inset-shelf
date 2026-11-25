import { useContext, useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { CUT_LINES, hideCutControls } from "@/shared/clamp";

import type { TextPart } from "./open-row";
import { budgetOf, OpenRow } from "./row-look";

/** "the note and the description", "the title, the text and the description". */
const listed = (names: readonly string[]): string =>
  names.length < 2
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;

/**
 * Words of an open row (its title, words or description), cut to the lines
 * the row's budget gives them (open-row.ts). The row has one Show more,
 * under the last part it cuts, which opens every cut part at once. The row
 * measures; this only draws, so nothing measures twice.
 */
export const RowText = ({
  children,
  className,
  part,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly part: TextPart;
}) => {
  const view = useContext(OpenRow);
  const ref = useRef<HTMLDivElement>(null);
  const cut = view?.cut ?? [];
  const expanded = view?.expanded === true;
  const clipped = cut.includes(part) && !expanded;

  // The keyboard never lands on a link below the cut: Show more comes first. After every render, as the cut may move.
  useLayoutEffect(() => {
    if (ref.current !== null) {
      hideCutControls(ref.current, clipped);
    }
  });

  const label = expanded ? "Show less" : "Show more";

  return (
    <>
      <div
        className={cn(className, clipped && CUT_LINES)}
        data-row-part={part}
        ref={ref}
        style={{ "--lines": budgetOf(view)[part] }}
      >
        {children}
      </div>
      {view !== null && cut.at(-1) === part ? (
        <button
          aria-expanded={expanded}
          aria-label={`${label} of ${listed(cut.map((each) => view.names[each]))}`}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -mx-0.5 -mt-0.5 self-start rounded-sm px-0.5 text-xs font-medium outline-none focus-visible:ring-3"
          data-row-part="show-more"
          onClick={(event) => {
            event.stopPropagation();
            view.toggle();
          }}
          type="button"
        >
          {label}
        </button>
      ) : null}
    </>
  );
};

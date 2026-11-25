"use client";

import {
  ArrowUpRight01Icon,
  Calendar03Icon,
  CalendarRemove01Icon,
  CheckListIcon,
  Copy01Icon,
  Link01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "@inset/ui/lib/utils";
import { useState } from "react";
import type { ReactNode } from "react";

import { chipText, DUE_CHOICES, dueFor, menuDate } from "@/lib/due";
import type { DueChoice } from "@/lib/due";
import { useBrowserValue } from "@/lib/use-browser-value";
import { useExpiringState } from "@/lib/use-expiring-state";

import {
  Badge,
  CheckCircle,
  Icon,
  MenuCard,
  MenuItem,
  MenuSeparator,
} from "./app-ui";
import { Section, SectionIntro, Tile } from "./section";

// The details view's own sample (scripts/screens.ts): an item about a furniture quote.
const STEPS = [
  { text: "Ask Rieder whether 21 November is possible", done: true },
  { text: "Get a second quote for the chairs", done: true },
  { text: "Tell Marco the cap needs CHF 260 more" },
  { text: "Book the lift for the delivery day" },
];

const WINDOWS = [
  { title: "Office move budget", app: "Numbers", bar: "bg-[#2fb457]" },
  { title: "Quote 2026-114 from Rieder", app: "Mail", bar: "bg-[#2d8cff]" },
  {
    title: "rieder-moebel.ch: Delivery dates",
    app: "Safari",
    bar: "bg-[#2d8cff]",
  },
];

const Card = ({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) => (
  <div
    className={cn(
      "app-ui light shadow-card absolute top-8 left-1/2 w-[300px] -translate-x-1/2 rounded-xl bg-white p-3 sm:top-10 sm:w-[320px]",
      className
    )}
  >
    {children}
  </div>
);

const CardLabel = ({
  icon,
  children,
  end,
}: {
  icon: Parameters<typeof Icon>[0]["icon"];
  children: string;
  end?: string;
}) => (
  <p className="text-muted-foreground flex items-center gap-2 px-1 pb-2 text-sm font-medium">
    <Icon icon={icon} size={16} />
    {children}
    {end !== undefined && (
      <span className="ml-auto font-normal tabular-nums">{end}</span>
    )}
  </p>
);

const Steps = () => (
  <Card>
    <CardLabel icon={CheckListIcon} end="2/4">
      Next steps
    </CardLabel>
    <ul className="bg-muted/60 rounded-lg border px-2.5 py-1.5">
      {STEPS.map((step) => (
        <li
          key={step.text}
          className="flex items-start gap-2.5 py-1.5 text-[13px] leading-[18px]"
        >
          <CheckCircle checked={step.done} className="mt-px" />
          <span
            className={cn(
              step.done === true && "text-muted-foreground line-through"
            )}
          >
            {step.text}
          </span>
        </li>
      ))}
    </ul>
  </Card>
);

// Today's date only exists in the browser; the static page renders without it.
const useToday = (): Date | null => {
  const day = useBrowserValue<string | null>(
    () => new Date().toDateString(),
    null
  );

  return day === null ? null : new Date(day);
};

const Due = () => {
  const today = useToday();
  const [choice, setChoice] = useState<DueChoice | null>("today");
  const due = today === null || choice === null ? null : dueFor(choice, today);

  return (
    <>
      <ul className="app-ui light absolute top-6 left-1/2 w-[280px] -translate-x-1/2">
        <li className="bg-background shadow-card flex items-start gap-3 rounded-lg px-3 py-2.5">
          <CheckCircle className="mt-0.5" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <p className="truncate text-sm leading-5">
              Book the lift for the delivery day
            </p>
            <p
              aria-live="polite"
              className="text-muted-foreground flex h-5 items-center gap-1 text-xs"
            >
              {today !== null && (
                <span className="ml-auto">
                  {due === null ? (
                    "No due date"
                  ) : (
                    <Badge
                      icon={Calendar03Icon}
                      tone={choice === "today" ? "today" : "plain"}
                    >
                      {chipText(due, today)}
                    </Badge>
                  )}
                </span>
              )}
            </p>
          </div>
        </li>
      </ul>
      <MenuCard className="absolute top-[96px] left-1/2 w-[280px] -translate-x-1/2">
        <div className="text-muted-foreground flex items-center justify-between px-2 pt-1.5 pb-1 text-xs">
          Due
          <span className="bg-muted rounded-md px-1.5 py-0.5 tracking-wide">
            ⇧⌘D
          </span>
        </div>
        {DUE_CHOICES.map((option) => (
          <MenuItem
            key={option.choice}
            keys={today === null ? "" : menuDate(dueFor(option.choice, today))}
            active={option.choice === choice}
            pressed={option.choice === choice}
            onSelect={() => {
              setChoice(option.choice);
            }}
          >
            {option.label}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem icon={Calendar03Icon}>Pick a date…</MenuItem>
        <MenuItem
          icon={CalendarRemove01Icon}
          tone="destructive"
          onSelect={() => {
            setChoice(null);
          }}
        >
          Clear
        </MenuItem>
      </MenuCard>
    </>
  );
};

const Windows = () => {
  const [reopenedAt, setReopenedAt] = useExpiringState<number>(900);
  const reopening = reopenedAt !== null;

  return (
    <Card>
      <p className="text-muted-foreground flex items-center justify-between px-1 pb-2 text-sm font-medium">
        Linked windows
        <button
          type="button"
          onClick={() => {
            setReopenedAt(Date.now());
          }}
          className="bg-muted text-foreground hover:bg-foreground/10 focus-visible:ring-ring/50 rounded-md px-2 py-0.5 text-xs transition-colors outline-none focus-visible:ring-3 focus-visible:outline-none"
        >
          Reopen all
        </button>
      </p>
      <ul className="bg-muted/60 grid grid-cols-[minmax(0,1fr)] gap-2.5 rounded-lg border p-2.5 [&>li:nth-child(2)]:[animation-delay:90ms] [&>li:nth-child(3)]:[animation-delay:180ms]">
        {WINDOWS.map((window) => (
          <li
            key={window.title}
            className={cn(
              "-m-1 flex items-center gap-2.5 rounded-md p-1 transition-colors",
              reopening &&
                "bg-white shadow-sm motion-safe:animate-[lift_0.55s_ease-out_both]"
            )}
          >
            <span className="relative h-8 w-12 shrink-0 overflow-hidden rounded-[5px] border bg-white">
              <span
                className={cn("absolute inset-x-0 top-0 h-1.5", window.bar)}
              />
              <span className="absolute top-3 left-1.5 h-1 w-6 rounded-full bg-neutral-200" />
              <span className="absolute top-5 left-1.5 h-1 w-8 rounded-full bg-neutral-200" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">
                {window.title}
              </span>
              <span className="text-muted-foreground block truncate text-xs">
                {window.app}
              </span>
            </span>
            <Icon icon={ArrowUpRight01Icon} size={15} />
          </li>
        ))}
      </ul>
    </Card>
  );
};

const MARKDOWN = `Rieder's quote breaks the furniture cap
https://rieder-moebel.ch/quote

- [x] Get a second quote for the chairs
- [ ] Book the lift for the delivery day
Due: 2026-11-25`;

const CopyDetails = () => {
  const [copiedAt, setCopiedAt] = useExpiringState<number>(1500);
  const copied = copiedAt !== null;

  const copy = async () => {
    await navigator.clipboard.writeText(MARKDOWN);
    setCopiedAt(Date.now());
  };

  return (
    <>
      <MenuCard className="absolute top-8 left-1/2 z-10 w-[236px] -translate-x-[70%] max-lg:left-3 max-lg:translate-x-0 sm:top-10">
        <div aria-hidden="true">
          <MenuItem icon={Copy01Icon} keys="⌘C">
            Copy
          </MenuItem>
        </div>
        <MenuItem
          icon={copied ? Tick02Icon : Copy01Icon}
          keys="⌥⌘C"
          active
          onSelect={() => {
            void copy().catch(() => {
              // Without clipboard access nothing was copied, so the label stays.
            });
          }}
        >
          <span aria-live="polite">
            {copied ? "Copied" : "Copy with Details"}
          </span>
        </MenuItem>
        <div aria-hidden="true">
          <MenuItem icon={Link01Icon}>Copy with Link</MenuItem>
        </div>
      </MenuCard>
      <pre className="shadow-card absolute top-[128px] left-1/2 w-[300px] -translate-x-[36%] rounded-xl bg-white p-3.5 font-mono text-[11px] leading-[1.65] whitespace-pre-wrap text-neutral-700 max-lg:right-3 max-lg:left-auto max-lg:w-[min(300px,calc(100%-24px))] max-lg:translate-x-0 sm:top-[132px]">
        {MARKDOWN}
      </pre>
    </>
  );
};

export const Details = () => (
  <Section id="details" aria-labelledby="details-h">
    <SectionIntro
      id="details-h"
      eyebrow="Details"
      href="/docs/sections-and-due-dates"
      title="Next steps and due dates, when you want them."
      lead="Any item can hold a description, a checklist, a due date and linked windows. None of it is asked for when you capture."
    />
    <div className="mt-14 grid gap-4 md:mt-16 md:grid-cols-2">
      <Tile
        title="Next steps"
        line="A checklist under the item, with its progress on the source line."
        stageClassName="sm:h-[340px]"
      >
        <Steps />
      </Tile>
      <Tile
        interactive
        title="Due dates"
        line="Today, tomorrow, this weekend or a date you pick. Overdue items turn red."
        stageClassName="h-[340px] sm:h-[340px]"
      >
        <Due />
      </Tile>
      <Tile
        interactive
        title="Linked windows"
        line="Pick open windows in order, and Reopen all brings the whole set back."
        stageClassName="sm:h-[290px]"
      >
        <Windows />
      </Tile>
      <Tile
        interactive
        title="Copy with Details"
        line="Copies the item as Markdown, with its steps, due date and linked windows."
        stageClassName="sm:h-[290px]"
      >
        <CopyDetails />
      </Tile>
    </div>
  </Section>
);

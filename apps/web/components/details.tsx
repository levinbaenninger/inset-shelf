import {
  ArrowUpRight01Icon,
  Calendar03Icon,
  CalendarRemove01Icon,
  CheckListIcon,
  Copy01Icon,
  Link01Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "@inset/ui/lib/utils";

import { REPO_URL } from "@/lib/site";

import { CheckCircle, Icon, MenuCard, MenuItem, MenuSeparator } from "./app-ui";
import { Section, SectionIntro, Tile } from "./section";

// The details view's own sample (scripts/screens.ts): an item about a furniture quote.
const STEPS = [
  { text: "Ask Rieder whether 21 November is possible", done: true },
  { text: "Get a second quote for the chairs", done: true },
  { text: "Tell Marco the cap needs CHF 260 more" },
  { text: "Book the lift for the delivery day" },
];

const DUE = [
  ["Today", "Wed, Nov 25"],
  ["Tomorrow", "Thu, Nov 26"],
  ["This weekend", "Sat, Nov 28"],
  ["Next week", "Mon, Nov 30"],
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
  children: React.ReactNode;
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

const Due = () => (
  <MenuCard className="absolute top-8 left-1/2 w-[280px] -translate-x-1/2 sm:top-10">
    <div className="text-muted-foreground flex items-center justify-between px-2 pt-1.5 pb-1 text-xs">
      Due
      <span className="bg-muted rounded-md px-1.5 py-0.5 tracking-wide">
        ⇧⌘D
      </span>
    </div>
    {DUE.map(([label, date], index) => (
      <MenuItem key={label} keys={date} active={index === 0}>
        {label}
      </MenuItem>
    ))}
    <MenuSeparator />
    <MenuItem icon={Calendar03Icon}>Pick a date…</MenuItem>
    <MenuItem icon={CalendarRemove01Icon} tone="destructive">
      Clear
    </MenuItem>
  </MenuCard>
);

const Windows = () => (
  <Card>
    <p className="text-muted-foreground flex items-center justify-between px-1 pb-2 text-sm font-medium">
      Linked windows
      <span className="bg-muted text-foreground rounded-md px-2 py-0.5 text-xs">
        Reopen all
      </span>
    </p>
    <ul className="bg-muted/60 grid grid-cols-[minmax(0,1fr)] gap-2.5 rounded-lg border p-2.5">
      {WINDOWS.map((window) => (
        <li key={window.title} className="flex items-center gap-2.5">
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

const CopyDetails = () => (
  <>
    <MenuCard className="absolute top-8 left-1/2 z-10 w-[236px] -translate-x-[70%] sm:top-10">
      <MenuItem icon={Copy01Icon} keys="⌘C">
        Copy
      </MenuItem>
      <MenuItem icon={Copy01Icon} keys="⌥⌘C" active>
        Copy with Details
      </MenuItem>
      <MenuItem icon={Link01Icon}>Copy with Link</MenuItem>
    </MenuCard>
    <pre className="shadow-card absolute top-[128px] left-1/2 w-[300px] -translate-x-[36%] rounded-xl bg-white p-3.5 font-mono text-[11px] leading-[1.65] whitespace-pre-wrap text-neutral-700 sm:top-[132px]">
      {`Rieder's quote breaks the furniture cap
https://rieder-moebel.ch/quote

- [x] Get a second quote for the chairs
- [ ] Book the lift for the delivery day
Due: 2026-11-25`}
    </pre>
  </>
);

export const Details = () => (
  <Section id="details" aria-labelledby="details-h">
    <SectionIntro
      id="details-h"
      eyebrow="Details"
      href={`${REPO_URL}#use-it`}
      title="Next steps and due dates, when you want them."
      lead="Any item can hold a description, a checklist, a due date and linked windows. None of it is asked for when you capture."
    />
    <div className="mt-14 grid gap-4 md:mt-16 md:grid-cols-2">
      <Tile
        title="Next steps"
        line="A checklist under the item, with its progress on the source line."
        stageClassName="sm:h-[290px]"
      >
        <Steps />
      </Tile>
      <Tile
        title="Due dates"
        line="Today, tomorrow, this weekend or a date you pick. Overdue items turn red."
        stageClassName="sm:h-[290px]"
      >
        <Due />
      </Tile>
      <Tile
        title="Linked windows"
        line="Pick open windows in order, and Reopen all brings the whole set back."
        stageClassName="sm:h-[290px]"
      >
        <Windows />
      </Tile>
      <Tile
        title="Copy with Details"
        line="Copies the item as Markdown, with its steps, due date and linked windows."
        stageClassName="sm:h-[290px]"
      >
        <CopyDetails />
      </Tile>
    </div>
  </Section>
);

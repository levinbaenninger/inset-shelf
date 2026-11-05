import {
  AppWindowIcon,
  Calendar03Icon,
  CalendarRemove01Icon,
  CheckListIcon,
  Location01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  dateText,
  DUE_CHOICE_LABEL,
  DUE_CHOICES,
  dueBucket,
  dueChipText,
  dueFor,
  dueText,
  parseDay,
} from "@shared/due";
import type { DueBucket } from "@shared/due";
import { insetUrl } from "@shared/inset-url";
import type { Pin, ShelfItem, Step, WindowRef } from "@shared/shelf";
import { keyText } from "@shared/shortcut";
import type { ReactNode } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { PinGlyph } from "@/shared/pin-marker";
import { isMac } from "@/shared/platform";

const BADGE_TONE: Readonly<Record<DueBucket | "plain", string>> = {
  later: "bg-foreground/[0.06] text-muted-foreground",
  overdue: "bg-destructive/12 text-destructive",
  plain: "bg-foreground/[0.06] text-muted-foreground",
  today: "bg-pin/14 text-pin-ink dark:bg-pin/22",
  week: "bg-foreground/[0.06] text-muted-foreground",
};

/** The Due chip's tint: red once overdue, the accent when due today. */
export const dueTone = (due: string, now: Date): string =>
  BADGE_TONE[dueBucket(due, now)];

/** A small rounded tag, the one chip style the shelf uses for metadata. */
export const Badge = ({
  children,
  className,
  icon,
  label,
  tone = "plain",
}: {
  readonly children: ReactNode;
  readonly icon: typeof Calendar03Icon;
  /** Said by assistive technology in place of the terse text. */
  readonly label: string;
  readonly tone?: DueBucket | "plain";
  readonly className?: string;
}) => (
  <span
    className={cn(
      "inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs leading-none font-medium whitespace-nowrap tabular-nums",
      BADGE_TONE[tone],
      className
    )}
    title={label}
  >
    <HugeiconsIcon
      aria-hidden="true"
      className="shrink-0"
      icon={icon}
      size={11}
      strokeWidth={2}
    />
    <span aria-hidden="true">{children}</span>
    <span className="sr-only">{label}</span>
  </span>
);

/** The Due chip as said aloud: the full date, not only the relative word. */
export const dueLabel = (due: string, now: Date): string => {
  const day = parseDay(due);
  const date = day === null ? due : dateText(day, now, { weekday: true });

  return dueBucket(due, now) === "overdue"
    ? `Overdue, was due ${date}`
    : `Due ${dueText(due, now)}, ${date}`;
};

/** The Due chip: "Overdue · Nov 3" in red once overdue, in the accent when due today. */
export const DueBadge = ({
  due,
  now,
}: {
  readonly due: string;
  readonly now: Date;
}) => (
  <Badge
    icon={Calendar03Icon}
    label={dueLabel(due, now)}
    tone={dueBucket(due, now)}
  >
    {dueChipText(due, now)}
  </Badge>
);

const stepsDone = (steps: readonly Step[]): number =>
  steps.filter((step) => step.done).length;

/** Steps that hold words; an empty one being typed doesn't count. */
export const filledSteps = (steps: readonly Step[]): readonly Step[] =>
  steps.filter((step) => step.text.trim() !== "");

/**
 * The badges on an item's source line, at most three, most telling first:
 * due, step progress, linked windows, pins. A description has none. An open
 * row lists its steps and windows, so it leaves out their counts.
 */
export const metaBadges = (
  item: ShelfItem,
  now: Date,
  open = false
): readonly ReactNode[] => {
  const steps = open ? [] : filledSteps(item.steps);
  const pins = item.kind === "image" ? item.pins.length : 0;

  return [
    item.due === null ? null : <DueBadge due={item.due} key="due" now={now} />,
    steps.length === 0 ? null : (
      <Badge
        icon={CheckListIcon}
        key="steps"
        label={`${stepsDone(steps)} of ${steps.length} steps done`}
      >
        {stepsDone(steps)}/{steps.length}
      </Badge>
    ),
    open || item.windows.length === 0 ? null : (
      <Badge
        icon={AppWindowIcon}
        key="windows"
        label={
          item.windows.length === 1
            ? "1 linked window"
            : `${item.windows.length} linked windows`
        }
      >
        {item.windows.length}
      </Badge>
    ),
    pins === 0 ? null : (
      <Badge
        icon={Location01Icon}
        key="pins"
        label={pins === 1 ? "1 pin" : `${pins} pins`}
      >
        {pins}
      </Badge>
    ),
  ]
    .filter((badge) => badge !== null)
    .slice(0, 3);
};

/** Checkable next steps, inline in the open row: ticking one never leaves the list. */
export const StepChecklist = ({
  onToggle,
  steps,
}: {
  readonly steps: readonly Step[];
  readonly onToggle: (step: Step) => void;
}) => (
  <ul aria-label="Next steps" className="flex flex-col">
    {filledSteps(steps).map((step) => (
      <li className="flex min-h-6 items-start gap-2 py-0.5" key={step.id}>
        <Checkbox
          aria-label={
            step.done ? `Not done: ${step.text}` : `Done: ${step.text}`
          }
          checked={step.done}
          className="mt-0.5 size-3.5"
          onCheckedChange={() => {
            onToggle(step);
          }}
        />
        <span
          className={cn(
            "min-w-0 text-sm leading-snug break-words",
            step.done && "text-muted-foreground line-through"
          )}
        >
          {step.text}
        </span>
      </li>
    ))}
  </ul>
);

/** The labelled pins under an image, as "1 · label"; unlabelled pins are left out. */
export const PinLegend = ({ pins }: { readonly pins: readonly Pin[] }) => (
  <ol aria-label="Pin labels" className="flex flex-col gap-1">
    {pins.map((pin, index) =>
      pin.label === undefined ? null : (
        // oxlint-disable-next-line react/no-array-index-key -- a pin's place is its number.
        <li className="flex min-w-0 items-center gap-1.5 text-sm" key={index}>
          <PinGlyph height={15} number={index + 1} />
          <span className="min-w-0 truncate">{pin.label}</span>
        </li>
      )
    )}
  </ol>
);

/**
 * Says what reopening a window does: it opens its page or file when it
 * knows one. Elsewhere than macOS starting the app opens a new window of
 * it, so it says so.
 */
export const reopenLabel = (window: WindowRef): string => {
  if (window.url !== null) {
    return "Open page";
  }

  if (window.document !== null) {
    return "Open file";
  }

  return isMac ? "Bring app forward" : "Open app";
};

export const windowName = (window: WindowRef): string =>
  window.title ?? window.app ?? "Window";

/** A linked window's picture, or its app's initial where there is none. */
export const WindowThumb = ({
  className,
  window,
}: {
  readonly window: WindowRef;
  readonly className?: string;
}) => (
  <span
    className={cn(
      "bg-muted after:ring-foreground/10 relative block shrink-0 overflow-hidden rounded-md after:pointer-events-none after:absolute after:inset-0 after:rounded-md after:ring-1 after:ring-inset",
      className
    )}
  >
    {window.thumb === null ? (
      <span className="text-muted-foreground flex size-full items-center justify-center text-xs font-medium">
        {(window.app ?? "?").slice(0, 1)}
      </span>
    ) : (
      <img
        alt=""
        className="size-full object-cover object-top"
        draggable={false}
        src={insetUrl.attachment(window.thumb.file)}
      />
    )}
  </span>
);

/** The linked windows as a strip of small pictures; each reopens its window. */
export const WindowStrip = ({
  onReopen,
  windows,
}: {
  readonly windows: readonly WindowRef[];
  readonly onReopen: (window: WindowRef) => void;
}) => (
  <ul aria-label="Linked windows" className="flex flex-wrap gap-1.5">
    {windows.map((window) => (
      <li key={window.id}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label={`${reopenLabel(window)}: ${windowName(window)}`}
              className="focus-visible:ring-ring/50 block rounded-md outline-none hover:opacity-85 focus-visible:ring-3"
              onClick={() => {
                onReopen(window);
              }}
              type="button"
            >
              <WindowThumb className="h-10 w-16" window={window} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {reopenLabel(window)} · {windowName(window)}
          </TooltipContent>
        </Tooltip>
      </li>
    ))}
  </ul>
);

/** A quick choice's day, right of its name: "Sat, Nov 7". */
const dayHint = (iso: string, now: Date): string => {
  const day = parseDay(iso);

  return day === null ? iso : dateText(day, now, { weekday: true });
};

/**
 * The Due picker: the quick days, a date of one's own, or none. `children`
 * is the trigger; the menu can also be opened from outside (⌘⇧D).
 */
export const DueMenu = ({
  children,
  due,
  now,
  onOpenChange,
  onPickDate,
  onSet,
  open,
}: {
  readonly children: ReactNode;
  readonly due: string | null;
  readonly now: Date;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSet: (due: string | null) => void;
  /** Pick a date…: the shelf shows a date field. */
  readonly onPickDate: () => void;
}) => (
  <DropdownMenu modal={false} onOpenChange={onOpenChange} open={open}>
    <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="min-w-52">
      <DropdownMenuLabel className="flex items-center justify-between">
        Due
        <Kbd>{keyText("Shift+CommandOrControl+D", isMac)}</Kbd>
      </DropdownMenuLabel>
      {DUE_CHOICES.map((choice) => {
        const day = dueFor(choice, now);

        return (
          <DropdownMenuItem
            key={choice}
            onSelect={() => {
              onSet(day);
            }}
          >
            {DUE_CHOICE_LABEL[choice]}
            <DropdownMenuShortcut>{dayHint(day, now)}</DropdownMenuShortcut>
          </DropdownMenuItem>
        );
      })}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={onPickDate}>
        <HugeiconsIcon icon={Calendar03Icon} />
        Pick a date…
      </DropdownMenuItem>
      {due === null ? null : (
        <DropdownMenuItem
          onSelect={() => {
            onSet(null);
          }}
          variant="destructive"
        >
          <HugeiconsIcon icon={CalendarRemove01Icon} />
          Clear
        </DropdownMenuItem>
      )}
    </DropdownMenuContent>
  </DropdownMenu>
);

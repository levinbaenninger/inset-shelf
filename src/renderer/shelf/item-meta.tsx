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
  dueFor,
  dueText,
  isoDay,
  parseDay,
  weekStartDay,
} from "@shared/due";
import type { DueBucket } from "@shared/due";
import { insetUrl } from "@shared/inset-url";
import type { Pin, Step, WindowRef } from "@shared/shelf";
import { keyText } from "@shared/shortcut";
import { useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";

import { Calendar } from "@/components/ui/calendar";
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
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { PinGlyph } from "@/shared/pin-marker";
import { isMac } from "@/shared/platform";

import { filledSteps } from "./row-parts";
import type { RowBadge } from "./row-parts";

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

/**
 * The Due chip on a row: "Overdue" in red once overdue, the day in the
 * accent when due today, else the day. Its title and label give the date.
 */
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
    {dueBucket(due, now) === "overdue" ? "Overdue" : dueText(due, now)}
  </Badge>
);

/** The counted badges: an icon, the number, and the words said aloud. */
const COUNTED = {
  pins: { icon: Location01Icon, many: "pins", one: "pin" },
  windows: {
    icon: AppWindowIcon,
    many: "linked windows",
    one: "linked window",
  },
} as const;

const badgeNode = (badge: RowBadge, now: Date): ReactElement => {
  if (badge.kind === "due") {
    return <DueBadge due={badge.due} key="due" now={now} />;
  }

  if (badge.kind === "steps") {
    return (
      <Badge
        icon={CheckListIcon}
        key="steps"
        label={`${badge.done} of ${badge.total} steps done`}
      >
        {badge.done}/{badge.total}
      </Badge>
    );
  }

  const { icon, many, one } = COUNTED[badge.kind];

  return (
    <Badge
      icon={icon}
      key={badge.kind}
      label={badge.count === 1 ? `1 ${one}` : `${badge.count} ${many}`}
    >
      {badge.count}
    </Badge>
  );
};

/** A row's badges (row-parts.ts), as chips. */
export const badgeNodes = (
  badges: readonly RowBadge[],
  now: Date
): readonly ReactElement[] => badges.map((badge) => badgeNode(badge, now));

/** Checkable next steps, inline in the open row: ticking one never leaves the list. Each shows two lines at most. */
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
        {/* Two lines in the row; details show the whole step. */}
        <span
          className={cn(
            "line-clamp-2 min-w-0 text-sm leading-snug break-words",
            step.done && "text-muted-foreground line-through"
          )}
          title={step.text}
        >
          {step.text}
        </span>
      </li>
    ))}
  </ul>
);

/** The labelled pins under an image, as "1 · label"; unlabelled pins are left out. */
export const PinLegend = ({
  pins,
  shown,
}: {
  readonly pins: readonly Pin[];
  /** How many labelled pins to list. */
  readonly shown: number;
}) => (
  <ol aria-label="Pin labels" className="flex flex-col gap-1">
    {pins
      .flatMap((pin, index) =>
        pin.label === undefined ? [] : [{ label: pin.label, number: index + 1 }]
      )
      .slice(0, shown)
      .map(({ label, number }) => (
        <li className="flex min-w-0 items-center gap-1.5 text-sm" key={number}>
          <PinGlyph height={15} number={number} />
          <span className="min-w-0 truncate" title={label}>
            {label}
          </span>
        </li>
      ))}
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

const CAPTION = new Intl.DateTimeFormat(undefined, {
  month: "long",
  year: "numeric",
});

const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: "narrow" });

const FULL_DATE = new Intl.DateTimeFormat(undefined, { dateStyle: "full" });

const WEEK_START = weekStartDay();

/**
 * The Due picker: the quick days, a date of one's own, or none. Pick a
 * date… opens a calendar under the same trigger, where the arrows move, Return
 * picks and Esc closes back to the trigger. `children` is the trigger; the
 * menu can also be opened from outside (⌘⇧D).
 */
export const DueMenu = ({
  children,
  due,
  now,
  onOpenChange,
  onSet,
  open,
}: {
  readonly children: ReactNode;
  readonly due: string | null;
  readonly now: Date;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSet: (due: string | null) => void;
}) => {
  const [calendar, setCalendar] = useState(false);
  // Pick a date… opens the calendar once the menu has closed, so the menu doesn't take focus back to the trigger.
  const pickDate = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  // A press outside closed the calendar: the keyboard goes where that press aims, not back to Due.
  const pressedOutside = useRef(false);

  // The trigger may be a new one by now: Set Due becomes the chip once a day is picked.
  const toDue = (): void => {
    trigger.current?.focus();
  };

  const day = due === null ? undefined : (parseDay(due) ?? undefined);

  return (
    <Popover onOpenChange={setCalendar} open={calendar}>
      <DropdownMenu modal={false} onOpenChange={onOpenChange} open={open}>
        <PopoverAnchor asChild>
          <DropdownMenuTrigger asChild ref={trigger}>
            {children}
          </DropdownMenuTrigger>
        </PopoverAnchor>
        <DropdownMenuContent
          align="start"
          className="min-w-52"
          onCloseAutoFocus={(event) => {
            if (pickDate.current) {
              event.preventDefault();
              pickDate.current = false;
              setCalendar(true);
            }
          }}
        >
          <DropdownMenuLabel className="flex items-center justify-between">
            Due
            <Kbd>{keyText("Shift+CommandOrControl+D", isMac)}</Kbd>
          </DropdownMenuLabel>
          {DUE_CHOICES.map((choice) => {
            const choiceDay = dueFor(choice, now);

            return (
              <DropdownMenuItem
                key={choice}
                onSelect={() => {
                  onSet(choiceDay);
                }}
              >
                {DUE_CHOICE_LABEL[choice]}
                <DropdownMenuShortcut>
                  {dayHint(choiceDay, now)}
                </DropdownMenuShortcut>
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              pickDate.current = true;
            }}
          >
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
      <PopoverContent
        align="start"
        aria-label="Pick a Due date"
        // The calendar focuses its own day: the Due date, else today.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          pressedOutside.current = false;
        }}
        onPointerDownOutside={() => {
          pressedOutside.current = true;
        }}
        size="fit"
        onCloseAutoFocus={(event) => {
          event.preventDefault();

          // A press elsewhere aims the keyboard there, and the field it hits takes it only after
          // this runs. So wait a frame: only when nothing took it (empty space, plain text) does it
          // go back to Due, as after Escape or a pick.
          if (pressedOutside.current) {
            pressedOutside.current = false;
            requestAnimationFrame(() => {
              setTimeout(() => {
                if (
                  document.activeElement === null ||
                  document.activeElement === document.body
                ) {
                  toDue();
                }
              }, 0);
            });

            return;
          }

          toDue();
        }}
      >
        <Calendar
          autoFocus
          defaultMonth={day ?? now}
          formatters={{
            formatCaption: (month) => CAPTION.format(month),
            formatWeekdayName: (weekday) => WEEKDAY.format(weekday),
          }}
          labels={{
            labelDayButton: (date, modifiers) =>
              [
                FULL_DATE.format(date),
                modifiers.today === true ? "today" : "",
                modifiers.selected === true ? "selected" : "",
              ]
                .filter((part) => part !== "")
                .join(", "),
            labelGrid: (month) => CAPTION.format(month),
          }}
          mode="single"
          onSelect={(picked) => {
            if (picked !== undefined) {
              onSet(isoDay(picked));
            }

            setCalendar(false);
          }}
          selected={day}
          today={now}
          weekStartsOn={WEEK_START}
        />
      </PopoverContent>
    </Popover>
  );
};

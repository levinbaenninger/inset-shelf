import {
  AppWindowIcon,
  ArrowDown01Icon,
  ArrowUpRight01Icon,
  Calendar03Icon,
  Cancel01Icon,
  ChatGptIcon,
  CheckListIcon,
  ClaudeIcon,
  Download01Icon,
  File01Icon,
  FigmaIcon,
  FilterHorizontalIcon,
  GithubIcon,
  Link01Icon,
  MoreHorizontalIcon,
  PaintBrush01Icon,
  PinIcon,
  PlusSignIcon,
  Search01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import { cn } from "@inset/ui/lib/utils";
import type { ComponentProps, CSSProperties, ReactNode } from "react";

// Drawn parts of the app, with the renderer's own class names (apps/desktop/src/renderer/shelf), inside `.app-ui.light`.

export type Service = "github" | "claude" | "chatgpt" | "figma" | "link";

const SERVICE_ICON: Record<Service, IconSvgElement> = {
  chatgpt: ChatGptIcon,
  claude: ClaudeIcon,
  figma: FigmaIcon,
  github: GithubIcon,
  link: Link01Icon,
};

type Tone = "plain" | "today" | "overdue";

const BADGE_TONE: Record<Tone, string> = {
  plain: "bg-foreground/[0.06] text-muted-foreground",
  today: "bg-pin/14 text-pin-ink",
  overdue: "bg-destructive/12 text-destructive",
};

export interface ShelfItem {
  text: string;
  /** `active`: under the pointer, as the source line looks on hover. */
  source?: { service: Service; label: string; active?: boolean };
  due?: { label: string; tone: Tone };
  steps?: string;
  windows?: number;
  file?: string;
  done?: boolean;
  selected?: boolean;
}

export const Icon = ({
  icon,
  size = 16,
  className,
  strokeWidth,
}: {
  icon: IconSvgElement;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) => (
  <HugeiconsIcon
    icon={icon}
    size={size}
    strokeWidth={strokeWidth}
    className={cn("shrink-0", className)}
    aria-hidden="true"
  />
);

export const TrafficLights = ({ className }: { className?: string }) => (
  <span className={cn("flex gap-2", className)}>
    <i className="size-3 rounded-full border border-black/10 bg-[#ff5f57]" />
    <i className="size-3 rounded-full border border-black/10 bg-[#febc2e]" />
    <i className="size-3 rounded-full border border-black/10 bg-[#28c840]" />
  </span>
);

export const CheckCircle = ({
  checked = false,
  className,
}: {
  checked?: boolean;
  className?: string;
}) =>
  checked ? (
    <span
      className={cn(
        "bg-primary text-primary-foreground flex size-4 shrink-0 items-center justify-center rounded-full",
        className
      )}
    >
      <Icon icon={Tick02Icon} size={11} strokeWidth={2.5} />
    </span>
  ) : (
    <span
      className={cn(
        "border-input bg-background size-4 shrink-0 rounded-full border",
        className
      )}
    />
  );

export const Badge = ({
  icon,
  tone = "plain",
  children,
}: {
  icon: IconSvgElement;
  tone?: Tone;
  children: ReactNode;
}) => (
  <span
    className={cn(
      "inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs leading-none font-medium whitespace-nowrap tabular-nums",
      BADGE_TONE[tone]
    )}
  >
    <Icon icon={icon} size={11} strokeWidth={2} />
    {children}
  </span>
);

export const SourceLine = ({
  service,
  label,
  active = false,
  opens = false,
  className,
}: {
  service: Service;
  label: string;
  active?: boolean;
  /** Ends in the arrow the line shows under the pointer, where a click opens the page. */
  opens?: boolean;
  className?: string;
}) => (
  <span
    className={cn(
      "flex min-w-0 items-center gap-1 text-xs",
      active ? "text-foreground" : "text-muted-foreground",
      className
    )}
  >
    <Icon icon={SERVICE_ICON[service]} size={12} />
    <span className="truncate">{label}</span>
    {opens && <Icon icon={ArrowUpRight01Icon} size={12} />}
  </span>
);

export const ShelfRow = ({
  item,
  onToggle,
  className,
}: {
  item: ShelfItem;
  /** Makes the circle a real checkbox, and the source line answer the pointer as the app's does. */
  onToggle?: () => void;
  className?: string;
}) => {
  const live = onToggle !== undefined;

  const hasMeta =
    item.source !== undefined ||
    item.file !== undefined ||
    item.due !== undefined ||
    item.steps !== undefined ||
    item.windows !== undefined;

  return (
    <li
      className={cn(
        "bg-background/60 relative flex items-start gap-3 rounded-lg border px-3 py-2.5",
        item.selected === true ? "border-primary" : "border-foreground/10",
        live && "group transition-colors",
        live && item.selected !== true && "hover:border-foreground/20",
        className
      )}
    >
      {live ? (
        <label className="has-focus-visible:ring-ring/50 relative mt-0.5 flex shrink-0 cursor-pointer rounded-full has-focus-visible:ring-3">
          <input
            type="checkbox"
            checked={item.done === true}
            onChange={onToggle}
            aria-label={`Check off: ${item.text}`}
            className="sr-only"
          />
          <CheckCircle checked={item.done} />
        </label>
      ) : (
        <CheckCircle checked={item.done} className="mt-0.5" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p
          className={cn(
            "line-clamp-2 text-sm leading-5 transition-colors",
            item.file !== undefined && "font-medium",
            item.done === true && "text-muted-foreground line-through"
          )}
        >
          {item.text}
        </p>
        {hasMeta && (
          <div className="flex min-w-0 items-center gap-2">
            {item.file === undefined ? (
              item.source !== undefined && (
                <SourceLine
                  {...item.source}
                  className={cn(
                    "flex-1",
                    live &&
                      "group-hover:text-foreground transition-colors [&>svg:last-child]:opacity-0 group-hover:[&>svg:last-child]:opacity-100"
                  )}
                  opens={live}
                />
              )
            ) : (
              <span className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                <Icon
                  icon={File01Icon}
                  size={16}
                  className="text-muted-foreground"
                />
                <span className="truncate">{item.file}</span>
              </span>
            )}
            <span className="ml-auto flex shrink-0 gap-1">
              {item.due && (
                <Badge icon={Calendar03Icon} tone={item.due.tone}>
                  {item.due.label}
                </Badge>
              )}
              {item.steps !== undefined && (
                <Badge icon={CheckListIcon}>{item.steps}</Badge>
              )}
              {item.windows !== undefined && (
                <Badge icon={AppWindowIcon}>{item.windows}</Badge>
              )}
            </span>
          </div>
        )}
      </div>
    </li>
  );
};

export const SectionHeader = ({
  name,
  current = false,
}: {
  name: string;
  current?: boolean;
}) => (
  <div className="flex h-9 items-center gap-0.5 pt-1">
    <span className="text-muted-foreground flex size-6 items-center justify-center">
      <Icon icon={ArrowDown01Icon} size={14} />
    </span>
    <span className="truncate text-sm font-medium">{name}</span>
    <span className="bg-foreground/10 ml-1 h-px min-w-4 flex-1" />
    <span className="flex size-7 shrink-0 items-center justify-center">
      {current ? (
        <span className="bg-pin size-2 rounded-full" />
      ) : (
        <span className="border-muted-foreground/60 size-2 rounded-full border" />
      )}
    </span>
  </div>
);

export const ShelfSearch = () => (
  <div className="flex items-center gap-1 px-2 pt-2 pb-1">
    <div className="border-input bg-background/40 text-muted-foreground flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border px-2.5 text-sm">
      <Icon icon={Search01Icon} size={16} />
      <span className="flex-1 truncate">Search or due:today</span>
      <Icon icon={FilterHorizontalIcon} size={16} />
    </div>
    <span className="flex size-8 items-center justify-center">
      <Icon icon={MoreHorizontalIcon} size={16} />
    </span>
    <span className="flex size-8 items-center justify-center">
      <Icon icon={Cancel01Icon} size={16} />
    </span>
  </div>
);

export const ShelfComposer = () => (
  <div className="px-2 pt-1 pb-2">
    <div className="border-input bg-background/40 text-muted-foreground flex h-9 items-center gap-2 rounded-lg border px-2.5 text-sm ring-3 ring-[oklch(0.708_0_0/0.4)]">
      <Icon icon={PlusSignIcon} size={16} />
      Jot down a thought…
    </div>
  </div>
);

// The shelf's window: the macOS material (scripts/screens.ts) under the page.
export const ShelfPanel = ({
  className,
  children,
  ...props
}: ComponentProps<"div">) => (
  <div
    className={cn(
      "app-ui light bg-material flex flex-col overflow-hidden rounded-xl shadow-[0_0_0_0.5px_rgb(0_0_0/0.18),0_24px_60px_-12px_rgb(0_0_0/0.28),0_8px_20px_-8px_rgb(0_0_0/0.12)]",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

// A popover menu, as the renderer's dropdown content and items draw it.
export const MenuCard = ({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) => (
  <div
    className={cn(
      "app-ui light bg-popover text-popover-foreground ring-foreground/10 min-w-48 rounded-lg p-1 shadow-md ring-1",
      className
    )}
  >
    {children}
  </div>
);

export const MenuItem = ({
  icon,
  children,
  keys,
  tone,
  active,
  pressed,
  onSelect,
}: {
  icon?: IconSvgElement;
  children: ReactNode;
  keys?: ReactNode;
  tone?: "destructive";
  active?: boolean;
  /** Makes the entry a button. */
  onSelect?: () => void;
  /** For a choice among entries: whether this one is chosen. */
  pressed?: boolean;
}) => {
  const className = cn(
    "flex w-full items-center gap-2 rounded-md px-2 py-1.25 text-left text-sm",
    active === true && "bg-accent",
    tone === "destructive" && "text-destructive",
    onSelect !== undefined &&
      "hover:bg-accent focus-visible:ring-ring/50 outline-none focus-visible:ring-3 focus-visible:outline-none"
  );

  const content = (
    <>
      {icon && (
        <Icon
          icon={icon}
          size={16}
          className={
            tone === "destructive"
              ? "text-destructive"
              : "text-muted-foreground"
          }
        />
      )}
      <span className="flex-1 truncate">{children}</span>
      {keys !== undefined && (
        <span className="text-muted-foreground ml-auto pl-4 text-xs tracking-wide">
          {keys}
        </span>
      )}
    </>
  );

  return onSelect === undefined ? (
    <div className={className}>{content}</div>
  ) : (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onSelect}
      className={className}
    >
      {content}
    </button>
  );
};

export const MenuSeparator = () => (
  <div className="bg-border -mx-1 my-1 h-px" />
);

// A screenshot of a sign-in form, the picture inside the drawn screenshot cards.
export const SignInShot = ({ className }: { className?: string }) => (
  <div
    className={cn(
      "flex items-center justify-center bg-[linear-gradient(135deg,#eef2f7,#dfe7f1)]",
      className
    )}
  >
    <div className="grid w-[136px] gap-1.5 rounded-lg bg-white p-3 text-[9px] leading-none text-neutral-500 shadow-[0_4px_14px_rgb(15_40_80/0.12)]">
      <b className="text-[11px] font-semibold text-neutral-900">Sign in</b>
      <span className="flex h-[18px] items-center rounded border border-neutral-200 px-1.5">
        Email
      </span>
      <span className="flex h-[18px] items-center rounded border border-neutral-200 px-1.5">
        Password
      </span>
      <span className="mt-0.5 flex h-[18px] items-center justify-center rounded bg-[#1f6feb] font-medium text-white">
        Continue
      </span>
    </div>
  </div>
);

const CornerButton = ({
  icon,
  className,
}: {
  icon: IconSvgElement;
  className: string;
}) => (
  <span
    className={cn(
      "absolute flex size-8 items-center justify-center rounded-full bg-white text-neutral-900 shadow-md",
      className
    )}
  >
    <Icon icon={icon} size={16} />
  </span>
);

// The screenshot card beside the shelf (apps/desktop/src/renderer/screenshot), 280 points wide; under the pointer it
// dims and blurs behind its actions.
export const ScreenshotCard = ({
  hover = false,
  className,
}: {
  hover?: boolean;
  className?: string;
}) => (
  <div
    className={cn(
      "app-ui light bg-muted ring-foreground/10 w-[280px] overflow-hidden rounded-2xl shadow-[0_18px_40px_-12px_rgb(0_0_0/0.3)] ring-1 ring-inset",
      className
    )}
  >
    <SignInShot className={cn("absolute inset-0", hover && "blur-xs")} />
    {hover && (
      <>
        <div className="absolute inset-0 bg-black/35" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm font-medium text-neutral-900">
          <span className="flex h-8 items-center rounded-full bg-white px-4 shadow-md">
            Copy
          </span>
          <span className="flex h-8 items-center rounded-full bg-white px-4 shadow-md">
            Add to Shelf
          </span>
        </div>
        <CornerButton icon={Cancel01Icon} className="top-2.5 left-2.5" />
        <CornerButton icon={PinIcon} className="top-2.5 right-2.5" />
        <CornerButton icon={PaintBrush01Icon} className="bottom-2.5 left-2.5" />
        <CornerButton icon={Download01Icon} className="right-2.5 bottom-2.5" />
      </>
    )}
  </div>
);

// The numbered map pin, with the drawing window's own outline (apps/desktop/src/shared/pin-shape.ts).
const PIN_PATH = "M 0 0 L 6.306 -8.077 A 8 8 0 1 0 -6.306 -8.077 Z";

export type PinNumber = 1 | 2 | 3 | 4 | 5 | 6;

// digitStrokes(n) from pin-shape.ts, worked out once.
const PIN_DIGITS: Record<PinNumber, string> = {
  1: "-1.32,-14.96 0.44,-16.5 0.44,-9.5",
  2: "-2.024,-14.82 -1.232,-16.15 0.088,-16.5 1.408,-15.94 2.024,-14.4 1.496,-12.86 -2.2,-9.5 2.2,-9.5",
  3: "-2.024,-15.8 -0.44,-16.5 1.32,-16.08 1.936,-14.75 1.232,-13.42 -0.352,-13 1.32,-12.58 2.112,-11.18 1.496,-9.85 -0.264,-9.5 -2.024,-10.2",
  4: "1.232,-9.5 1.232,-16.5 -2.2,-11.74 2.2,-11.74",
  5: "1.848,-16.5 -1.496,-16.5 -1.848,-13.28 -0.176,-13.84 1.496,-13.21 2.2,-11.46 1.584,-9.99 -0.176,-9.5 -2.024,-10.2",
  6: "1.54,-16.08 0.22,-16.5 -1.1,-15.66 -1.936,-13.56 -2.024,-11.46 -1.32,-9.85 0,-9.5 1.408,-10.06 2.112,-11.74 1.496,-13.28 0.088,-13.77 -1.232,-13.21 -1.98,-12.16",
};

export const PinMark = ({
  number,
  className,
  style,
}: {
  number: PinNumber;
  className?: string;
  style?: CSSProperties;
}) => (
  <svg
    style={style}
    viewBox="-10.5 -23.5 21 26"
    width={21}
    height={26}
    aria-hidden="true"
    className={cn("block overflow-visible", className)}
  >
    <path
      d={PIN_PATH}
      fill="none"
      stroke="rgb(0 0 0 / 0.3)"
      strokeLinejoin="round"
      strokeWidth={5}
    />
    <path
      d={PIN_PATH}
      fill="var(--color-pin)"
      paintOrder="stroke"
      stroke="#fff"
      strokeLinejoin="round"
      strokeWidth={3}
    />
    <polyline
      points={PIN_DIGITS[number]}
      fill="none"
      stroke="#fff"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.6}
    />
  </svg>
);

import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { cn } from "@/lib/utils";

// The shelf's items in the hero, in the app's dark theme (src/renderer/styles.css).
const SHELF_ITEMS = [
  {
    text: "The second upload overwrites the first file before the save is done.",
    icon: "github",
    ink: true,
    source: "GitHub · inset/shelf #482",
    isNew: true,
  },
  {
    text: "Ask why the retry flag hides the failure",
    icon: "claude",
    source: "Claude · Upload test retries",
    due: "Today",
  },
  {
    text: "Login screen: three things to fix before the demo",
    icon: "figma",
    source: "Figma · Sign-in flow",
  },
  { text: "Book the movers for Monday", icon: "slack", source: "Slack · #office-move" },
];

function BrowserWindow() {
  return (
    <div className="hidden min-h-[420px] overflow-hidden rounded-xl border bg-background sm:block">
      <div className="flex h-[38px] items-center gap-3 border-b bg-muted px-3">
        <span className="flex gap-1.5">
          {[0, 1, 2].map((dot) => (
            <i key={dot} className="size-[11px] rounded-full bg-neutral-300" />
          ))}
        </span>
        <span className="flex h-6 flex-1 items-center justify-center rounded-md border bg-background text-xs text-muted-foreground">
          github.com/inset/shelf/issues/482
        </span>
      </div>
      <div className="grid gap-2.5 px-[22px] py-[18px]">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <img src="/icons/github.svg" alt="" width={16} height={16} className="size-4" />
          inset / shelf · Issues
        </div>
        <p className="text-[19px] leading-[1.3] font-medium tracking-[-0.01em]">
          The upload test fails one run in ten on CI{" "}
          <span className="font-normal text-muted-foreground">#482</span>
        </p>
        <span className="justify-self-start rounded-full border bg-muted px-2.5 py-0.5 text-xs font-medium">
          Open
        </span>
        <div className="overflow-hidden rounded-lg border">
          <b className="block border-b bg-muted px-3 py-2 text-xs font-medium text-neutral-700">
            Comment
          </b>
          <p className="px-3 py-2.5 leading-[1.55]">
            It only fails when two uploads finish in the same second.{" "}
            <mark className="rounded-sm bg-[#b3d7ff] text-inherit">
              The second upload overwrites the first file before the save is done.
            </mark>{" "}
            A retry hides it, so the run goes green again.
          </p>
        </div>
      </div>
    </div>
  );
}

function Shelf() {
  return (
    <div className="grid min-h-[420px] content-start gap-2 rounded-xl border border-white/10 bg-[#2b2a2e] p-2.5 text-neutral-50">
      <div className="flex h-[30px] items-center gap-2 rounded-lg border border-white/12 px-2.5 text-neutral-400">
        <HugeiconsIcon icon={Search01Icon} className="size-3.5" />
        Search or due:today
      </div>
      <div className="flex items-center gap-2 px-1 py-0.5 text-xs font-medium">
        CI flakes
        <span className="h-px flex-1 bg-white/12" />
        <i className="size-[7px] rounded-full bg-[#0084d1]" />
      </div>
      {SHELF_ITEMS.map((item) => (
        <div
          key={item.text}
          className={cn(
            "grid grid-cols-[16px_minmax(0,1fr)] gap-x-2.5 gap-y-1 rounded-[10px] border bg-[#171718] p-2.5",
            item.isNew ? "border-[#0084d1]" : "border-white/8",
          )}
        >
          <i className="mt-px size-[15px] rounded-full border-[1.5px] border-white/28" />
          <p className="leading-[1.4] font-medium">{item.text}</p>
          <span className="col-start-2 flex min-w-0 items-center gap-1.5 text-xs text-neutral-400">
            <img
              src={`/icons/${item.icon}.svg`}
              alt=""
              width={13}
              height={13}
              className={cn("size-[13px] shrink-0", item.ink && "invert")}
            />
            <span className="truncate">{item.source}</span>
            {item.due && (
              <b className="ml-auto shrink-0 rounded-md bg-[#0c3a57] px-1.5 py-0.5 text-[11px] font-medium text-[#74d4ff]">
                {item.due}
              </b>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

// A GitHub issue with a sentence selected, and the shelf docked beside it holding that sentence.
export function DeskMock() {
  return (
    <div
      aria-hidden="true"
      className="grid grid-cols-1 items-start gap-3 text-left text-[13px] leading-[1.45] sm:grid-cols-[minmax(0,1fr)_280px] lg:grid-cols-[minmax(0,1fr)_300px]"
    >
      <BrowserWindow />
      <Shelf />
    </div>
  );
}

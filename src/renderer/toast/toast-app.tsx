import { Alert02Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { NoticeCorner, ToastView } from "@shared/contracts";

import { cn } from "@/lib/utils";
import { toastBridge } from "@/shared/bridge";
import { usePushedView } from "@/shared/use-pushed-view";

const api = toastBridge();

const load = async (): Promise<ToastView | null> => await api.getView();

const subscribe = (listener: (view: ToastView | null) => void) =>
  api.on("view", listener);

const PLACE: Readonly<Record<NoticeCorner, string>> = {
  "bottom-left": "items-end justify-start",
  "bottom-right": "items-end justify-end",
  "top-left": "items-start justify-start",
  "top-right": "items-start justify-end",
};

/** Confirms a capture made while the shelf was hidden, or says a copy failed, in a small pill beside the pointer; it never takes focus or clicks. */
export const ToastApp = () => {
  const view = usePushedView(load, subscribe, null);

  if (view === null) {
    return null;
  }

  const failed = view.tone === "failed";

  return (
    <main className={cn("flex h-svh w-svw p-2", PLACE[view.corner])}>
      <output
        className={cn(
          "bg-popover/95 text-popover-foreground animate-in fade-in-0 zoom-in-95 flex max-w-full items-center gap-1.5 border text-xs font-medium shadow-md duration-150",
          failed ? "rounded-lg px-2.5 py-1.5" : "h-7 rounded-full pr-3 pl-2"
        )}
        key={view.seq}
      >
        <HugeiconsIcon
          className={cn("shrink-0", failed ? "text-destructive" : "text-pin")}
          icon={failed ? Alert02Icon : Tick02Icon}
          size={14}
          strokeWidth={2}
        />
        <span className={failed ? "line-clamp-2" : "truncate"}>
          {view.title}
        </span>
      </output>
    </main>
  );
};

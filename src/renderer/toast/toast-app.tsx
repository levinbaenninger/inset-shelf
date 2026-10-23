import { Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ToastView } from "@shared/contracts";

import { toastBridge } from "@/shared/bridge";
import { usePushedView } from "@/shared/use-pushed-view";

const api = toastBridge();

const load = async (): Promise<ToastView | null> => await api.getView();

const subscribe = (listener: (view: ToastView | null) => void) =>
  api.on("view", listener);

/** Confirms a capture made while the shelf was hidden; it never takes focus or clicks. */
export const ToastApp = () => {
  const view = usePushedView(load, subscribe, null);

  if (view === null) {
    return null;
  }

  return (
    <main className="bg-background text-foreground flex h-svh items-center gap-3 px-4">
      <span className="bg-pin text-primary-foreground flex size-6 shrink-0 items-center justify-center rounded-full">
        <HugeiconsIcon icon={Tick02Icon} size={14} />
      </span>
      <output className="flex min-w-0 flex-col">
        <p className="text-sm font-medium">{view.title}</p>
        <p className="text-muted-foreground truncate text-xs">{view.detail}</p>
      </output>
    </main>
  );
};

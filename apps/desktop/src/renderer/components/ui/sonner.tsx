import { Alert02Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@inset/ui/lib/utils";
import { Toaster as Sonner } from "sonner";
import type { ToasterProps } from "sonner";

import { NOTICE_CLASS, NOTICE_ICON_CLASS } from "./notice";

const ICONS: ToasterProps["icons"] = {
  error: (
    <HugeiconsIcon
      className={cn(NOTICE_ICON_CLASS, "text-destructive")}
      icon={Alert02Icon}
      size={14}
      strokeWidth={2}
    />
  ),
  success: (
    <HugeiconsIcon
      className={cn(NOTICE_ICON_CLASS, "text-pin")}
      icon={Tick02Icon}
      size={14}
      strokeWidth={2}
    />
  ),
};

/** Sonner drawn as the shelf's notices: a small pill centred above the field, not a card across the shelf. */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      className="toaster group max-[600px]:!w-auto"
      icons={ICONS}
      theme="system"
      toastOptions={{
        classNames: {
          actionButton:
            "text-pin-ink hover:bg-accent -my-0.5 -mr-1.5 ml-1 shrink-0 cursor-default rounded-full px-2 py-0.5 font-medium",
          cancelButton:
            "text-muted-foreground hover:bg-accent -my-0.5 shrink-0 cursor-default rounded-full px-2 py-0.5",
          content: "flex min-w-0 flex-col gap-0.5",
          description: "text-muted-foreground line-clamp-1",
          icon: "flex shrink-0",
          title: "font-medium",
          toast: cn(NOTICE_CLASS, "mx-auto !w-fit"),
        },
        unstyled: true,
      }}
      {...props}
    />
  );
}

export { Toaster };

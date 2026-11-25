import { ArrowRight02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import { DOWNLOAD } from "@/lib/site";

type DownloadButtonProps = Omit<ComponentProps<typeof Button>, "asChild" | "children"> & {
  arrow?: boolean;
};

// The page's one main action, worded the same wherever it appears.
export function DownloadButton({ arrow = false, size = "cta", ...props }: DownloadButtonProps) {
  return (
    <Button asChild size={size} {...props}>
      <a href={DOWNLOAD.href}>
        {DOWNLOAD.label}
        {arrow && (
          <HugeiconsIcon
            icon={ArrowRight02Icon}
            data-icon="inline-end"
            className="transition-transform duration-200 group-hover/button:translate-x-[3px]"
          />
        )}
      </a>
    </Button>
  );
}

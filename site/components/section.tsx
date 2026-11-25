import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

export function Section({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("gutter py-20 md:py-28", className)} {...props} />;
}

// A dashed line across the whole page between sections, crossing the guide rails.
export function Divider() {
  return (
    <div aria-hidden="true" className="relative h-px">
      <div className="absolute inset-y-0 left-1/2 w-screen -translate-x-1/2 bg-[linear-gradient(to_right,var(--color-rail)_4px,transparent_4px)] bg-size-[8px_1px]" />
    </div>
  );
}

export function SectionIntro({
  id,
  eyebrow,
  href,
  title,
  lead,
  className,
}: {
  id: string;
  eyebrow: string;
  href: string;
  title: ReactNode;
  lead?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto flex max-w-[680px] flex-col items-center text-center", className)}>
      <a
        href={href}
        className="group inline-flex items-center gap-0.5 rounded-sm text-[15px] font-medium text-brand"
      >
        {eyebrow}
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          size={16}
          aria-hidden="true"
          className="transition-transform group-hover:translate-x-0.5"
        />
      </a>
      <h2 id={id} className="mt-4 text-title">
        {title}
      </h2>
      {lead && <p className="mt-5 max-w-[52ch] text-lead text-muted-foreground">{lead}</p>}
    </div>
  );
}

// A warm grey tile holding a drawn piece of the app, with its title and one line under it.
export function Tile({
  title,
  line,
  children,
  className,
  stageClassName,
  shrinkOnPhone = false,
}: {
  title: string;
  line: string;
  children: ReactNode;
  className?: string;
  stageClassName?: string;
  /** Draws the stage at 85% on a phone, for app parts wider than the tile there. */
  shrinkOnPhone?: boolean;
}) {
  return (
    <article className={cn("flex flex-col overflow-hidden rounded-[24px] bg-tile", className)}>
      <div
        aria-hidden="true"
        className={cn("relative h-[300px] overflow-hidden sm:h-[320px]", stageClassName)}
      >
        <div
          className={cn(
            "absolute inset-0",
            shrinkOnPhone &&
              "max-sm:h-[117.65%] max-sm:w-[117.65%] max-sm:origin-top-left max-sm:scale-85",
          )}
        >
          {children}
        </div>
      </div>
      <div className="px-6 pt-2 pb-7 sm:px-8 sm:pb-8">
        <h3 className="text-[19px] leading-snug font-medium tracking-[-0.022em]">{title}</h3>
        <p className="mt-1.5 max-w-[44ch] text-[15px] leading-6 text-muted-foreground">{line}</p>
      </div>
    </article>
  );
}

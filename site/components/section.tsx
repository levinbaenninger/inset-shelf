import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

type Screens = 1 | 2;

// Every section is exactly one or two screens tall, so each screen shows one section.
const PHONE: Record<Screens, string> = { 1: "min-h-lvh", 2: "min-h-[200lvh]" };
const TABLET: Record<Screens, string> = { 1: "sm:h-svh", 2: "sm:h-[200svh]" };
const DESKTOP: Record<Screens, string> = { 1: "lg:h-svh", 2: "lg:h-[200svh]" };

type SectionProps = ComponentProps<"section"> & {
  screens?: Screens;
  tabletScreens?: Screens;
  phoneScreens?: Screens;
  tone?: "base" | "surface";
};

export function Section({
  screens = 1,
  tabletScreens = screens,
  phoneScreens = 1,
  tone = "base",
  className,
  ...props
}: SectionProps) {
  return (
    <section
      className={cn(
        "relative pt-24 pb-12 sm:min-h-0 sm:pt-[120px] sm:pb-[72px]",
        PHONE[phoneScreens],
        TABLET[tabletScreens],
        DESKTOP[screens],
        tone === "surface" && "bg-muted",
        className,
      )}
      {...props}
    />
  );
}

export function Heading({ className, ...props }: ComponentProps<"h2">) {
  return <h2 className={cn("text-h2 font-medium", className)} {...props} />;
}

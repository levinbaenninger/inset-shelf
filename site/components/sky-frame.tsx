"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

// WebGL loads after the page; the CSS sky under it is the whole picture without script, WebGL or motion.
const Grainient = dynamic(() => import("./react-bits/Grainient"), { ssr: false });

const SKY = ["#a9dcf6", "#d3effc", "#f4fbff", "#bfe6f9", "#e3f5fe"];

export function SkyFrame({ className, children, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "relative isolate overflow-hidden rounded-[24px] bg-[radial-gradient(60%_50%_at_15%_85%,#fff_0%,transparent_70%),radial-gradient(50%_45%_at_90%_70%,#f2fbff_0%,transparent_70%),linear-gradient(180deg,var(--color-sky)_0%,var(--color-sky-light)_100%)] sm:rounded-[28px]",
        className,
      )}
      {...props}
    >
      <Grainient
        aria-hidden="true"
        className="!absolute inset-0 -z-10 opacity-90"
        colors={SKY}
        angle={160}
        bands={2}
        speed={0.25}
        flow={0.5}
        softness={1}
        silk={0.6}
        grainAmount={0.03}
        grainAnimated={false}
        interactive={false}
        clickSwirl={false}
        intro={false}
        dpr={1}
      />
      {children}
    </div>
  );
}

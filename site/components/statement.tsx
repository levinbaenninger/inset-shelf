"use client";

import ScrollReveal from "./react-bits/ScrollReveal";

const STATEMENT =
  "Pasted notes forget where they came from. Inset Shelf keeps the source, one click away.";

// The case for the shelf in one line, its words darkening as it scrolls into view.
export function Statement() {
  return (
    <section className="gutter py-28 md:py-40">
      <ScrollReveal
        containerClassName="mx-auto my-0 max-w-[920px] text-center"
        textClassName="text-[clamp(1.625rem,1.05rem+1.9vw,2.625rem)] leading-[1.24] font-medium tracking-[-0.03em]"
        baseOpacity={0.16}
        baseRotation={0}
        enableBlur={false}
        wordAnimationEnd="bottom 62%"
      >
        {STATEMENT}
      </ScrollReveal>
    </section>
  );
}

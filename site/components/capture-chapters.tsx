"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { Heading } from "./section";

// Each picture is a shot of the real renderer (pnpm screens), set on the brand's light blue.
const STEPS = [
  {
    title: "Save selected text with Shift",
    text: "Select text in any app and tap Shift twice. The shelf adds it with its app, window and page, and puts your clipboard back.",
    src: "/img/capture-text.webp",
    alt: "The shelf in its dark theme, a section of items with due dates, steps and sources",
  },
  {
    title: "Pin spots on a screenshot",
    text: "Take a screenshot as usual and a card appears beside the shelf. Add it, then drop numbered pins on what needs fixing.",
    src: "/img/capture-pins.webp",
    alt: "A screenshot of a sign-in form with three numbered pins in the drawing window",
  },
  {
    title: "Link the windows you had open",
    text: "Pick open windows in order and they become one item. Reopen all brings the whole set back later.",
    src: "/img/capture-windows.webp",
    alt: "The window picker with five open windows and two of them picked",
  },
];

// The page's one moment, pinned chapters. From 1024px, with motion allowed, the section is two screens tall
// and its stage holds still while the steps open in turn and the picture beside them changes. Elsewhere the
// steps stand as rows, each with its picture.
export function CaptureChapters() {
  const [active, setActive] = useState(0);
  const sectionRef = useRef<HTMLElement>(null);

  // While the section is near the screen, the scroll through it picks the step: each step gets an equal share.
  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const { top, height } = section.getBoundingClientRect();
      const progress = Math.min(
        Math.max(-top / Math.max(height - window.innerHeight, 1), 0),
        0.999,
      );
      setActive(Math.floor(progress * STEPS.length));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        window.addEventListener("scroll", onScroll, { passive: true });
        update();
      } else window.removeEventListener("scroll", onScroll);
    });
    observer.observe(section);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <section
      ref={sectionRef}
      id="capture"
      aria-labelledby="capture-h"
      className="relative min-h-[200lvh] pt-24 pb-12 sm:h-svh sm:min-h-0 sm:pt-[120px] sm:pb-[72px] lg:motion-safe:h-[200svh] lg:motion-safe:p-0"
    >
      <div className="wrap grid grid-cols-12 gap-x-6 lg:motion-safe:sticky lg:motion-safe:top-0 lg:motion-safe:h-svh lg:motion-safe:content-start lg:motion-safe:pt-[120px] lg:motion-safe:pb-[72px]">
        <div className="col-span-12 lg:motion-safe:col-span-5">
          <Heading id="capture-h">Three ways onto the shelf</Heading>
          <ol className="mt-8 grid gap-8 sm:mt-12 sm:gap-6">
            {STEPS.map((step, index) => {
              const on = index === active;
              return (
                <li
                  key={step.title}
                  className={cn(
                    "grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-6 lg:motion-safe:grid-cols-1 lg:motion-safe:border-l-2 lg:motion-safe:pl-6 lg:motion-safe:transition-colors",
                    on ? "lg:motion-safe:border-primary" : "lg:motion-safe:border-border",
                  )}
                >
                  <div>
                    <h3
                      className={cn(
                        "text-xl font-medium transition-colors",
                        !on && "lg:motion-safe:text-muted-foreground",
                      )}
                    >
                      {step.title}
                    </h3>
                    <div
                      className={cn(
                        "grid grid-rows-[1fr] transition-[grid-template-rows] duration-500",
                        !on && "lg:motion-safe:grid-rows-[0fr]",
                      )}
                    >
                      <p className="overflow-hidden pt-2">{step.text}</p>
                    </div>
                  </div>
                  <img
                    src={step.src}
                    srcSet={`${step.src.replace(".webp", "-640.webp")} 640w, ${step.src} 1256w`}
                    sizes="(min-width: 640px) 254px, 100vw"
                    alt={step.alt}
                    width={1256}
                    height={942}
                    loading="lazy"
                    className="aspect-[4/3] w-full rounded-xl object-cover sm:h-[190px] sm:w-auto lg:motion-safe:hidden"
                  />
                </li>
              );
            })}
          </ol>
        </div>
        <div className="relative col-span-6 col-start-7 hidden aspect-[4/3] overflow-hidden rounded-[20px] bg-sky lg:motion-safe:block">
          {STEPS.map((step, index) => (
            <img
              key={step.src}
              src={step.src}
              alt={index === active ? step.alt : ""}
              width={1256}
              height={942}
              loading="lazy"
              className={cn(
                "absolute inset-0 size-full object-cover transition-[opacity,scale] duration-500",
                index === active ? "scale-100 opacity-100" : "scale-[1.03] opacity-0",
              )}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

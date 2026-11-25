import { Heading, Section } from "./section";

// The brand's open frame (Inset design system, section 6), used once, for the core claim, with the research
// figure in its opening. Its box sits on the page's lines and its stroke reaches into the gutter, so the words
// inside stand on the page's own lines.
// One drawing per width range keeps the corners round at every size.
const FRAMES = [
  {
    viewBox: "0 0 342 600",
    d: "M134 597H9A22 22 0 0 1-13 575V25A22 22 0 0 1 9 3H333A22 22 0 0 1 355 25V380",
    className: "sm:hidden",
  },
  {
    viewBox: "0 0 700 660",
    d: "M300 657H-5A24 24 0 0 1-29 633V27A24 24 0 0 1-5 3H705A24 24 0 0 1 729 27V370",
    className: "hidden sm:block lg:hidden",
  },
  {
    viewBox: "0 0 1000 620",
    d: "M470 617H-2A28 28 0 0 1-30 589V31A28 28 0 0 1-2 3H1002A28 28 0 0 1 1030 31V350",
    className: "hidden lg:block xl:hidden",
  },
  {
    viewBox: "0 0 1280 560",
    d: "M608 557H-4A28 28 0 0 1-32 529V31A28 28 0 0 1-4 3H1284A28 28 0 0 1 1312 31V320",
    className: "hidden xl:block",
  },
];

export function Claim() {
  return (
    <Section id="why" aria-labelledby="why-h">
      <div className="wrap">
        <div className="relative aspect-[342/600] sm:aspect-[700/660] lg:aspect-[1000/620] xl:aspect-[1280/560]">
          {FRAMES.map((frame) => (
            <svg
              key={frame.viewBox}
              viewBox={frame.viewBox}
              aria-hidden="true"
              className={`absolute inset-0 size-full overflow-visible ${frame.className}`}
            >
              <path
                d={frame.d}
                className="fill-none stroke-primary stroke-6 [stroke-linecap:round] [stroke-linejoin:round] [vector-effect:non-scaling-stroke]"
              />
            </svg>
          ))}
          <div className="relative grid gap-4 pt-10 sm:gap-6 sm:pt-14 lg:max-w-1/2 lg:pt-16">
            <Heading id="why-h">Saved notes lose where they came from.</Heading>
            <p className="max-w-[36ch] sm:text-lead">
              A sentence pasted into a notes app no longer knows its chat, pull request or page. Inset keeps the
              source with every item, and one click opens it again.
            </p>
          </div>
          {/* the opening starts on the page's split line: six of twelve columns */}
          <p className="absolute right-0 bottom-0 left-[calc(6*(100%+24px)/12)] grid gap-1 text-primary sm:gap-2">
            <strong className="text-[30px] leading-none font-medium tracking-[-0.035em] sm:text-[clamp(36px,3.4vw,48px)]">
              11 of 12
            </strong>
            <span className="max-w-[22ch] leading-[1.35] font-medium sm:text-lg xl:text-xl">
              people we interviewed had already given up a tool for this.
            </span>
          </p>
        </div>
      </div>
    </Section>
  );
}

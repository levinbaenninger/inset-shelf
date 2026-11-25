import { Heading, Section } from "./section";

// The pages the shelf names and the browsers it reads addresses from, by their real marks.
// Width and height are each mark's measured proportions (icons.mjs).
const SOURCES = [
  { name: "GitHub", icon: "github", w: 40, h: 39 },
  { name: "ChatGPT", icon: "openai", w: 39, h: 40 },
  { name: "Claude", icon: "claude", w: 40, h: 40 },
  { name: "X", icon: "x", w: 39, h: 40 },
  { name: "YouTube", icon: "youtube", w: 40, h: 28 },
  { name: "Figma", icon: "figma", w: 27, h: 40 },
  { name: "Slack", icon: "slack", w: 40, h: 40 },
  { name: "Linear", icon: "linear", w: 40, h: 40 },
  { name: "Notion", icon: "notion", w: 38, h: 40 },
  { name: "Safari", icon: "safari", w: 40, h: 40 },
  { name: "Chrome", icon: "chrome", w: 40, h: 40 },
  { name: "Edge", icon: "microsoft-edge", w: 40, h: 40 },
  { name: "Brave", icon: "brave", w: 34, h: 40 },
  { name: "Arc", icon: "arc", w: 40, h: 34 },
  { name: "Firefox", icon: "firefox", w: 39, h: 40 },
  { name: "Zen", icon: "zenbrowser", w: 40, h: 40 },
];

const LABEL =
  "GitHub, ChatGPT, Claude, X, YouTube, Figma, Slack, Linear and Notion pages are named; the address is read from Safari, Chrome, Edge, Brave, Arc, Firefox and Zen";

export function Sources() {
  return (
    <Section id="sources" tone="surface" aria-labelledby="sources-h">
      <div className="wrap">
        <Heading id="sources-h" className="max-w-[20ch]">
          Every shelf item knows where it came from.{" "}
          <span className="text-muted-foreground">Click its source line to open it again.</span>
        </Heading>
        <div role="img" aria-label={LABEL} className="mt-8 grid gap-5 sm:mt-12">
          <p className="text-label font-medium text-muted-foreground">
            Pages it names, and the browsers it reads them from
          </p>
          <ul className="grid grid-cols-4 gap-x-2 gap-y-4 sm:gap-x-6 sm:gap-y-16 lg:grid-cols-8 lg:gap-y-12">
            {SOURCES.map((source) => (
              <li key={source.name} className="grid justify-items-start gap-3">
                <span className="grid size-11 place-items-center rounded-[28%] bg-background ring-1 ring-border sm:size-[72px]">
                  <img
                    src={`/icons/${source.icon}.svg`}
                    alt=""
                    width={source.w}
                    height={source.h}
                    loading="lazy"
                    className="h-[60%] w-[60%] object-contain"
                  />
                </span>
                <span className="text-label font-medium">{source.name}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}

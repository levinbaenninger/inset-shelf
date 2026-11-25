"use client";

import type { ReactNode } from "react";

import { ShelfPanel, ShelfRow, TrafficLights } from "./app-ui";
import type { ShelfItem } from "./app-ui";
import { LogoLoop } from "./react-bits/LogoLoop";
import type { LogoItem } from "./react-bits/LogoLoop";
import { Section, SectionIntro, Tile } from "./section";

interface Mark {
  name: string;
  icon: string;
  w: number;
  h: number;
}

// Each mark's own proportions, so none is stretched.
const PAGES: Mark[] = [
  { name: "GitHub", icon: "github", w: 40, h: 39 },
  { name: "ChatGPT", icon: "openai", w: 39, h: 40 },
  { name: "Claude", icon: "claude", w: 40, h: 40 },
  { name: "X", icon: "x", w: 39, h: 40 },
  { name: "YouTube", icon: "youtube", w: 40, h: 28 },
  { name: "Figma", icon: "figma", w: 27, h: 40 },
  { name: "Slack", icon: "slack", w: 40, h: 40 },
  { name: "Linear", icon: "linear", w: 40, h: 40 },
  { name: "Notion", icon: "notion", w: 38, h: 40 },
];

const BROWSERS: Mark[] = [
  { name: "Safari", icon: "safari", w: 40, h: 40 },
  { name: "Chrome", icon: "chrome", w: 40, h: 40 },
  { name: "Edge", icon: "microsoft-edge", w: 40, h: 40 },
  { name: "Brave", icon: "brave", w: 34, h: 40 },
  { name: "Arc", icon: "arc", w: 40, h: 34 },
  { name: "Firefox", icon: "firefox", w: 39, h: 40 },
  { name: "Zen", icon: "zenbrowser", w: 40, h: 40 },
];

const toLogos = (marks: Mark[]): LogoItem[] =>
  marks.map((mark) => ({
    title: mark.name,
    node: (
      <span className="bg-tile flex h-12 items-center gap-2.5 rounded-xl pr-4 pl-2 text-[15px] font-medium tracking-[-0.01em]">
        <span className="flex size-8 items-center justify-center rounded-lg bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.05)]">
          <img
            src={`/icons/${mark.icon}.svg`}
            alt=""
            width={mark.w}
            height={mark.h}
            loading="lazy"
            className="max-h-[18px] w-auto max-w-[18px]"
          />
        </span>
        {mark.name}
      </span>
    ),
  }));

const Loop = ({
  marks,
  direction,
  label,
}: {
  marks: Mark[];
  direction: "left" | "right";
  label: string;
}) => (
  <LogoLoop
    logos={toLogos(marks)}
    direction={direction}
    speed={28}
    gap={12}
    logoHeight={48}
    pauseOnHover
    fadeOut
    fadeOutColor="#ffffff"
    fadeOutWidth={96}
    ariaLabel={label}
  />
);

const Pointer = ({ className }: { className: string }) => (
  <svg
    viewBox="0 0 16 22"
    width={16}
    height={22}
    aria-hidden="true"
    className={`absolute ${className}`}
  >
    <path
      d="M1 1v17l4.2-4 2.9 6.6 2.7-1.2-2.8-6.4H14z"
      fill="#111"
      stroke="#fff"
      strokeWidth={1.4}
      strokeLinejoin="round"
    />
  </svg>
);

const MiniWindow = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => (
  <div className="app-ui light shadow-card absolute top-[142px] left-1/2 w-[290px] -translate-x-1/2 overflow-hidden rounded-xl bg-white">
    <div className="flex h-9 items-center gap-3 border-b bg-[#f6f6f6] px-3">
      <TrafficLights className="gap-1.5 [&>i]:size-2.5" />
      <span className="flex h-6 min-w-0 flex-1 items-center justify-center truncate rounded-md bg-black/[0.05] px-2 text-[11px] text-[#3c3c43]">
        {title}
      </span>
    </div>
    <div className="h-[150px] p-4">{children}</div>
  </div>
);

const SourceStage = ({
  item,
  window,
}: {
  item: ShelfItem;
  window: ReactNode;
}) => (
  <>
    <ShelfPanel className="absolute top-6 left-1/2 w-[300px] -translate-x-1/2 p-2">
      <ul>
        <ShelfRow item={item} />
      </ul>
    </ShelfPanel>
    <Pointer className="top-[98px] left-[calc(50%-34px)]" />
    {window}
  </>
);

const TILES = [
  {
    title: "Pages open in your browser",
    line: "A GitHub pull request or issue, a post on X or a YouTube video is named on the line. Click it to open the page.",
    item: {
      text: "The second upload overwrites the first file before the save is done.",
      source: {
        service: "github",
        label: "GitHub · inset/shelf #482",
        active: true,
      },
    },
    window: (
      <MiniWindow title="github.com/inset/shelf/issues/482">
        <p className="text-[15px] leading-snug text-[#1f2328]">
          The upload test fails one run in ten on CI{" "}
          <span className="text-[#59636e]">#482</span>
        </p>
        <span className="mt-3 inline-flex h-6 items-center gap-1 rounded-full bg-[#1f883d] px-2.5 text-[12px] font-medium text-white">
          <span className="size-2.5 rounded-full border-[1.5px] border-white" />
          Open
        </span>
      </MiniWindow>
    ),
  },
  {
    title: "Chats open where they were",
    line: "On a Mac, a ChatGPT thread, a Claude chat and a Notion page open right where you left them.",
    item: {
      text: "Ask why the retry flag hides the failure",
      source: {
        service: "claude",
        label: "Claude · Upload test retries",
        active: true,
      },
      due: { label: "Today", tone: "today" },
    },
    window: (
      <MiniWindow title="Claude">
        <p className="text-[13px] font-medium">Upload test retries</p>
        <p className="mt-3 ml-auto w-fit max-w-[85%] rounded-xl bg-[#f0eee6] px-3 py-2 text-[12px] leading-snug">
          Why does the retry flag hide the failure?
        </p>
        <p className="text-muted-foreground mt-2 text-[12px] leading-snug">
          A retry runs the test again and keeps only the last result…
        </p>
      </MiniWindow>
    ),
  },
  {
    title: "Apps come to the front",
    line: "Figma, Slack and Linear come to the front, and other items open the page they came from.",
    item: {
      text: "Login screen: three things to fix before the demo",
      source: { service: "figma", label: "Figma · Sign-in flow", active: true },
      steps: "1/3",
    },
    window: (
      <MiniWindow title="Sign-in flow">
        <div className="-m-4 flex h-[150px] bg-[#f5f5f5]">
          <div className="grid w-16 content-start gap-1.5 border-r bg-white p-2">
            {[0, 1, 2, 3].map((index) => (
              <span key={index} className="h-1.5 rounded-full bg-neutral-200" />
            ))}
          </div>
          <div className="flex flex-1 items-center justify-center">
            <div className="grid w-[110px] gap-1 rounded-md bg-white p-2.5 shadow-sm">
              <b className="text-[10px] font-semibold">Sign in</b>
              <span className="h-3 rounded-sm border border-neutral-200" />
              <span className="h-3 rounded-sm border border-neutral-200" />
              <span className="mt-0.5 h-3.5 rounded-sm bg-[#1f6feb]" />
            </div>
          </div>
        </div>
      </MiniWindow>
    ),
  },
] satisfies {
  title: string;
  line: string;
  item: ShelfItem;
  window: ReactNode;
}[];

export const Sources = () => (
  <Section id="sources" aria-labelledby="sources-h">
    <SectionIntro
      id="sources-h"
      eyebrow="Source lines"
      href="/docs/sources"
      title="Every item knows where it came from."
      lead="The line under each item names its app, window and page. Pages from these sites get their own name, and the address comes from your browser."
    />
    <div className="-mx-5 mt-14 grid gap-3 md:-mx-10 md:mt-16">
      <Loop marks={PAGES} direction="left" label="Pages the shelf names" />
      <Loop
        marks={BROWSERS}
        direction="right"
        label="Browsers the shelf reads addresses from"
      />
    </div>
    <div className="mt-14 grid gap-4 md:mt-16 lg:grid-cols-3">
      {TILES.map((tile) => (
        <Tile key={tile.title} title={tile.title} line={tile.line}>
          <SourceStage item={tile.item} window={tile.window} />
        </Tile>
      ))}
    </div>
  </Section>
);

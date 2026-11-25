import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  PlusSignIcon,
  Share05Icon,
  SidebarLeftIcon,
  SquareLock02Icon,
} from "@hugeicons/core-free-icons";

import {
  Icon,
  ScreenshotCard,
  SectionHeader,
  ShelfComposer,
  ShelfPanel,
  ShelfRow,
  ShelfSearch,
  TrafficLights,
  type ShelfItem,
} from "./app-ui";

const SELECTION = "The second upload overwrites the first file before the save is done.";

const SECTIONS: { name: string; current?: boolean; items: ShelfItem[] }[] = [
  {
    name: "Upload bug",
    current: true,
    items: [
      {
        text: SELECTION,
        source: { service: "github", label: "GitHub · inset/shelf #482" },
        steps: "0/3",
        selected: true,
      },
      {
        text: "Ask why the retry flag hides the failure",
        source: { service: "claude", label: "Claude · Upload test retries" },
        due: { label: "Today", tone: "today" },
      },
      {
        text: "Prompt: write a test that finishes two uploads in the same second",
        source: { service: "chatgpt", label: "ChatGPT · Flaky upload test" },
      },
    ],
  },
  {
    name: "Sign-in redesign",
    items: [
      {
        text: "Login screen: three things to fix before the demo",
        source: { service: "figma", label: "Figma · Sign-in flow" },
        due: { label: "Tomorrow", tone: "plain" },
        steps: "1/3",
      },
    ],
  },
];

function BrowserWindow() {
  return (
    <div className="app-ui light absolute top-0 left-0 h-[640px] w-[900px] overflow-hidden rounded-xl bg-white shadow-[0_0_0_0.5px_rgb(0_0_0/0.2),0_30px_70px_-20px_rgb(0_40_80/0.3),0_10px_24px_-12px_rgb(0_0_0/0.12)]">
      <div className="flex h-[52px] items-center gap-4 border-b border-black/8 bg-[#f6f6f6] px-4 text-[#7b7b80]">
        <TrafficLights />
        <Icon icon={SidebarLeftIcon} size={17} className="ml-2" />
        <span className="flex gap-3">
          <Icon icon={ArrowLeft01Icon} size={17} />
          <Icon icon={ArrowRight01Icon} size={17} className="opacity-40" />
        </span>
        <span className="mx-auto flex h-8 w-[340px] items-center justify-center gap-1.5 rounded-lg bg-black/[0.05] text-[13px] text-[#3c3c43]">
          <Icon icon={SquareLock02Icon} size={12} className="text-[#7b7b80]" />
          github.com
        </span>
        <span className="flex gap-4">
          <Icon icon={Share05Icon} size={17} />
          <Icon icon={PlusSignIcon} size={17} />
        </span>
      </div>

      <div className="border-b border-[#d1d9e0] bg-[#f6f8fa] px-6 pt-3 text-[14px] text-[#1f2328]">
        <div className="flex items-center gap-3">
          <img src="/icons/github.svg" alt="" width={24} height={24} className="size-6" />
          <span>
            inset <span className="text-[#59636e]">/</span> <b className="font-semibold">shelf</b>
          </span>
          <span className="ml-auto h-7 w-[220px] rounded-md border border-[#d1d9e0] bg-white" />
        </div>
        <nav className="mt-3 flex gap-1 text-[13px]">
          <span className="px-2 pb-2.5">Code</span>
          <span className="flex items-center gap-1.5 border-b-2 border-[#fd8c73] px-2 pb-2 font-semibold">
            Issues
            <span className="rounded-full bg-[#818b981f] px-1.5 text-[12px] font-medium">12</span>
          </span>
          <span className="flex items-center gap-1.5 px-2 pb-2.5">
            Pull requests
            <span className="rounded-full bg-[#818b981f] px-1.5 text-[12px] font-medium">3</span>
          </span>
          <span className="px-2 pb-2.5">Actions</span>
        </nav>
      </div>

      <div className="flex gap-8 px-8 pt-6 text-[#1f2328]">
        <div className="min-w-0 flex-1">
          <h3 className="text-[26px] leading-tight font-normal tracking-[-0.01em]">
            The upload test fails one run in ten on CI{" "}
            <span className="font-light text-[#59636e]">#482</span>
          </h3>
          <div className="mt-3 flex items-center gap-2 border-b border-[#d1d9e0] pb-4 text-[14px] text-[#59636e]">
            <span className="flex h-8 items-center gap-1.5 rounded-full bg-[#1f883d] px-3 font-medium text-white">
              <span className="size-3.5 rounded-full border-2 border-white" />
              Open
            </span>
            <span>
              <b className="font-semibold text-[#1f2328]">levin</b> opened this issue 2 days ago · 4
              comments
            </span>
          </div>

          <div className="mt-5 flex gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#dbeafe] text-[15px] font-semibold text-[#1e40af]">
              L
            </span>
            <div className="min-w-0 flex-1 overflow-hidden rounded-md border border-[#d1d9e0]">
              <p className="border-b border-[#d1d9e0] bg-[#f6f8fa] px-4 py-2 text-[14px] text-[#59636e]">
                <b className="font-semibold text-[#1f2328]">levin</b> commented 2 days ago
              </p>
              <div className="grid gap-3 px-4 py-3.5 text-[15px] leading-[1.6]">
                <p>
                  It only fails when two uploads finish in the same second.{" "}
                  <mark className="bg-selection text-inherit">{SELECTION}</mark> A retry hides it,
                  so the run goes green again.
                </p>
                <p>
                  Steps: start two uploads of the same file, then cancel the first one after the
                  progress bar reaches the end.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-5 flex gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#dcfce7] text-[15px] font-semibold text-[#166534]">
              N
            </span>
            <div className="min-w-0 flex-1 overflow-hidden rounded-md border border-[#d1d9e0]">
              <p className="border-b border-[#d1d9e0] bg-[#f6f8fa] px-4 py-2 text-[14px] text-[#59636e]">
                <b className="font-semibold text-[#1f2328]">noa</b> commented yesterday
              </p>
              <p className="px-4 py-3.5 text-[15px] leading-[1.6]">
                Seen it on the release branch too. The retry flag was added for the network tests,
                so it covers this one as well.
              </p>
            </div>
          </div>
        </div>

        <aside className="w-[220px] shrink-0 text-[13px] text-[#59636e] max-sm:invisible">
          {[
            ["Assignees", "levin"],
            ["Labels", ""],
            ["Milestone", "Preview build"],
          ].map(([title, value]) => (
            <div key={title} className="border-b border-[#d1d9e0] py-3 first:pt-1">
              <p className="font-semibold text-[#1f2328]">{title}</p>
              {value ? (
                <p className="mt-1.5">{value}</p>
              ) : (
                <p className="mt-2 flex gap-1.5 text-[12px] font-medium">
                  <span className="rounded-full bg-[#ffebe9] px-2 text-[#cf222e]">bug</span>
                  <span className="rounded-full bg-[#ddf4ff] px-2 text-[#0969da]">ci</span>
                </p>
              )}
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}

// A GitHub issue with one sentence selected, and the shelf open over the browser's right edge with that
// sentence saved: true app scale (the shelf is 360 points wide), zoomed down on smaller screens.
export function HeroScene() {
  return (
    <div className="relative h-[640px] w-[1120px] shrink-0 [zoom:0.84] sm:[zoom:0.8] lg:[zoom:0.86] xl:[zoom:1]">
      <BrowserWindow />
      <ScreenshotCard className="absolute top-[426px] left-[468px] hidden h-[184px] sm:block" />
      <ShelfPanel className="absolute top-[30px] right-0 h-[580px] w-[360px]">
        <ShelfSearch />
        <div className="flex min-h-0 flex-1 flex-col px-2">
          {SECTIONS.map((section) => (
            <div key={section.name}>
              <SectionHeader name={section.name} current={section.current} />
              <ul className="flex flex-col gap-2 pb-2">
                {section.items.map((item) => (
                  <ShelfRow key={item.text} item={item} />
                ))}
              </ul>
            </div>
          ))}
        </div>
        <ShelfComposer />
      </ShelfPanel>
    </div>
  );
}

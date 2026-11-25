import { cn } from "@inset/ui/lib/utils";

import {
  CheckCircle,
  ScreenshotCard,
  SectionHeader,
  ShelfPanel,
  ShelfRow,
  SignInShot,
  SourceLine,
} from "./app-ui";
import { DrawingTile } from "./drawing-tile";
import { Section, SectionIntro, Tile } from "./section";

const QUOTE =
  "Log every retry before you remove the flag, so the overlap shows up in CI.";

const KeyCap = ({ className }: { className?: string }) => (
  <span
    className={cn(
      "flex h-14 w-16 flex-col items-start justify-between rounded-[10px] bg-white px-2.5 py-2 font-mono text-[11px] text-neutral-500 shadow-[0_0_0_1px_rgb(0_0_0/0.08),0_2px_0_1px_rgb(0_0_0/0.08),0_8px_16px_-6px_rgb(0_0_0/0.18)]",
      className
    )}
  >
    <span className="text-[17px] leading-none text-neutral-800">⇧</span>
    shift
  </span>
);

const SelectedText = () => (
  <>
    <div className="app-ui light shadow-card absolute top-6 left-5 w-[290px] rounded-xl bg-white p-4 sm:top-8 sm:left-8 sm:w-[330px]">
      <SourceLine service="claude" label="Claude · Upload test retries" />
      <p className="mt-3 text-[13px] leading-[1.6]">
        Retries make a flaky test pass, so the failure stays out of sight.{" "}
        <mark className="bg-selection text-inherit">{QUOTE}</mark> Then add a
        test that finishes two uploads in the same second.
      </p>
    </div>
    <div className="absolute bottom-6 left-8 hidden gap-2 sm:bottom-8 sm:left-12 sm:flex">
      <KeyCap className="motion-safe:animate-[press_2.4s_ease-in-out_infinite]" />
      <KeyCap className="motion-safe:animate-[press_2.4s_ease-in-out_0.3s_infinite]" />
    </div>
    <ShelfPanel className="absolute top-[168px] left-10 w-[300px] sm:top-[164px] sm:right-8 sm:left-auto">
      <div className="px-2 pb-2">
        <SectionHeader name="Upload bug" current />
        <ul>
          <ShelfRow
            item={{
              text: QUOTE,
              source: {
                service: "claude",
                label: "Claude · Upload test retries",
              },
              selected: true,
            }}
          />
        </ul>
      </div>
    </ShelfPanel>
  </>
);

// The card under the pointer, and beside it the shelf's edge with the screenshot already added as an image.
const Screenshot = () => (
  <>
    <ScreenshotCard
      hover
      className="absolute top-16 left-5 h-[184px] sm:left-6"
    />
    <ShelfPanel className="absolute top-8 left-[312px] w-[360px] sm:left-[318px]">
      <div className="px-2 pb-2">
        <SectionHeader name="Sign-in" current />
        <ul>
          <li className="border-primary bg-background/60 flex items-start gap-3 rounded-lg border px-3 py-2.5">
            <CheckCircle className="mt-0.5" />
            <span className="h-[72px] w-[120px] shrink-0 overflow-hidden rounded-md border">
              <SignInShot className="h-[144px] w-[240px] [zoom:0.5]" />
            </span>
            <span className="text-sm font-medium">Screenshot</span>
          </li>
        </ul>
      </div>
    </ShelfPanel>
  </>
);

const FileDrop = () => (
  <>
    <ShelfPanel className="ring-pin absolute top-14 left-[84px] w-[316px] ring-2 ring-inset sm:top-[68px] sm:right-10 sm:left-auto sm:w-[360px]">
      <div className="px-2 pb-2">
        <SectionHeader name="Office move" current />
        <ul className="flex flex-col gap-2">
          <ShelfRow
            item={{
              text: "Floor plan, level 3",
              file: "floor-plan-level-3.pdf",
              windows: 1,
            }}
          />
          <ShelfRow
            item={{
              text: "Book the movers for Monday",
              due: { label: "Tomorrow", tone: "plain" },
            }}
          />
        </ul>
      </div>
    </ShelfPanel>
    <div className="absolute top-[150px] left-[40px] flex flex-col items-center gap-1.5 motion-safe:animate-[drift_3.2s_ease-in-out_infinite] sm:top-[92px] sm:right-[396px] sm:left-auto">
      <span className="relative flex h-[68px] w-[54px] items-end justify-center rounded-[5px] bg-white pb-2 shadow-[0_0_0_1px_rgb(0_0_0/0.08),0_10px_24px_-8px_rgb(0_0_0/0.3)]">
        <span className="absolute top-0 right-0 size-3.5 rounded-bl-[4px] bg-neutral-200" />
        <span className="rounded-[3px] bg-[#e5372b] px-1 py-0.5 font-mono text-[9px] font-semibold text-white">
          PDF
        </span>
        <span className="absolute -right-2.5 -bottom-2.5 flex size-5 items-center justify-center rounded-full bg-[#28c840] text-[13px] leading-none font-bold text-white shadow">
          +
        </span>
      </span>
      <span className="rounded-[4px] bg-[#0a64d6] px-1.5 py-0.5 text-[11px] font-medium text-white">
        movers-quote.pdf
      </span>
    </div>
  </>
);

export const Capture = () => (
  <Section id="capture" aria-labelledby="capture-h">
    <SectionIntro
      id="capture-h"
      eyebrow="How capture works"
      href="/docs/capture"
      title="Anything you find goes on the shelf."
      lead="Selected text, a screenshot, a sketch with pins or a file. Each one takes a single step, and none of it asks you to fill anything in."
    />
    <div className="mt-14 grid gap-4 md:mt-16 lg:grid-cols-12">
      <Tile
        shrinkOnPhone
        className="lg:col-span-7"
        title="Selected text, with Shift twice"
        line="Select text in any app and tap Shift twice. The shelf saves it with its app, window and page, and puts your clipboard back."
      >
        <SelectedText />
      </Tile>
      <Tile
        shrinkOnPhone
        className="lg:col-span-5"
        title="Screenshots, as you take them"
        line="Take a screenshot as usual and a card appears beside the shelf. Copy it, or add it."
      >
        <Screenshot />
      </Tile>
      <Tile
        shrinkOnPhone
        interactive
        className="lg:col-span-5"
        title="Sketches and numbered pins"
        line="Draw on any image, or drop numbered pins on what needs fixing. Label each pin in the details."
      >
        <DrawingTile />
      </Tile>
      <Tile
        shrinkOnPhone
        className="lg:col-span-7"
        title="Files, dropped or pasted"
        line="Drop files on the shelf or paste an image. Drag them out again into any app."
      >
        <FileDrop />
      </Tile>
    </div>
  </Section>
);

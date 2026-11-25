"use client";

import { cn } from "@inset/ui/lib/utils";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode, RefObject } from "react";

import { useExpiringState } from "@/lib/use-expiring-state";

import {
  SectionHeader,
  ShelfComposer,
  ShelfPanel,
  ShelfRow,
  ShelfSearch,
} from "./app-ui";
import type { ShelfItem } from "./app-ui";

// The app's double tap (src/shared/double-tap.ts): Shift alone, each press at most 250 ms, released at most 400 ms apart.
const TAP_MAX_MS = 250;
const GAP_MAX_MS = 400;
const FLASH_MS = 1400;
const MAX_CAPTURES = 3;
const HEADER_HEIGHT = 64;

interface Tap {
  downAt: number | null;
  lastUp: number | null;
}

const IDLE: Tap = { downAt: null, lastUp: null };

interface TapStep {
  tap: Tap;
  double: boolean;
}

type TapEvent =
  | { type: "shiftDown"; at: number }
  | { type: "shiftUp"; at: number }
  | { type: "other" };

const stepTap = (tap: Tap, event: TapEvent): TapStep => {
  if (event.type === "other") {
    return { double: false, tap: IDLE };
  }

  if (event.type === "shiftDown") {
    return { double: false, tap: { ...tap, downAt: event.at } };
  }

  if (tap.downAt === null || event.at - tap.downAt > TAP_MAX_MS) {
    return { double: false, tap: IDLE };
  }

  if (tap.lastUp !== null && event.at - tap.lastUp <= GAP_MAX_MS) {
    return { double: true, tap: IDLE };
  }

  return { double: false, tap: { downAt: null, lastUp: event.at } };
};

interface DemoItem extends ShelfItem {
  id: string;
}

interface DemoSection {
  name: string;
  items: DemoItem[];
}

const SECTIONS: DemoSection[] = [
  {
    name: "Upload bug",
    items: [
      {
        id: "selection",
        text: "The second upload overwrites the first file before the save is done.",
        source: { service: "github", label: "GitHub · inset/shelf #482" },
        steps: "0/3",
      },
      {
        id: "retry",
        text: "Ask why the retry flag hides the failure",
        source: { service: "claude", label: "Claude · Upload test retries" },
        due: { label: "Today", tone: "today" },
      },
      {
        id: "prompt",
        text: "Prompt: write a test that finishes two uploads in the same second",
        source: { service: "chatgpt", label: "ChatGPT · Flaky upload test" },
      },
    ],
  },
  {
    name: "Sign-in redesign",
    items: [
      {
        id: "login",
        text: "Login screen: three things to fix before the demo",
        source: { service: "figma", label: "Figma · Sign-in flow" },
        due: { label: "Tomorrow", tone: "plain" },
        steps: "1/3",
      },
    ],
  },
];

const CURRENT_SECTION = SECTIONS[0].name;

interface Demo {
  shiftDown: boolean;
  captures: DemoItem[];
  flashId: string | null;
  shelfRef: RefObject<HTMLDivElement | null>;
}

const DemoContext = createContext<Demo | null>(null);

const useDemo = (): Demo => {
  const demo = use(DemoContext);

  if (demo === null) {
    throw new Error("useDemo needs a HeroDemo around it");
  }

  return demo;
};

const selectedText = (shelf: HTMLElement | null): string => {
  const selection = window.getSelection();

  // Double Shift inside the shelf never saves the shelf's own text, as in the app.
  if (
    selection === null ||
    (shelf !== null && shelf.contains(selection.anchorNode))
  ) {
    return "";
  }

  return selection.toString().replaceAll(/\s+/gu, " ").trim();
};

const sourceLabel = (): string =>
  `${window.location.hostname.replace(/^www\./u, "")} · ${document.title}`;

// The hero's live parts: the Shift key in the subline and the drawn shelf, which a double Shift over selected text adds to.
export const HeroDemo = ({ children }: { children: ReactNode }) => {
  const [shiftDown, setShiftDown] = useState(false);
  const [captures, setCaptures] = useState<DemoItem[]>([]);
  const [flashId, setFlashId] = useExpiringState<string>(FLASH_MS);
  // The notice shows only while the shelf is scrolled out of view; the live region always speaks.
  const [noticeAt, setNoticeAt] = useExpiringState<number>(2200);
  const [announced, setAnnounced] = useState(0);
  const shelfRef = useRef<HTMLDivElement>(null);

  const capture = useCallback(() => {
    const text = selectedText(shelfRef.current);

    if (text === "") {
      return;
    }

    const id = `capture-${Date.now()}`;
    setCaptures((previous) =>
      [
        {
          id,
          text,
          source: { service: "link" as const, label: sourceLabel() },
        },
        ...previous,
      ].slice(0, MAX_CAPTURES)
    );
    setFlashId(id);

    const box = shelfRef.current?.getBoundingClientRect();

    // Where the new item lands: the top of the shelf, below the page's header.
    const onScreen =
      box !== undefined &&
      box.top > HEADER_HEIGHT &&
      box.top + 160 < window.innerHeight;

    setAnnounced((count) => count + 1);
    setNoticeAt(onScreen ? null : Date.now());
  }, [setFlashId, setNoticeAt]);

  useEffect(() => {
    let tap = IDLE;

    const step = (event: TapEvent) => {
      const next = stepTap(tap, event);
      ({ tap } = next);

      if (next.double) {
        capture();
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Shift") {
        setShiftDown(true);

        if (!event.repeat) {
          step({ at: event.timeStamp, type: "shiftDown" });
        }
      } else {
        step({ type: "other" });
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Shift") {
        setShiftDown(false);
        step({ at: event.timeStamp, type: "shiftUp" });
      }
    };

    // A Shift-click extends a selection; it is not a tap.
    const onPointerDown = () => {
      step({ type: "other" });
    };

    const onBlur = () => {
      setShiftDown(false);
      step({ type: "other" });
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("blur", onBlur);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("blur", onBlur);
    };
  }, [capture]);

  const demo = useMemo(
    () => ({ captures, flashId, shelfRef, shiftDown }),
    [captures, flashId, shiftDown]
  );

  return (
    <DemoContext value={demo}>
      {children}
      <output className="sr-only">
        {announced > 0 &&
          `Added to the shelf at the top of the page (${announced})`}
      </output>
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none fixed bottom-6 left-1/2 z-40 flex h-9 -translate-x-1/2 items-center rounded-full bg-neutral-900 px-4 text-[13px] font-medium text-white shadow-lg transition-[opacity,translate] duration-200",
          noticeAt === null ? "translate-y-2 opacity-0" : "opacity-100"
        )}
      >
        Added to the shelf, at the top of the page
      </div>
    </DemoContext>
  );
};

/** "Shift" in the hero's line, drawn as a key that goes down while the visitor holds Shift. */
export const ShiftKey = () => {
  const { shiftDown } = useDemo();

  return (
    <kbd
      title="Select text on this page, then tap Shift twice"
      className={cn(
        "text-foreground/85 relative -top-px mx-0.5 inline-block rounded-[6px] border border-black/12 bg-white/75 px-[0.4em] font-sans text-[0.88em] leading-[1.45] font-medium transition-[translate,box-shadow,background-color] duration-75",
        shiftDown
          ? "translate-y-[2px] bg-white/55 shadow-[0_0_0_0_rgb(0_0_0/0.12)]"
          : "shadow-[0_2px_0_0_rgb(0_0_0/0.12)]"
      )}
    >
      Shift
    </kbd>
  );
};

/** The hero's shelf: items check off, hovering a section moves its dot, and double Shift adds to the top. */
export const DemoShelf = ({ className }: { className?: string }) => {
  const { captures, flashId, shelfRef } = useDemo();
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [hovered, setHovered] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const latest = captures[0]?.id;

  // A new capture lands at the top, so the list shows the top.
  useEffect(() => {
    if (latest !== undefined) {
      listRef.current?.scrollTo({ top: 0 });
    }
  }, [latest]);

  const sections = useMemo(
    () =>
      SECTIONS.map((section, index) =>
        index === 0
          ? { ...section, items: [...captures, ...section.items] }
          : section
      ),
    [captures]
  );

  const selectedId = captures[0]?.id ?? SECTIONS[0].items[0].id;
  const current = hovered ?? CURRENT_SECTION;

  const toggle = (id: string) => {
    setChecked((previous) => {
      const next = new Set(previous);

      if (!next.delete(id)) {
        next.add(id);
      }

      return next;
    });
  };

  return (
    <ShelfPanel ref={shelfRef} className={className}>
      <div aria-hidden="true">
        <ShelfSearch />
      </div>
      <div
        ref={listRef}
        className="flex min-h-0 flex-1 [scrollbar-width:thin] flex-col overflow-y-auto px-2"
        onMouseLeave={() => {
          setHovered(null);
        }}
      >
        {sections.map((section) => (
          // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- hover only moves the drawn dot.
          <div
            key={section.name}
            onMouseEnter={() => {
              setHovered(section.name);
            }}
            onFocus={() => {
              setHovered(section.name);
            }}
          >
            <SectionHeader
              name={section.name}
              current={section.name === current}
            />
            <ul className="flex flex-col gap-2 pb-2">
              {section.items.map((item) => (
                <ShelfRow
                  key={item.id}
                  item={{
                    ...item,
                    done: checked.has(item.id),
                    selected: item.id === selectedId,
                  }}
                  onToggle={() => {
                    toggle(item.id);
                  }}
                  className={cn(
                    item.id === flashId &&
                      "motion-safe:animate-[flash_1.4s_ease-out]"
                  )}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div aria-hidden="true">
        <ShelfComposer />
      </div>
    </ShelfPanel>
  );
};

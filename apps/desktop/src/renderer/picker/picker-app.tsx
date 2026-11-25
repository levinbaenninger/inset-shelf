import {
  AppWindowIcon,
  Refresh01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { PickerView, WindowCandidate } from "@shared/contracts";
import { keyText } from "@shared/shortcut";
import type { TutorialAction, TutorialView } from "@shared/tutorial";
import { useState } from "react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import { pickerBridge } from "@/shared/bridge";
import { useLocalKeys } from "@/shared/keys";
import { isMac } from "@/shared/platform";
import { usePushedView } from "@/shared/use-pushed-view";
import { WindowHeader, WindowTitle } from "@/shared/window-header";
import { coach } from "@/tutorial/anchors";
import { PageHints } from "@/tutorial/hint-layer";

const api = pickerBridge();

const load = async (): Promise<PickerView> => await api.getView();

const tutorialSource = {
  load: async () => await api.getTutorial(),
  subscribe: (listener: (view: TutorialView) => void) =>
    api.on("tutorial", listener),
};

const actTutorial = (action: TutorialAction): void => {
  api.tutorial(action);
};

const subscribe = (listener: (view: PickerView | null) => void) =>
  api.on("view", listener);

const SKELETONS = 6;

const linkLabel = (linking: boolean, count: number): string => {
  if (linking) {
    return "Linking…";
  }

  return count <= 1 ? "Link Window" : `Link ${count} Windows`;
};

/** One open window to pick: its picture, app and title; a click picks or drops it. */
const Card = ({
  anchor,
  candidate,
  onToggle,
  order,
}: {
  /** The tutorial's anchor, on the first window. */
  readonly anchor?: ReturnType<typeof coach>;
  readonly candidate: WindowCandidate;
  /** Its place among the picked windows, or null. */
  readonly order: number | null;
  readonly onToggle: () => void;
}) => (
  <button
    aria-label={`${candidate.title ?? "Untitled window"}${candidate.app === null ? "" : `, ${candidate.app}`}`}
    aria-pressed={order !== null}
    {...anchor}
    className={cn(
      "group/card focus-visible:ring-ring/50 relative flex min-w-0 flex-col gap-1.5 rounded-lg p-1.5 text-left outline-none focus-visible:ring-3",
      order === null ? "hover:bg-foreground/5" : "bg-primary/10"
    )}
    onClick={onToggle}
    type="button"
  >
    <span
      className={cn(
        "bg-muted relative block aspect-[16/10] w-full overflow-hidden rounded-md ring-1",
        order === null ? "ring-foreground/10" : "ring-primary ring-2"
      )}
    >
      <img
        alt=""
        className="size-full object-cover object-top"
        draggable={false}
        src={candidate.thumb}
      />
      <span
        className={cn(
          "absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full text-xs font-semibold tabular-nums shadow-sm",
          order === null
            ? "border border-white/80 bg-black/25 opacity-0 group-hover/card:opacity-100"
            : "bg-primary text-primary-foreground"
        )}
      >
        {order === null ? null : order + 1}
      </span>
    </span>
    <span className="min-w-0 px-0.5">
      <span className="block truncate text-sm leading-tight font-medium">
        {candidate.title ?? "Untitled window"}
      </span>
      <span className="text-muted-foreground block truncate text-xs">
        {candidate.app ?? "App"}
      </span>
    </span>
  </button>
);

const Grid = ({ children }: { readonly children: ReactNode }) => (
  <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-1.5">
    {children}
  </div>
);

/**
 * New Window Link…: the open windows with a picture of each. The ones picked,
 * in the order picked, become a note on the shelf, or join an item's links.
 */
const Picker = ({ view }: { readonly view: PickerView }) => {
  const [picked, setPicked] = useState<readonly string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  const link = async (): Promise<void> => {
    if (picked.length === 0 || view.linking) {
      return;
    }

    setProblem(null);

    const result = await api.choose([...picked]);

    if (!result.ok) {
      setProblem(result.message);
    }
  };

  useLocalKeys({
    onEscape: () => {
      api.cancel();
    },
    onSave: () => {
      void link();
    },
  });

  const toggle = (id: string): void => {
    setPicked((current) =>
      current.includes(id)
        ? current.filter((other) => other !== id)
        : [...current, id]
    );
  };

  const title =
    view.target.kind === "new"
      ? "New Window Link"
      : `Link Windows to “${view.target.label}”`;

  const { state } = view;
  const count = picked.length;

  return (
    <main className="bg-background flex h-svh flex-col overflow-hidden">
      <WindowHeader>
        <WindowTitle>{title}</WindowTitle>
      </WindowHeader>
      <div className="shelf-list min-h-0 flex-1 overflow-y-auto px-3 pt-3 pb-3">
        {state.kind === "loading" ? (
          <Grid>
            {Array.from({ length: SKELETONS }, (_, index) => (
              <span className="flex flex-col gap-1.5 p-1.5" key={index}>
                <span className="bg-muted aspect-[16/10] animate-pulse rounded-md" />
                <span className="bg-muted h-3 w-3/4 animate-pulse rounded" />
              </span>
            ))}
          </Grid>
        ) : null}
        {state.kind === "ready" && state.candidates.length > 0 ? (
          <Grid>
            {state.candidates.map((candidate, index) => (
              <Card
                anchor={index === 0 ? coach("picker-window") : undefined}
                candidate={candidate}
                key={candidate.id}
                onToggle={() => {
                  toggle(candidate.id);
                }}
                order={
                  picked.includes(candidate.id)
                    ? picked.indexOf(candidate.id)
                    : null
                }
              />
            ))}
          </Grid>
        ) : null}
        {state.kind === "ready" && state.candidates.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={AppWindowIcon} />
              </EmptyMedia>
              <EmptyTitle>No other windows are open</EmptyTitle>
              <EmptyDescription>
                Open the windows you want to link, then refresh.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
        {state.kind === "permission" ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={AppWindowIcon} />
              </EmptyMedia>
              <EmptyTitle>Allow Screen Recording</EmptyTitle>
              <EmptyDescription>
                Inset Shelf needs Screen Recording to list your windows and
                their titles.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                onClick={() => {
                  api.setUpScreenRecording();
                }}
                size="sm"
              >
                Set Up Screen Recording…
              </Button>
            </EmptyContent>
          </Empty>
        ) : null}
        {state.kind === "failed" ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Windows couldn’t be listed</EmptyTitle>
              <EmptyDescription>{state.message}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
      </div>
      <footer className="flex h-13 shrink-0 items-center gap-2 border-t px-3">
        <Button
          aria-label="Refresh the list"
          disabled={state.kind === "loading" || view.linking}
          onClick={() => {
            setPicked([]);
            api.refresh();
          }}
          size="sm"
          variant="ghost"
        >
          <HugeiconsIcon data-icon="inline-start" icon={Refresh01Icon} />
          Refresh
        </Button>
        <p
          aria-live="polite"
          className={cn(
            "min-w-0 flex-1 truncate text-xs",
            problem === null ? "text-muted-foreground" : "text-destructive"
          )}
        >
          {problem ??
            (count === 0
              ? "Pick the windows to link, in any order"
              : `${count} picked`)}
        </p>
        <Button
          onClick={() => {
            api.cancel();
          }}
          size="sm"
          variant="outline"
        >
          Cancel
        </Button>
        <Button
          disabled={count === 0 || view.linking}
          onClick={() => {
            void link();
          }}
          size="sm"
        >
          <HugeiconsIcon data-icon="inline-start" icon={Tick02Icon} />
          {linkLabel(view.linking, count)}
          <Kbd className="ml-0.5">
            {keyText("CommandOrControl+Enter", isMac)}
          </Kbd>
        </Button>
      </footer>
    </main>
  );
};

/** Every opening starts over with nothing picked. */
export const PickerApp = () => {
  const view = usePushedView<PickerView | null>(load, subscribe, null);

  return (
    <>
      {view === null ? null : <Picker key={view.seq} view={view} />}
      <PageHints act={actTutorial} source={tutorialSource} />
    </>
  );
};

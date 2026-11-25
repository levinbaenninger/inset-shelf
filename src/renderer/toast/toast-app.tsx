import {
  Alert02Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  Location01Icon,
  TextAlignLeftIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { NoticeCorner, ToastView } from "@shared/contracts";
import { WHY_MAX } from "@shared/pill";
import type { WhyPhase } from "@shared/pill";
import { shortcutLabels } from "@shared/shortcut";
import { useEffect, useRef } from "react";

import { NOTICE_CLASS, NOTICE_ICON_CLASS } from "@/components/ui/notice";
import { cn } from "@/lib/utils";
import { toastBridge } from "@/shared/bridge";
import { isMac } from "@/shared/platform";
import { usePushedView } from "@/shared/use-pushed-view";

const api = toastBridge();

const load = async (): Promise<ToastView | null> => await api.getView();

const subscribe = (listener: (view: ToastView | null) => void) =>
  api.on("view", listener);

const PLACE: Readonly<Record<NoticeCorner, string>> = {
  "bottom-left": "items-end justify-start",
  "bottom-right": "items-end justify-end",
  "top-left": "items-start justify-start",
  "top-right": "items-start justify-end",
};

const hover = {
  onMouseEnter: () => {
    api.hover(true);
  },
  onMouseLeave: () => {
    api.hover(false);
  },
};

type NoticeView = Extract<ToastView, { readonly kind: "notice" }>;

const NoticeIcon = ({ failed }: { readonly failed: boolean }) => (
  <HugeiconsIcon
    className={cn(NOTICE_ICON_CLASS, failed ? "text-destructive" : "text-pin")}
    icon={failed ? Alert02Icon : Tick02Icon}
    size={14}
    strokeWidth={2}
  />
);

/** A notice without the why field: the whole pill opens the shelf. */
const PlainNotice = ({ view }: { readonly view: NoticeView }) => {
  const failed = view.tone === "failed";

  return (
    <button
      className={cn(
        NOTICE_CLASS,
        "animate-in fade-in-0 zoom-in-95 hover:bg-accent cursor-default text-left font-medium duration-150"
      )}
      key={view.seq}
      onClick={() => {
        api.open(view.seq);
      }}
      {...hover}
      title={`${view.title}\nClick to open the shelf`}
      type="button"
    >
      <NoticeIcon failed={failed} />
      <span className={failed ? "line-clamp-2" : "truncate"}>{view.title}</span>
      <HugeiconsIcon
        className={cn(NOTICE_ICON_CLASS, "text-muted-foreground -mr-1")}
        icon={ArrowRight01Icon}
        size={12}
      />
    </button>
  );
};

/** The capture notice: its words open the shelf, and Why at its end opens the why field, as ⇧⇧ again does. */
const CaptureNotice = ({ view }: { readonly view: NoticeView }) => (
  <div
    className={cn(
      NOTICE_CLASS,
      "animate-in fade-in-0 zoom-in-95 gap-0 p-0 font-medium duration-150"
    )}
    key={view.seq}
    {...hover}
  >
    <button
      className="hover:bg-accent flex min-w-0 flex-1 cursor-default items-center gap-2 rounded-l-2xl py-1.5 pr-2 pl-3 text-left"
      onClick={() => {
        api.open(view.seq);
      }}
      title={`${view.title}\nClick to open the shelf`}
      type="button"
    >
      <NoticeIcon failed={false} />
      <span className="truncate">{view.title}</span>
    </button>
    <button
      className="hover:bg-accent text-muted-foreground hover:text-foreground flex shrink-0 cursor-default items-center gap-1 rounded-r-2xl border-l py-1.5 pr-3 pl-2"
      onClick={() => {
        api.why(view.seq);
      }}
      title={`Say why this matters (${shortcutLabels(isMac).doubleShift} again)`}
      type="button"
    >
      Why
      <span aria-hidden="true" className="text-xs tracking-tight">
        ⇧⇧
      </span>
    </button>
  </div>
);

/**
 * One line for why the capture matters. The caret and placeholder show only
 * once the window has the keyboard, so nobody types at a field that can't
 * hear them. Return saves, Esc throws the words away; main decides the rest.
 */
const WhyField = ({
  phase,
  seq,
}: {
  readonly phase: Exclude<WhyPhase, "saved">;
  readonly seq: number;
}) => {
  const input = useRef<HTMLInputElement>(null);
  const typing = phase === "typing";

  useEffect(() => {
    input.current?.focus();

    // Ready only when the window itself has the keyboard; a focused input in an unfocused window hears nothing.
    const ready = (): void => {
      if (document.hasFocus() && document.activeElement === input.current) {
        api.whyReady(seq);
      }
    };

    ready();
    window.addEventListener("focus", ready);

    return () => {
      window.removeEventListener("focus", ready);
    };
  }, [seq]);

  return (
    <label
      className={cn(
        NOTICE_CLASS,
        "w-full cursor-text font-medium",
        typing && "ring-ring/40 ring-2"
      )}
    >
      <HugeiconsIcon
        className={cn(NOTICE_ICON_CLASS, "text-muted-foreground")}
        icon={TextAlignLeftIcon}
        size={14}
      />
      <input
        aria-label="Why this matters"
        className={cn(
          "placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent outline-none",
          !typing && "caret-transparent"
        )}
        maxLength={WHY_MAX}
        onChange={(event) => {
          api.whyInput({ seq, text: event.currentTarget.value });
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) {
            return;
          }

          if (event.key === "Enter") {
            event.preventDefault();
            api.saveWhy({ seq, text: event.currentTarget.value });
          } else if (event.key === "Escape") {
            event.preventDefault();
            api.cancelWhy(seq);
          }
        }}
        placeholder={typing ? "Why this matters" : ""}
        ref={input}
        spellCheck={false}
        type="text"
      />
      <span
        aria-hidden="true"
        className={cn(
          "text-muted-foreground shrink-0 text-xs",
          !typing && "invisible"
        )}
      >
        ↩
      </span>
    </label>
  );
};

type RecallView = Extract<ToastView, { readonly kind: "recall" }>;

/** "3 items from here": the open items from the window in front. */
const fromHere = (count: number): string =>
  count === 1 ? "1 item from here" : `${count} items from here`;

/**
 * The recall pill, in the front window's corner: unasked, so quieter than
 * the capture notice (a muted mark, no zoom). Its words open the shelf
 * filtered to those items; × keeps this place quiet from now on.
 */
const RecallPill = ({ view }: { readonly view: RecallView }) => (
  <div
    className={cn(
      NOTICE_CLASS,
      "animate-in fade-in-0 gap-0 p-0 font-medium duration-300"
    )}
    key={view.seq}
    {...hover}
  >
    <button
      className="hover:bg-accent flex min-w-0 flex-1 cursor-default items-center gap-2 rounded-l-2xl py-1.5 pr-2 pl-3 text-left"
      onClick={() => {
        api.open(view.seq);
      }}
      title={`${fromHere(view.count)}: ${view.label}\nClick to show them in the shelf`}
      type="button"
    >
      <HugeiconsIcon
        className={cn(NOTICE_ICON_CLASS, "text-muted-foreground")}
        icon={Location01Icon}
        size={14}
      />
      <span className="truncate">{fromHere(view.count)}</span>
    </button>
    <button
      aria-label="Don’t show for this place again"
      className="hover:bg-accent text-muted-foreground hover:text-foreground flex shrink-0 cursor-default items-center rounded-r-2xl py-1.5 pr-2.5 pl-1.5"
      onClick={() => {
        api.dismiss(view.seq);
      }}
      title="Don’t show for this place again"
      type="button"
    >
      <HugeiconsIcon icon={Cancel01Icon} size={12} />
    </button>
  </div>
);

const WhySaved = () => (
  <output
    className={cn(
      NOTICE_CLASS,
      "animate-in fade-in-0 font-medium duration-150"
    )}
  >
    <NoticeIcon failed={false} />
    <span className="truncate">Why saved</span>
  </output>
);

/**
 * The small pill beside the pointer. It confirms a capture made while the
 * shelf was hidden, or says a copy failed, without taking focus; a click on it
 * opens the shelf there. A capture's notice can become a one-line field for
 * why it matters, which then has the keyboard until Return, Esc or a click
 * elsewhere. The same window says, unasked, how many open items came from
 * the window in front.
 */
export const ToastApp = () => {
  const view = usePushedView(load, subscribe, null);

  if (view === null) {
    return null;
  }

  const content = (() => {
    if (view.kind === "notice") {
      return view.why ? (
        <CaptureNotice view={view} />
      ) : (
        <PlainNotice view={view} />
      );
    }

    if (view.kind === "recall") {
      return <RecallPill view={view} />;
    }

    return view.phase === "saved" ? (
      <WhySaved />
    ) : (
      <WhyField key={view.seq} phase={view.phase} seq={view.seq} />
    );
  })();

  return (
    <main
      aria-live="polite"
      className={cn("flex h-svh w-svw p-2", PLACE[view.corner])}
    >
      {content}
    </main>
  );
};

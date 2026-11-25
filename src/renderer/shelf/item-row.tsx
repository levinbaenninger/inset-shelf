import {
  ArrowRight01Icon,
  ChatGptIcon,
  ClaudeIcon,
  FigmaIcon,
  File01Icon,
  GithubIcon,
  Link01Icon,
  MoreHorizontalIcon,
  NewTwitterIcon,
  Notion01Icon,
  SlackIcon,
  SourceCodeIcon,
  Tick02Icon,
  YoutubeIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { COLOR_HEX } from "@shared/colors";
import type { NotSavedItem } from "@shared/contracts";
import { insetUrl } from "@shared/inset-url";
import { itemText, PICTURE_KIND } from "@shared/shelf";
import type {
  FileItem,
  ImageItem,
  ItemContext,
  ShelfItem,
  Step,
  TextItem,
  WindowRef,
} from "@shared/shelf";
import { keyText } from "@shared/shortcut";
import { openingApp, sourceLabel } from "@shared/web-source";
import type { Service } from "@shared/web-source";
import {
  isValidElement,
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { tooltipText, Truncated, useCut } from "@/shared/clamp";
import { PinMarker } from "@/shared/pin-marker";
import { isMac } from "@/shared/platform";
import { coach } from "@/tutorial/anchors";

import { AttachmentStrip } from "./attachment-strip";
import type { AttachmentHandlers } from "./attachment-strip";
import { NotSavedLine } from "./banners";
import { liveEdits } from "./drafts";
import { editPoint, useCaretStart, wordsClick } from "./edit-start";
import { fileSizeText, whenText } from "./format";
import { badgeNodes, PinLegend, StepChecklist, WindowStrip } from "./item-meta";
import type { LiveEdit } from "./live-edits";
import { Markdown } from "./markdown";
import { MarkdownField } from "./markdown-field";
import type { ScreenPoint } from "./markdown-field";
import type { MenuAnchor } from "./menus";
import { Note } from "./note";
import { moreText } from "./open-row";
import { bindRow } from "./row-actions";
import type { RowActions } from "./row-actions";
import {
  budgetOf,
  contextMenuAt,
  DONE,
  EDITING,
  OpenRow,
  WORDS,
} from "./row-look";
import { checkedSteps, ROW_WINDOWS, rowParts, rowSteps } from "./row-parts";
import type { RowExtras } from "./row-parts";
import { RowText } from "./row-text";
import type { RowDropLook, RowDropProps } from "./use-attach-drop";
import type { ItemDrag } from "./use-item-drag";
import { useOpenRow } from "./use-open-row";
import { isTextField } from "./use-shelf-keys";

/**
 * Focus on an item's row itself, where Return edits, Space checks off and ⌫
 * deletes. False when the row is gone or hidden.
 */
export const focusRow = (row: Element | null): boolean => {
  const target =
    row?.querySelector<HTMLElement>("[data-row-keys]") ??
    row?.querySelector<HTMLElement>("[data-details-button]") ??
    null;

  target?.focus({ preventScroll: true });

  return target !== null && document.activeElement === target;
};

const SERVICE_ICON: Record<Service, typeof Link01Icon> = {
  chatgpt: ChatGptIcon,
  claude: ClaudeIcon,
  figma: FigmaIcon,
  github: GithubIcon,
  linear: Link01Icon,
  notion: Notion01Icon,
  slack: SlackIcon,
  t3code: SourceCodeIcon,
  x: NewTwitterIcon,
  youtube: YoutubeIcon,
};

/**
 * "site · page": the page's part leaves the line whole, its " · " with it,
 * when too little of it would fit to read, so no line ends on a bare "· …".
 */
const SourceText = ({ label }: { readonly label: string }) => {
  const at = label.indexOf(" · ");

  if (at === -1) {
    return <span className="truncate">{label}</span>;
  }

  return (
    <span className="flex h-4 min-w-0 flex-wrap overflow-hidden">
      <span className="truncate">{label.slice(0, at)}</span>
      <span className="min-w-[7ch] flex-[1_1_0] truncate ps-1">
        · {label.slice(at + 3)}
      </span>
    </span>
  );
};

/** The source line's tooltip: the whole line when it shows cut, then where a click goes, 300 characters in all; null when it would only repeat what shows. */
const sourceTitle = (
  shown: string,
  opens: string | null,
  cut: boolean
): string | undefined => {
  const lines = [
    ...(cut ? [shown] : []),
    ...(opens === null || opens === shown ? [] : [opens]),
  ];

  return lines.length === 0 ? undefined : tooltipText(lines.join("\n"));
};

/**
 * Where an item came from, in one quiet line: the site and what on it for
 * pages the shelf knows, else the app and window. A page address opens in the
 * browser.
 */
export const SourceLine = ({
  context,
  onOpenLink,
}: {
  readonly context: ItemContext;
  readonly onOpenLink: () => void;
}): ReactNode => {
  const { label, service } = sourceLabel(context);
  const icon = service === null ? Link01Icon : SERVICE_ICON[service];
  // A desktop app it came from opens again (elsewhere than macOS, only at a link); else the page does.
  const app = openingApp(context, isMac);
  const shown = label === "" ? (context.url ?? "") : label;
  const plain = useRef<HTMLParagraphElement>(null);
  const link = useRef<HTMLButtonElement>(null);
  const plainCut = useCut(plain);
  const linkCut = useCut(link);

  if (context.url === null && app === null) {
    return label === "" ? null : (
      <p
        className="text-muted-foreground flex min-w-0 items-center gap-1 text-xs"
        ref={plain}
        title={plainCut ? tooltipText(label) : undefined}
      >
        {service === null ? null : (
          <HugeiconsIcon className="shrink-0" icon={icon} size={12} />
        )}
        <SourceText label={label} />
      </p>
    );
  }

  return (
    <button
      className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex min-w-0 items-center gap-1 self-start rounded-sm text-left text-xs outline-none focus-visible:ring-3"
      {...coach("item-source")}
      onClick={onOpenLink}
      ref={link}
      title={sourceTitle(
        shown,
        app === null ? context.url : `Open ${app}`,
        linkCut
      )}
      type="button"
    >
      <HugeiconsIcon className="shrink-0" icon={icon} size={12} />
      <SourceText label={shown} />
    </button>
  );
};

const hostOf = (url: string): string =>
  new URL(url).hostname.replace(/^www\./u, "");

const sameHost = (a: string, b: string): boolean => {
  try {
    return hostOf(a) === hostOf(b);
  } catch {
    return false;
  }
};

/** One link of a copied selection: its words, and its site under them when both don't fit on one line. */
const LinkRow = ({
  link,
  onOpenLink,
  siteShown,
}: {
  readonly link: TextItem["links"][number];
  readonly onOpenLink: (url: string) => void;
  /** The site already shows on the source line above: it isn't named again. */
  readonly siteShown: boolean;
}) => {
  const ref = useRef<HTMLButtonElement>(null);
  const cut = useCut(ref);

  return (
    <button
      className="hover:bg-foreground/5 focus-visible:ring-ring/50 -mx-1 flex min-w-0 items-center gap-1.5 rounded-sm px-1 py-0.5 text-left text-xs outline-none focus-visible:ring-3"
      onClick={() => {
        onOpenLink(link.url);
      }}
      ref={ref}
      title={sourceTitle(link.text, link.url, cut)}
      type="button"
    >
      <HugeiconsIcon
        className="text-muted-foreground shrink-0"
        icon={Link01Icon}
        size={12}
      />
      {/* The site goes under the words when both don't fit on one line, so it stays readable. */}
      <span className="flex min-w-0 flex-wrap gap-x-1.5">
        <span className="max-w-full truncate">{link.text}</span>
        {link.text === link.url || siteShown ? null : (
          <span className="text-muted-foreground max-w-full truncate">
            {hostOf(link.url)}
          </span>
        )}
      </span>
    </button>
  );
};

/** The links in a copied selection, listed while the item is open; each opens in the browser. */
export const LinkList = ({
  links,
  onOpenLink,
  sourceUrl = null,
}: {
  readonly links: TextItem["links"];
  readonly onOpenLink: (url: string) => void;
  /** The page the source line above names: a link on the same site doesn't name it again. */
  readonly sourceUrl?: string | null;
}) => (
  <div className="flex flex-col gap-0.5">
    {links.map((link) => (
      <LinkRow
        key={link.url}
        link={link}
        onOpenLink={onOpenLink}
        siteShown={sourceUrl !== null && sameHost(sourceUrl, link.url)}
      />
    ))}
  </div>
);

/** An attached file's name; it drags out like an image. */
const FileName = ({
  item,
  onContextMenu,
  onDragImage,
  onSelect,
}: {
  readonly item: FileItem;
} & Pick<RowHandlers, "onContextMenu" | "onDragImage" | "onSelect">) => (
  <button
    className="focus-visible:ring-ring/50 flex min-w-0 cursor-grab items-center gap-2 rounded-sm text-left text-sm outline-none focus-visible:ring-3 active:cursor-grabbing"
    draggable
    data-row-keys
    onClick={onSelect}
    onContextMenu={contextMenuAt(onContextMenu)}
    onDragStart={(event) => {
      // A system drag of the file itself, not the card's move within the shelf.
      event.preventDefault();
      event.stopPropagation();
      onDragImage();
    }}
    title={tooltipText(`${item.file.name}\nDrag into another app`)}
    type="button"
  >
    <HugeiconsIcon
      className="text-muted-foreground shrink-0"
      icon={File01Icon}
      size={16}
    />
    <span
      className={cn(
        "truncate",
        item.done && "text-muted-foreground line-through"
      )}
    >
      {item.file.name}
    </span>
  </button>
);

/** Badges wrapped below the line are out of sight, so screen readers skip them too. */
const hideWrapped = (line: HTMLElement): void => {
  const { bottom, top } = line.getBoundingClientRect();
  const words = line.previousElementSibling;

  // Badges on a line of their own under the words: the row marks it, so they can reach its right edge.
  line.parentElement?.toggleAttribute(
    "data-wrapped",
    words !== null && top >= words.getBoundingClientRect().bottom - 1
  );

  for (const badge of line.children) {
    if (badge.getBoundingClientRect().top >= bottom) {
      badge.setAttribute("aria-hidden", "true");
    } else {
      badge.removeAttribute("aria-hidden");
    }
  }
};

/**
 * A line with its words on the left and the metadata badges right-aligned.
 * The words keep at least 14 characters; badges that don't fit wrap out of
 * sight, lowest priority first, so the line never grows. `reach` lets the
 * badges run on under the More button's column, below its button. With
 * `ownLine`, badges that would leave the words (an icon and a name) under
 * 12 characters take a line of their own under them instead.
 */
const BadgeLine = ({
  badges,
  children,
  ownLine = false,
  reach,
}: {
  readonly badges: readonly ReactNode[];
  readonly children: ReactNode;
  readonly reach: boolean;
  readonly ownLine?: boolean;
}) => {
  const words = children !== null && children !== undefined;
  const ref = useRef<HTMLDivElement>(null);

  // Which badges show: the observer starts again when they change, as useMeasure does on its words, and reports on each resize.
  const shown = badges
    .map((badge) => (isValidElement(badge) ? String(badge.key) : ""))
    .join(" ");

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry?.target instanceof HTMLElement) {
        hideWrapped(entry.target);
      }
    });

    if (ref.current !== null && shown !== "") {
      observer.observe(ref.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [shown]);

  if (badges.length === 0) {
    return words ? <div className="flex min-w-0">{children}</div> : null;
  }

  return (
    <div
      className={cn(
        "group/badges flex min-w-0 items-center gap-2",
        reach && "-mr-9",
        ownLine && "flex-wrap gap-y-1.5",
        // Wrapped under the words, the badges end where the row's Details does; the words keep clear of ⋯, so whether they wrap stays the same.
        ownLine && !reach && "data-[wrapped]:-mr-9"
      )}
    >
      {words ? (
        <div
          className={cn(
            "flex min-w-0 flex-1",
            ownLine && "min-w-[min(100%,calc(12ch+1.5rem))]",
            ownLine && !reach && "group-data-[wrapped]/badges:mr-9"
          )}
        >
          {children}
        </div>
      ) : null}
      <div
        className={cn(
          // Never narrower than its widest badge, the Due chip: the words give way first.
          "ml-auto flex h-5 min-w-min shrink-0 flex-wrap justify-end gap-1 overflow-hidden",
          words && !ownLine ? "max-w-[calc(100%-14ch-0.5rem)]" : "max-w-full"
        )}
        data-badges
        ref={ref}
      >
        {badges}
      </div>
    </div>
  );
};

export interface RowHandlers {
  /** Opens the page an item was captured from, or a link in it. */
  readonly onOpenLink: (url?: string) => void;
  readonly onSelect: () => void;
  /** Opens the item's menu: at the pointer for a right-click, under ⋯ for the button. */
  readonly onContextMenu: (anchor: MenuAnchor) => void;
  /** Double-clicking an image opens it large, to look at or draw on. */
  readonly onOpen: () => void;
  /** Double-clicking a text item edits it. */
  readonly onEdit: () => void;
  readonly onToggle: () => void;
  readonly onEditText: (text: string) => void;
  readonly onEditNote: (note: string) => void;
  readonly onStopEditing: () => void;
  readonly onDragImage: () => void;
  /** Escape in a note, which saves as it is typed, hides the shelf. */
  readonly onHide: () => void;
  /** Ticks a next step in the open row. */
  readonly onToggleStep: (step: Step) => void;
  readonly onReopenWindow: (window: WindowRef) => void;
  /** The details view (→). */
  readonly onShowDetails: () => void;
  /** Not saved: saves the shelf again. */
  readonly onRetrySave: () => void;
  /** Not saved: Discard changes, or Delete for an item the disk has never held. */
  readonly onDiscardChanges: () => void;
  readonly attachments: AttachmentHandlers;
}

/** What a row is drawn from: its data, and its handlers bound to it (row-actions.ts). */
interface RowViewProps extends RowHandlers {
  readonly item: ShelfItem;
  /** One of the first run's example items (the tutorial's), tagged so. */
  readonly example?: boolean;
  readonly selected: boolean;
  readonly editing: boolean;
  readonly copied: boolean;
  /** Lets the card be dragged to another section (use-item-drag.ts). */
  readonly dragProps: ReturnType<ItemDrag["itemProps"]>;
  /** The card is being dragged, so it shows faded. */
  readonly dragging: boolean;
  /** Picked along with others (⌘-click, ⇧-click, ⌘A): outlined, but not opened. */
  readonly picked: boolean;
  /** ⌘-click (Ctrl elsewhere) toggles the card in the picks; ⇧-click picks a range. */
  readonly onPick: (mode: "toggle" | "range") => void;
  /** Today, for the Due chip. */
  readonly now: Date;
  /** A failed save left this item's changes unwritten. */
  readonly notSaved: NotSavedItem | undefined;
  /** Files from outside dropped on the card attach to it (use-attach-drop.ts). */
  readonly dropProps: Partial<RowDropProps>;
  /** Files are over the card: it lights as their target, or refuses them when full. */
  readonly dropLook: RowDropLook;
}

/** What an item is called on its row's buttons: its words, or its title when it has one. */
const rowName = (item: ShelfItem): string =>
  item.kind === "text" ? item.text : (item.title ?? itemText(item));

const percent = (value: number, total: number): string =>
  `${(value / total) * 100}%`;

/** An image's main line: its title, else its note, else what kind of image it is. */
const imageCaption = (item: ImageItem): string =>
  item.title ?? (item.note === "" ? PICTURE_KIND[item.via] : item.note);

const metaText = (item: ShelfItem): string => {
  const when = whenText(item.createdAt);

  if (item.kind === "text") {
    return item.via === "selection" ? `${when} · from a selection` : when;
  }

  if (item.kind === "file") {
    return `${when} · ${fileSizeText(item.file.bytes)}`;
  }

  const where = item.source === null ? "" : ` · ${item.source}`;

  return `${when} · ${PICTURE_KIND[item.via]}${where}`;
};

/**
 * Edits a text item in place, with its Markdown formatted as it is typed;
 * ⌘↩ or Return saves, ⇧↩ adds a line or list item, Escape keeps the old text.
 * The words reach main as they are typed, after a short pause, so main
 * holds them as it holds every other edit (Round 7).
 */
export const TextEditor = ({
  caretAt = null,
  item,
  onDone,
  onSave,
}: {
  readonly item: TextItem;
  readonly onSave: (text: string) => void;
  readonly onDone: () => void;
  /** Where a click started the edit: the caret goes there, else to the end. */
  readonly caretAt?: ScreenPoint | null;
}) => {
  const [text, setText] = useState(item.text);
  // Escape throws the edit away; the blur that follows must not save it.
  const cancelled = useRef(false);
  const live = useRef<LiveEdit | null>(null);

  // Opened at the first key, while the item still holds the words the field opened with.
  const edit = (): LiveEdit => {
    const current =
      live.current ??
      liveEdits.open({ original: item.text, owner: item.id, send: onSave });

    live.current = current;

    return current;
  };

  // A row that goes away mid-edit still sends what was typed.
  useEffect(
    () => () => {
      live.current?.flush();
    },
    []
  );

  const finish = (markdown: string): void => {
    if (cancelled.current) {
      return;
    }

    cancelled.current = true;
    edit().finish(markdown);
    onDone();
  };

  return (
    <MarkdownField
      ariaLabel="Edit item"
      autoFocus
      caretAt={caretAt}
      // The read text's own type, so the words stay exactly where they were.
      className={cn("min-h-0", WORDS, item.done && DONE, EDITING)}
      keys={{
        onEscape: () => {
          cancelled.current = true;
          live.current?.cancel();
          onDone();
        },
        onSubmit: finish,
      }}
      onBlur={(markdown) => {
        // An untouched note keeps its own Markdown, not the field's rewrite of it.
        finish(markdown === text ? markdown : text);
      }}
      followValue={false}
      onChange={(markdown) => {
        setText(markdown);
        edit().change(markdown);
      }}
      value={item.text}
    />
  );
};

/** The picture, which selects on click, opens large on a double-click and drags out as a file. */
const Picture = ({
  compact,
  item,
  onContextMenu,
  onDragImage,
  onOpen,
  onSelect,
  tallest = 0,
}: {
  readonly item: ImageItem;
  readonly compact: boolean;
  /** Open, as tall as the row's budget lets it (open-row.ts): the first part to give way. */
  readonly tallest?: number;
} & Pick<
  RowHandlers,
  "onContextMenu" | "onDragImage" | "onOpen" | "onSelect"
>) => (
  <button
    aria-label={`Select: ${imageCaption(item)}`}
    className={cn(
      "bg-muted after:ring-foreground/10 focus-visible:ring-ring/50 relative block shrink-0 cursor-grab overflow-hidden rounded-md outline-none after:pointer-events-none after:absolute after:inset-0 after:rounded-md after:ring-1 after:ring-inset focus-visible:ring-3 active:cursor-grabbing",
      // A third of the row, and 4rem in a shelf under 340 px, so the words beside it keep room to read; open, as
      // wide as the picture shows (12rem tall at most), so its pins stay on what they mark.
      compact ? "w-[clamp(4rem,32%,6rem)] max-[340px]:w-16" : "w-fit max-w-full"
    )}
    draggable
    data-row-keys
    data-row-part={compact ? undefined : "picture"}
    onClick={onSelect}
    onContextMenu={contextMenuAt(onContextMenu)}
    onDoubleClick={onOpen}
    onDragStart={(event) => {
      // A system drag of the file itself, not the card's move within the shelf.
      event.preventDefault();
      event.stopPropagation();
      onDragImage();
    }}
    title="Double-click to open, or drag into another app"
    type="button"
  >
    <img
      alt={imageCaption(item)}
      className={cn(
        "block h-auto",
        compact ? "w-full" : "max-h-(--picture) w-auto max-w-full"
      )}
      draggable={false}
      height={item.image.heightPx}
      src={insetUrl.attachment(item.image.file)}
      style={compact ? undefined : { "--picture": `${tallest}px` }}
      width={item.image.widthPx}
    />
    {item.pins.map((pin, index) => (
      <PinMarker
        height={compact ? 13 : 20}
        inset
        // Pins have no identity but their place, which is their number.
        // oxlint-disable-next-line react/no-array-index-key
        key={index}
        left={percent(pin.x, item.image.widthPx)}
        number={index + 1}
        top={percent(pin.y, item.image.heightPx)}
      />
    ))}
  </button>
);

/** Unselected images are a thumbnail beside their note; the selected one opens full width, with a field for its note only while it is edited. */
const ImageBody = ({
  editing,
  item,
  onContextMenu,
  onDragImage,
  onEdit,
  onEditNote,
  onHide,
  onOpen,
  onSelect,
  onStopEditing,
  selected,
}: {
  readonly item: ImageItem;
  readonly selected: boolean;
  readonly editing: boolean;
} & Pick<
  RowHandlers,
  | "onContextMenu"
  | "onDragImage"
  | "onEdit"
  | "onEditNote"
  | "onHide"
  | "onOpen"
  | "onSelect"
  | "onStopEditing"
>) => {
  const budget = budgetOf(useContext(OpenRow));

  if (!selected && !editing) {
    return (
      <div className="flex gap-2.5">
        <Picture
          compact
          item={item}
          onContextMenu={onContextMenu}
          onDragImage={onDragImage}
          onOpen={onOpen}
          onSelect={onSelect}
        />
        <button
          className={cn(
            "focus-visible:ring-ring/50 flex min-w-0 flex-1 items-start rounded-sm text-left text-sm leading-snug break-words outline-none focus-visible:ring-3",
            item.note === "" && "text-muted-foreground",
            item.done && "text-muted-foreground line-through"
          )}
          data-row-keys
          onClick={onSelect}
          onContextMenu={contextMenuAt(onContextMenu)}
          type="button"
        >
          {/* A clamp has no effect on a button itself, only on a box inside it. */}
          {item.title === null ? (
            <span className="line-clamp-2 min-w-0">
              {item.note === "" ? PICTURE_KIND[item.via] : item.note}
            </span>
          ) : (
            <span className="flex min-w-0 flex-col">
              <span className="line-clamp-2 font-medium">{item.title}</span>
              {item.note === "" ? null : (
                <span className="text-muted-foreground line-clamp-1">
                  {item.note}
                </span>
              )}
            </span>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <Picture
        compact={false}
        item={item}
        tallest={budget.picture}
        onContextMenu={onContextMenu}
        onDragImage={onDragImage}
        onOpen={onOpen}
        onSelect={onSelect}
      />
      {item.title === null ? null : (
        <RowText
          className={cn(
            "text-sm leading-snug font-medium break-words",
            item.done && "text-muted-foreground line-through"
          )}
          part="title"
        >
          {item.title}
        </RowText>
      )}
      <Note
        editing={editing}
        item={item}
        onContextMenu={onContextMenu}
        onEdit={onEdit}
        onEditNote={onEditNote}
        onHide={onHide}
        onSelect={onSelect}
        onStopEditing={onStopEditing}
        selected={selected}
      />
    </div>
  );
};

/** A file's title: two lines on the closed row, three on the open one until Show more. */
const FileTitle = ({
  item,
  onContextMenu,
  onSelect,
  selected,
}: {
  readonly item: FileItem;
  readonly selected: boolean;
} & Pick<RowHandlers, "onContextMenu" | "onSelect">) => {
  const title = (
    <button
      className={cn(
        "focus-visible:ring-ring/50 w-full rounded-sm text-left text-sm leading-snug font-medium break-words outline-none focus-visible:ring-3",
        item.done && "text-muted-foreground line-through"
      )}
      data-row-keys
      onClick={onSelect}
      onContextMenu={contextMenuAt(onContextMenu)}
      type="button"
    >
      <span className={cn("block", !selected && "line-clamp-2")}>
        {item.title}
      </span>
    </button>
  );

  return selected ? (
    <RowText className="text-sm leading-snug" part="title">
      {title}
    </RowText>
  ) : (
    title
  );
};

/** An attached file's name with its note: a field while the file is selected, else the note as text. */
const FileBody = ({
  badges,
  editing,
  item,
  onContextMenu,
  onDragImage,
  onEdit,
  onEditNote,
  onHide,
  onSelect,
  onStopEditing,
  selected,
}: {
  readonly item: FileItem;
  readonly selected: boolean;
  readonly editing: boolean;
  /** Without a source line, the badges sit on the file's own line. */
  readonly badges: readonly ReactNode[];
} & Pick<
  RowHandlers,
  | "onContextMenu"
  | "onDragImage"
  | "onEdit"
  | "onEditNote"
  | "onHide"
  | "onSelect"
  | "onStopEditing"
>) => (
  <div className="flex min-w-0 flex-col gap-2">
    {item.title === null ? null : (
      <FileTitle
        item={item}
        onContextMenu={onContextMenu}
        onSelect={onSelect}
        selected={selected}
      />
    )}
    <BadgeLine badges={badges} ownLine reach={item.title !== null}>
      <FileName
        item={item}
        onContextMenu={onContextMenu}
        onDragImage={onDragImage}
        onSelect={onSelect}
      />
    </BadgeLine>
    <Note
      editing={editing}
      item={item}
      onContextMenu={onContextMenu}
      onEdit={onEdit}
      onEditNote={onEditNote}
      onHide={onHide}
      onSelect={onSelect}
      onStopEditing={onStopEditing}
      selected={selected}
    />
  </div>
);

/** A text item's words, clamped to two lines until it is selected, and its links while it is. */
const TextBody = ({
  editing,
  item,
  links,
  onContextMenu,
  onEdit,
  onEditText,
  onOpenLink,
  onSelect,
  onStopEditing,
  selected,
}: {
  readonly item: TextItem;
  readonly selected: boolean;
  readonly editing: boolean;
  /** The open row lists the links its words held. */
  readonly links: boolean;
} & Pick<
  RowHandlers,
  | "onContextMenu"
  | "onEdit"
  | "onEditText"
  | "onOpenLink"
  | "onSelect"
  | "onStopEditing"
>) => {
  const [caretAt, setCaretAt] = useCaretStart<ScreenPoint>(editing);

  if (editing) {
    return (
      <TextEditor
        caretAt={caretAt}
        item={item}
        onDone={onStopEditing}
        onSave={onEditText}
      />
    );
  }

  const words = cn(WORDS, item.done && DONE);

  return (
    <>
      {/* Open, a click on its words edits them there and its links work; closed, the whole text selects the card and shows two lines. */}
      {selected ? (
        // Ten lines at most until Show more, fewer when the rest of the row needs the room, so one item never fills the shelf; an edit shows all of it.
        <RowText className={WORDS} part="words">
          {/* Where focus comes back to from details: the row, whose keys are Return and Space. */}
          {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- Return on the row edits it (use-shelf-keys.ts); the click only says where the caret goes. */}
          <div
            className="cursor-text rounded-sm outline-none"
            data-row-keys
            onClick={(event) => {
              const point = editPoint(wordsClick(event));

              if (point !== null) {
                setCaretAt(point);
                onEdit();
              }
            }}
            tabIndex={-1}
          >
            <Markdown
              className={words}
              interactive
              onOpenLink={onOpenLink}
              text={item.text}
            />
          </div>
        </RowText>
      ) : (
        <button
          className={cn(
            "focus-visible:ring-ring/50 rounded-sm text-left outline-none focus-visible:ring-3",
            words
          )}
          data-row-keys
          onClick={onSelect}
          onContextMenu={contextMenuAt(onContextMenu)}
          onDoubleClick={onEdit}
          type="button"
        >
          <Markdown
            className="line-clamp-2"
            interactive={false}
            onOpenLink={onOpenLink}
            text={item.text}
          />
        </button>
      )}
      {links ? <LinkList links={item.links} onOpenLink={onOpenLink} /> : null}
    </>
  );
};

/**
 * The line under an item: where it came from on the left, its metadata
 * badges on the right. Without a source the badges keep the line to
 * themselves, still on one line.
 */
const SourceRow = ({
  badges,
  context,
  onOpenLink,
}: {
  readonly badges: readonly ReactNode[];
  readonly context: ItemContext | null;
  readonly onOpenLink: () => void;
}) => (
  <BadgeLine badges={badges} reach>
    {context === null ? null : (
      <SourceLine context={context} onOpenLink={onOpenLink} />
    )}
  </BadgeLine>
);

/**
 * What an open row shows besides its words, each only once it is set: pin
 * labels, the description, checkable steps and the linked windows, each as
 * much as the row's budget gives it (open-row.ts), with one line that says
 * how much more details hold and opens them.
 */
const Expansion = ({
  extras,
  item,
  onReopenWindow,
  onShowDetails,
  onToggleStep,
  steps: listed,
}: {
  readonly extras: RowExtras;
  readonly item: ShelfItem;
  /** The item's steps in the order the row lists them. */
  readonly steps: readonly Step[];
  readonly onToggleStep: (step: Step) => void;
  readonly onReopenWindow: (window: WindowRef) => void;
  readonly onShowDetails: () => void;
}) => {
  const budget = budgetOf(useContext(OpenRow));

  if (
    !extras.description &&
    extras.steps === 0 &&
    extras.windows === 0 &&
    extras.pinLegend === 0
  ) {
    return null;
  }

  const pins = Math.min(extras.pinLegend, budget.pins);
  const steps = Math.min(extras.steps, budget.steps);

  const more = moreText({
    pins: extras.pinLegend - pins,
    steps: extras.steps - steps,
    windows: budget.windows ? 0 : extras.windows,
  });

  return (
    <div className="flex flex-col gap-2 pt-0.5">
      {extras.pinLegend === 0 || item.kind !== "image" ? null : (
        <div data-row-part="pins">
          <PinLegend pins={item.pins} shown={pins} />
        </div>
      )}
      {extras.description ? (
        <RowText
          className="text-muted-foreground text-sm leading-snug break-words whitespace-pre-line"
          part="description"
        >
          {item.description.trim()}
        </RowText>
      ) : null}
      {extras.steps === 0 ? null : (
        <div data-row-part="steps">
          <StepChecklist
            onToggle={onToggleStep}
            steps={listed.slice(0, steps)}
          />
        </div>
      )}
      {extras.windows === 0 || !budget.windows ? null : (
        <div data-row-part="windows">
          <WindowStrip
            more={Math.max(0, extras.windows - ROW_WINDOWS)}
            onMore={onShowDetails}
            onReopen={onReopenWindow}
            windows={item.windows.slice(0, ROW_WINDOWS)}
          />
        </div>
      )}
      {more === null ? null : (
        <Button
          className="-ml-2 max-w-full self-start"
          data-row-part="more-line"
          onClick={onShowDetails}
          size="xs"
          variant="quiet"
        >
          <Truncated className="min-w-0" text={more} />
          <HugeiconsIcon data-icon="inline-end" icon={ArrowRight01Icon} />
        </Button>
      )}
    </div>
  );
};

/** A colour tag shows as a coloured bar along the card's left edge. */
const TagStripe = ({ item }: { readonly item: ShelfItem }) =>
  item.color === null ? null : (
    <span
      aria-hidden="true"
      className="absolute top-2 bottom-2 left-0 w-[3px] rounded-r-full bg-(--tag)"
      style={{ "--tag": COLOR_HEX[item.color] }}
    />
  );

/** ⋯, which opens the item's menu under it: shown on the open row, on hover or focus, and as a tick once copied. */
const MoreButton = ({
  copied,
  onOpen,
  shown,
}: {
  readonly copied: boolean;
  readonly onOpen: RowHandlers["onContextMenu"];
  readonly shown: boolean;
}) => (
  <span
    className={cn(
      "-my-0.5 shrink-0",
      shown
        ? "opacity-100"
        : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
    )}
  >
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={copied ? "Copied" : "More"}
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();

            onOpen({
              align: "end",
              height: box.height,
              width: box.width,
              x: box.left,
              y: box.top,
            });
          }}
          size="icon-xs"
          variant="ghost"
        >
          <HugeiconsIcon icon={copied ? Tick02Icon : MoreHorizontalIcon} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left">{copied ? "Copied" : "More"}</TooltipContent>
    </Tooltip>
  </span>
);

/** The open row's foot: when and how it was captured, and Details (→). */
const OpenFooter = ({
  badges,
  item,
  onShowDetails,
}: {
  /** An open row without a source carries its badges here, saving it a line. */
  readonly badges: readonly ReactNode[];
  readonly item: ShelfItem;
  readonly onShowDetails: () => void;
}) => (
  // Reaches under the ⋯ column, as the badges do, and past the button's own inset, so the › ends where the Due chip does.
  <div className="-mr-9 flex min-h-6 items-center gap-2">
    <Truncated
      className="text-muted-foreground min-w-0 flex-1 text-xs"
      text={metaText(item)}
    />
    {badges.length === 0 ? null : (
      <div className="flex shrink-0 items-center gap-1">{badges}</div>
    )}
    <Button
      aria-label="Show details"
      className="-mr-2.75 shrink-0"
      data-details-button
      onClick={onShowDetails}
      size="xs"
      title={`Details (${keyText("Right", isMac)})`}
      variant="quiet"
    >
      Details
      <HugeiconsIcon data-icon="inline-end" icon={ArrowRight01Icon} />
    </Button>
  </div>
);

const DROP_LOOK: Readonly<Record<RowDropLook, string | null>> = {
  full: "ring-destructive/50 ring-2 ring-inset",
  none: null,
  open: "bg-pin/10 ring-pin ring-2 ring-inset",
};

/**
 * Which line carries a row's badges: a file's name without a source, else
 * the source line; open and without a source, the Details line, which saves
 * the open row a line.
 */
const placeBadges = (
  parts: ReturnType<typeof rowParts>,
  item: ShelfItem,
  open: boolean,
  badges: readonly ReactNode[]
) => {
  const foot = parts.badgesOn === "source" && open && item.context === null;
  const on = foot ? "foot" : parts.badgesOn;

  return {
    file: on === "file" ? badges : [],
    foot: on === "foot" ? badges : [],
    source: on === "source" ? badges : [],
  };
};

/**
 * The steps in the order the open row lists them, fixed when it opens
 * (row-parts.ts rowSteps): a step ticked there stays under the pointer.
 */
const useRowSteps = (
  steps: readonly Step[],
  open: boolean
): readonly Step[] => {
  const [opened, setOpened] = useState({ checked: checkedSteps(steps), open });

  if (opened.open !== open) {
    setOpened({ checked: checkedSteps(steps), open });
  }

  return rowSteps(steps, opened.checked);
};

const RowView = (props: RowViewProps) => {
  const { copied, editing, item, selected } = props;
  const parts = rowParts(item, selected);
  const badges = badgeNodes(parts.badges, props.now);
  const rowRef = useRef<HTMLLIElement>(null);
  const steps = useRowSteps(item.steps, selected);
  const openRow = useOpenRow(rowRef, selected && !editing, item, steps);
  const placed = placeBadges(parts, item, selected, badges);

  return (
    <OpenRow value={openRow}>
      <li
        aria-current={selected ? "true" : undefined}
        className={cn(
          "group bg-background/60 relative flex items-start gap-3 rounded-lg border px-3 py-2.5",
          selected || props.picked
            ? "border-primary"
            : "border-foreground/10 hover:border-foreground/20",
          props.picked && "bg-primary/10",
          props.dragging && "opacity-40",
          DROP_LOOK[props.dropLook]
        )}
        data-item-id={item.id}
        ref={rowRef}
        // A modified click picks instead of opening; caught before the card's own buttons see it.
        onClickCapture={(event) => {
          const toggle = isMac ? event.metaKey : event.ctrlKey;

          if (toggle || event.shiftKey) {
            event.preventDefault();
            event.stopPropagation();
            props.onPick(event.shiftKey ? "range" : "toggle");
          }
        }}
        // A text field inside keeps ordinary text dragging.
        {...(editing ? {} : props.dragProps)}
        {...props.dropProps}
        // An open text item has no button of its own: a double-click edits it, a right-click opens its menu.
        onContextMenuCapture={(event) => {
          if (!isTextField(event.target)) {
            contextMenuAt(props.onContextMenu)(event);
            event.stopPropagation();
          }
        }}
        onDoubleClickCapture={(event) => {
          if (
            item.kind === "text" &&
            selected &&
            !editing &&
            !(
              event.target instanceof Element &&
              event.target.closest("a") !== null
            )
          ) {
            props.onEdit();
          }
        }}
      >
        <TagStripe item={item} />
        <Checkbox
          aria-label={item.done ? "Mark as not done" : "Mark as done"}
          checked={item.done}
          className="mt-0.5"
          onCheckedChange={props.onToggle}
          {...coach("item-check")}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {props.example === true ? (
            <span className="bg-foreground/5 text-muted-foreground w-fit rounded-sm px-1.5 text-xs">
              Example
            </span>
          ) : null}
          {item.kind === "text" ? (
            <TextBody
              editing={editing}
              item={item}
              links={parts.extras?.links === true}
              onContextMenu={props.onContextMenu}
              onEdit={props.onEdit}
              onEditText={props.onEditText}
              onOpenLink={props.onOpenLink}
              onSelect={props.onSelect}
              onStopEditing={props.onStopEditing}
              selected={selected}
            />
          ) : null}
          {item.kind === "image" ? (
            <ImageBody
              editing={editing}
              item={item}
              onContextMenu={props.onContextMenu}
              onDragImage={props.onDragImage}
              onEdit={props.onEdit}
              onEditNote={props.onEditNote}
              onHide={props.onHide}
              onOpen={props.onOpen}
              onSelect={props.onSelect}
              onStopEditing={props.onStopEditing}
              selected={selected}
            />
          ) : null}
          {item.kind === "file" ? (
            <FileBody
              badges={placed.file}
              editing={editing}
              item={item}
              onContextMenu={props.onContextMenu}
              onDragImage={props.onDragImage}
              onEdit={props.onEdit}
              onEditNote={props.onEditNote}
              onHide={props.onHide}
              onSelect={props.onSelect}
              onStopEditing={props.onStopEditing}
              selected={selected}
            />
          ) : null}
          <AttachmentStrip
            attachments={item.attachments}
            handlers={props.attachments}
            onMore={props.onShowDetails}
            onSelect={props.onSelect}
            strip={parts.strip}
          />
          {parts.extras === null ? null : (
            <Expansion
              extras={parts.extras}
              item={item}
              onReopenWindow={props.onReopenWindow}
              onShowDetails={props.onShowDetails}
              onToggleStep={props.onToggleStep}
              steps={steps}
            />
          )}
          <SourceRow
            badges={placed.source}
            context={item.context}
            onOpenLink={() => {
              props.onOpenLink();
            }}
          />
          {props.notSaved === undefined ? null : (
            <NotSavedLine
              name={rowName(item)}
              undo={props.notSaved.undo}
              onDiscard={props.onDiscardChanges}
              onRetry={props.onRetrySave}
            />
          )}
          {selected ? (
            <OpenFooter
              badges={placed.foot}
              item={item}
              onShowDetails={props.onShowDetails}
            />
          ) : null}
        </div>
        <MoreButton
          copied={copied}
          onOpen={props.onContextMenu}
          shown={selected || copied}
        />
      </li>
    </OpenRow>
  );
};

/** A row's data, and the list's actions; the row re-renders only when its data changes. */
export type ItemRowProps = Omit<
  RowViewProps,
  keyof ReturnType<typeof bindRow>
> & {
  readonly actions: RowActions;
};

/**
 * One item in the list. Memoised on its data: a change to another row, the
 * selection elsewhere or the search text leaves it alone. Its handlers are
 * bound once per item and call the list's latest code when they run.
 */
const BoundRow = ({ actions, ...props }: ItemRowProps) => {
  const { item, selected } = props;

  const handlers = useMemo(
    () => bindRow(actions, item, selected),
    [actions, item, selected]
  );

  return <RowView {...props} {...handlers} />;
};

export const ItemRow = memo(BoundRow);

import {
  ArrowRight01Icon,
  ChatGptIcon,
  ClaudeIcon,
  CodeIcon,
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
import { Button } from "@inset/ui/components/button";
import { cn } from "@inset/ui/lib/utils";
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
import type { SourceLabel, Service } from "@shared/web-source";
import {
  createContext,
  isValidElement,
  memo,
  use,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode, RefObject } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Clamp,
  TOOLTIP_MAX,
  tooltipText,
  Truncated,
  useCut,
} from "@/shared/clamp";
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
import { bindRow } from "./row-actions";
import type { RowActions } from "./row-actions";
import { contextMenuAt, DONE, EDITING, WORDS } from "./row-look";
import { checkedSteps, linksOf, ROW_CAPS, rowParts } from "./row-parts";
import type { RowLinks, RowOpen } from "./row-parts";
import type { RowDropLook, RowDropProps } from "./use-attach-drop";
import type { ItemDrag } from "./use-item-drag";
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

/** Where a click on the source line leads. */
interface Leads {
  /** The page it opens, shown unless the line already says it. */
  readonly to: string | null;
  /** The file it is from, from home: it keeps room of its own in the tooltip, and its end. */
  readonly path: string | null;
  /** What a click does, which the tooltip never cuts. */
  readonly action: string | null;
}

/** The room a tooltip keeps for a file's folder when the line beside it is too long to show whole. */
const FOLDER_KEPT = 60;

/** The least room worth giving a folder beside a whole line: under it, the folder's end says nothing. */
const FOLDER_LEAST = 12;

/** `text` in `room` characters, losing its start: a path's end is its nearest part. */
const endOf = (text: string, room: number): string =>
  text.length > room ? `…${text.slice(1 - room)}` : text;

/**
 * The lines that say where a code item's file is, in `room` characters. A
 * line that shows whole leaves the path to say it all, the file's name at its
 * end. A line that shows cut is given whole first, name and all, so the path
 * under it is the folder alone, in the room that is left. Only a line too
 * long for the tooltip is cut, and the folder then keeps room of its own.
 */
const fileLines = (
  shown: string,
  path: string,
  cut: boolean,
  room: number
): readonly string[] => {
  if (!cut) {
    return [endOf(path, room)];
  }

  const folder = path.slice(0, path.lastIndexOf("/") + 1);
  const left = room - 1 - shown.length;

  if (folder === "" || (left >= 0 && left < FOLDER_LEAST)) {
    return [tooltipText(shown, room)];
  }

  const where = endOf(folder, left < 0 ? FOLDER_KEPT : left);

  return [tooltipText(shown, room - 1 - where.length), where];
};

/**
 * The source line's tooltip: the whole line when it shows cut, then where it
 * leads (the page, or the file), then what a click does, 300 characters in
 * all; undefined when it would only repeat what shows.
 */
const sourceTitle = (
  shown: string,
  { action, path, to }: Leads,
  cut: boolean
): string | undefined => {
  const last = action === null || action === shown ? [] : [action];

  const room =
    TOOLTIP_MAX - last.reduce((sum, each) => sum + each.length + 1, 0);

  if (path !== null && path !== shown) {
    return [...fileLines(shown, path, cut, room), ...last].join("\n");
  }

  const lines = [
    ...(cut ? [shown] : []),
    ...(to === null || to === shown ? [] : [to]),
  ];

  return lines.length === 0
    ? last[0]
    : [tooltipText(lines.join("\n"), room), ...last].join("\n");
};

/** Where a click on the source line leads: the page, the app, or the file (from home) in its editor. */
const leadsTo = (
  context: ItemContext,
  app: string | null,
  code: SourceLabel["code"]
): Leads => {
  if (app === null) {
    return { action: null, path: null, to: context.url };
  }

  return context.code === null
    ? { action: `Open ${app}`, path: null, to: null }
    : { action: `Open in ${app}`, path: code?.path ?? null, to: null };
};

/** The user's home folder, from the shelf's view: a code item's path shows from "~". */
export const HomeFolder = createContext<string | null>(null);

/**
 * Where an item came from, in one quiet line: the site and what on it for
 * pages the shelf knows, the file and project for a code editor, else the app
 * and window. A page address opens in the browser, a code item's file in its
 * editor.
 */
export const SourceLine = ({
  context,
  onOpenLink,
}: {
  readonly context: ItemContext;
  readonly onOpenLink: () => void;
}): ReactNode => {
  const { code, label, service } = sourceLabel(context, use(HomeFolder));
  const serviceIcon = service === null ? Link01Icon : SERVICE_ICON[service];
  const icon = code === undefined ? serviceIcon : CodeIcon;
  // A code editor opens its file again; a desktop app it came from opens again (elsewhere than macOS, only at a link); else the page does.
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
        title={sourceTitle(
          label,
          { action: null, path: code?.path ?? null, to: null },
          plainCut
        )}
      >
        {service === null && code === undefined ? null : (
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
      title={sourceTitle(shown, leadsTo(context, app, code), linkCut)}
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
  fold,
  link,
  onOpenLink,
  siteShown,
}: {
  /** On one line where the row is long already: its site shows beside the words when it fits whole, and not at all when it doesn't. */
  readonly fold: boolean;
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
      title={sourceTitle(
        link.text,
        { action: null, path: null, to: link.url },
        cut
      )}
      type="button"
    >
      <HugeiconsIcon
        className="text-muted-foreground shrink-0"
        icon={Link01Icon}
        size={12}
      />
      {/* The site goes under the words when both don't fit on one line, so it stays readable. A folded row shows only the first line: a site that would be cut to a few letters isn't shown, and its link's tooltip still names the address. */}
      <span
        className={cn(
          "flex min-w-0 flex-wrap gap-x-1.5",
          fold && "h-4 overflow-hidden"
        )}
      >
        <span className="max-w-full truncate">{link.text}</span>
        {link.text === link.url || siteShown ? null : (
          <span
            className="text-muted-foreground max-w-full truncate"
            data-link-site
          >
            {hostOf(link.url)}
          </span>
        )}
      </span>
    </button>
  );
};

/** The links in a copied selection, listed while the item is open; each opens in the browser. */
export const LinkList = ({
  fold = false,
  links,
  onOpenLink,
  sourceUrl = null,
}: {
  /** Each link on one line. */
  readonly fold?: boolean;
  readonly links: TextItem["links"];
  readonly onOpenLink: (url: string) => void;
  /** The page the source line above names: a link on the same site doesn't name it again. */
  readonly sourceUrl?: string | null;
}) => (
  <div className="flex flex-col gap-0.5">
    {links.map((link) => (
      <LinkRow
        fold={fold}
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

/** What the foot says after the time: how the item was captured, a file's size, a picture's source. Empty for a typed note. */
const metaRest = (item: ShelfItem): string => {
  if (item.kind === "text") {
    return item.via === "selection" ? "from a selection" : "";
  }

  if (item.kind === "file") {
    return fileSizeText(item.file.bytes);
  }

  const where = item.source === null ? "" : ` · ${item.source}`;

  return `${PICTURE_KIND[item.via]}${where}`;
};

const metaText = (item: ShelfItem): string => {
  const when = whenText(item.createdAt);
  const rest = metaRest(item);

  return rest === "" ? when : `${when} · ${rest}`;
};

/**
 * The foot's words beside badges, where room is short: the time always
 * shows, and what follows it shows when it has room for a word or two and
 * not at all when it would be cut to a letter. The whole line is the time's
 * tooltip then.
 */
const FootWords = ({ item }: { readonly item: ShelfItem }) => {
  const rest = metaRest(item);

  return (
    <span
      className="text-muted-foreground flex h-4 min-w-0 flex-1 flex-wrap gap-x-1 overflow-hidden text-xs"
      data-foot-words
    >
      <Truncated
        className="min-w-0"
        text={whenText(item.createdAt)}
        tooltip={metaText(item)}
      />
      {rest === "" ? null : (
        <Truncated className="min-w-16 flex-1" text={`· ${rest}`} />
      )}
    </span>
  );
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
}: {
  readonly item: ImageItem;
  readonly compact: boolean;
} & Pick<
  RowHandlers,
  "onContextMenu" | "onDragImage" | "onOpen" | "onSelect"
>) => (
  <button
    aria-label={`Select: ${imageCaption(item)}`}
    className={cn(
      "bg-muted after:ring-foreground/10 focus-visible:ring-ring/50 relative block shrink-0 cursor-grab overflow-hidden rounded-md outline-none after:pointer-events-none after:absolute after:inset-0 after:rounded-md after:ring-1 after:ring-inset focus-visible:ring-3 active:cursor-grabbing",
      // A third of the row, and 4rem in a shelf under 330 px, so the words beside it keep room to read; open, as
      // wide as the picture shows (12rem tall at most), so its pins stay on what they mark.
      compact ? "w-[clamp(4rem,32%,6rem)] max-[330px]:w-16" : "w-fit max-w-full"
    )}
    draggable
    data-row-keys
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
      style={compact ? undefined : { "--picture": `${ROW_CAPS.picture}px` }}
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
        onContextMenu={onContextMenu}
        onDragImage={onDragImage}
        onOpen={onOpen}
        onSelect={onSelect}
      />
      {item.title === null ? null : (
        <Clamp
          className={cn(
            "text-sm leading-snug font-medium break-words",
            item.done && "text-muted-foreground line-through"
          )}
          lines={ROW_CAPS.title}
          what="the title"
        >
          {item.title}
        </Clamp>
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
    <Clamp
      className="text-sm leading-snug"
      lines={ROW_CAPS.title}
      what="the title"
    >
      {title}
    </Clamp>
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
  /** The links its words held, which the open row lists: each folded to one line when its description is long. */
  readonly links: RowLinks;
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
        // Ten lines at most until Show more; an edit shows all of it.
        <Clamp className={WORDS} lines={ROW_CAPS.words} what="the text">
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
        </Clamp>
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
      {links === "none" ? null : (
        <LinkList
          fold={links === "folded"}
          links={item.links}
          onOpenLink={onOpenLink}
        />
      )}
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

/** A quiet line under a list that says how much more details hold, and opens them. */
const MoreLine = ({
  onShowDetails,
  text,
}: {
  readonly text: string;
  readonly onShowDetails: () => void;
}) => (
  <Button
    className="-ml-2 max-w-full self-start"
    onClick={onShowDetails}
    size="xs"
    variant="quiet"
  >
    <Truncated className="min-w-0" text={text} />
    <HugeiconsIcon data-icon="inline-end" icon={ArrowRight01Icon} />
  </Button>
);

const moreSteps = ({ more, moreDone }: { more: number; moreDone: number }) =>
  `${more} more ${more === 1 ? "step" : "steps"}${moreDone === 0 ? "" : ` · ${moreDone} done`}`;

/**
 * What an open row shows besides its words, each only once it is set: pin
 * labels, the description, checkable steps and the linked windows, each
 * under its own cap (row-parts.ts ROW_CAPS), with its own line under it
 * that says how much more details hold and opens them.
 */
const Expansion = ({
  item,
  onDescriptionLines,
  onReopenWindow,
  onShowDetails,
  onToggleStep,
  open,
}: {
  readonly open: RowOpen;
  readonly item: ShelfItem;
  /** How many lines the description takes whole. */
  readonly onDescriptionLines: (lines: number) => void;
  readonly onToggleStep: (step: Step) => void;
  readonly onReopenWindow: (window: WindowRef) => void;
  readonly onShowDetails: () => void;
}) => {
  const { pins, steps } = open;

  if (
    !open.description &&
    steps === null &&
    open.windows === 0 &&
    pins === null
  ) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2 pt-0.5">
      {pins === null || item.kind !== "image" ? null : (
        <div className="flex flex-col gap-1">
          <PinLegend pins={item.pins} shown={pins.shown} />
          {pins.more === 0 ? null : (
            <MoreLine
              onShowDetails={onShowDetails}
              text={`${pins.more} more ${pins.more === 1 ? "pin" : "pins"}`}
            />
          )}
        </div>
      )}
      {open.description ? (
        <Clamp
          className="text-muted-foreground text-sm leading-snug break-words whitespace-pre-line"
          lines={ROW_CAPS.description}
          onLines={onDescriptionLines}
          what="the description"
        >
          {item.description.trim()}
        </Clamp>
      ) : null}
      {steps === null ? null : (
        <div className="flex flex-col gap-1">
          <StepChecklist onToggle={onToggleStep} steps={steps.shown} />
          {steps.more === 0 ? null : (
            <MoreLine onShowDetails={onShowDetails} text={moreSteps(steps)} />
          )}
        </div>
      )}
      {open.windows === 0 ? null : (
        <WindowStrip
          onMore={onShowDetails}
          onReopen={onReopenWindow}
          windows={item.windows}
        />
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

/**
 * The open row's foot: when and how it was captured, and Details (→). A row
 * without a source has its badges here too, before Details, under the rules
 * of every badge line: the words give way, and the Due chip always shows.
 */
const OpenFooter = ({
  badges,
  item,
  onShowDetails,
}: {
  readonly badges: readonly ReactNode[];
  readonly item: ShelfItem;
  readonly onShowDetails: () => void;
}) => (
  // Reaches under the ⋯ column, as the badges do, and past the button's own inset, so the › ends where the Due chip does.
  <div className="-mr-9 flex min-h-6 items-center gap-2">
    <div className="min-w-0 flex-1">
      <BadgeLine badges={badges} reach={false}>
        {badges.length === 0 ? (
          <Truncated
            className="text-muted-foreground min-w-0 flex-1 text-xs"
            text={metaText(item)}
          />
        ) : (
          <FootWords item={item} />
        )}
      </BadgeLine>
    </div>
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
 * The steps checked when the row opened, which it lists last until it opens
 * again (row-parts.ts rowSteps): a step ticked there stays under the pointer.
 */
const useCheckedAtOpen = (
  steps: readonly Step[],
  open: boolean
): ReadonlySet<string> => {
  const [opened, setOpened] = useState({ checked: checkedSteps(steps), open });

  if (opened.open !== open) {
    setOpened({ checked: checkedSteps(steps), open });
  }

  return opened.checked;
};

/** An opened row comes into view whole where it fits, its Details line included. */
const useRevealOnOpen = (
  row: RefObject<HTMLElement | null>,
  open: boolean
): void => {
  useEffect(() => {
    const frame = open
      ? requestAnimationFrame(() => {
          row.current?.scrollIntoView({ block: "nearest" });
        })
      : null;

    return () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
    };
  }, [row, open]);
};

const RowView = (props: RowViewProps) => {
  const { copied, editing, item, selected } = props;

  const parts = rowParts(
    item,
    selected,
    useCheckedAtOpen(item.steps, selected)
  );

  const badges = badgeNodes(parts.badges, props.now);
  const rowRef = useRef<HTMLLIElement>(null);
  const [descriptionLines, setDescriptionLines] = useState(0);

  useRevealOnOpen(rowRef, selected && !editing);

  return (
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
            links={linksOf(parts.open, descriptionLines)}
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
            badges={parts.badgesOn === "file" ? badges : []}
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
        {parts.open === null ? null : (
          <Expansion
            item={item}
            onDescriptionLines={setDescriptionLines}
            onReopenWindow={props.onReopenWindow}
            onShowDetails={props.onShowDetails}
            onToggleStep={props.onToggleStep}
            open={parts.open}
          />
        )}
        <SourceRow
          badges={parts.badgesOn === "source" ? badges : []}
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
            badges={parts.badgesOn === "foot" ? badges : []}
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

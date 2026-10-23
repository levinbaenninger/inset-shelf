import {
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
import { insetUrl } from "@shared/inset-url";
import { TEXT_MAX } from "@shared/shelf";
import type {
  FileItem,
  ImageItem,
  ItemContext,
  ShelfItem,
  TextItem,
} from "@shared/shelf";
import { desktopApp, sourceLabel } from "@shared/web-source";
import type { Service } from "@shared/web-source";
import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { PinMarker } from "@/shared/pin-marker";
import { isMac } from "@/shared/platform";

import { whenText } from "./format";
import { Markdown } from "./markdown";
import { MarkdownField } from "./markdown-field";
import type { MenuAnchor } from "./menus";
import type { ItemDrag } from "./use-item-drag";
import { isTextField } from "./use-shelf-keys";

/** A right-click on any part of an item opens its menu at the pointer. */
const contextMenuAt =
  (open: RowHandlers["onContextMenu"]) =>
  (event: MouseEvent): void => {
    event.preventDefault();
    open({
      align: "start",
      height: 0,
      width: 0,
      x: event.clientX,
      y: event.clientY,
    });
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
 * Where an item came from, in one quiet line: the site and what on it for
 * pages the shelf knows, else the app and window. A page address opens in the
 * browser.
 */
const SourceLine = ({
  context,
  onOpenLink,
}: {
  readonly context: ItemContext;
  readonly onOpenLink: () => void;
}) => {
  const { label, service } = sourceLabel(context);
  const icon = service === null ? Link01Icon : SERVICE_ICON[service];
  // A desktop app it came from opens again; elsewhere the page does (isMac: only macOS can).
  const app = isMac ? desktopApp(context.app) : null;

  if (context.url === null && app === null) {
    return label === "" ? null : (
      <p className="text-muted-foreground flex min-w-0 items-center gap-1 text-xs">
        {service === null ? null : (
          <HugeiconsIcon className="shrink-0" icon={icon} size={12} />
        )}
        <span className="truncate">{label}</span>
      </p>
    );
  }

  return (
    <button
      className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex min-w-0 items-center gap-1 self-start rounded-sm text-left text-xs outline-none focus-visible:ring-3"
      onClick={onOpenLink}
      title={app === null ? (context.url ?? undefined) : `Open ${app}`}
      type="button"
    >
      <HugeiconsIcon className="shrink-0" icon={icon} size={12} />
      <span className="truncate">{label === "" ? context.url : label}</span>
    </button>
  );
};

const hostOf = (url: string): string =>
  new URL(url).hostname.replace(/^www\./u, "");

/** The links in a copied selection, listed while the item is open; each opens in the browser. */
const LinkList = ({
  links,
  onOpenLink,
}: {
  readonly links: TextItem["links"];
  readonly onOpenLink: (url: string) => void;
}) => (
  <div className="flex flex-col gap-0.5">
    {links.map((link) => (
      <button
        className="hover:bg-foreground/5 focus-visible:ring-ring/50 -mx-1 flex min-w-0 items-center gap-1.5 rounded-sm px-1 py-0.5 text-left text-xs outline-none focus-visible:ring-3"
        key={link.url}
        onClick={() => {
          onOpenLink(link.url);
        }}
        title={link.url}
        type="button"
      >
        <HugeiconsIcon
          className="text-muted-foreground shrink-0"
          icon={Link01Icon}
          size={12}
        />
        <span className="truncate">{link.text}</span>
        {link.text === link.url ? null : (
          <span className="text-muted-foreground shrink-0">
            {hostOf(link.url)}
          </span>
        )}
      </button>
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
    onClick={onSelect}
    onContextMenu={contextMenuAt(onContextMenu)}
    onDragStart={(event) => {
      // A system drag of the file itself, not the card's move within the shelf.
      event.preventDefault();
      event.stopPropagation();
      onDragImage();
    }}
    title="Drag into another app"
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
}

export interface ItemRowProps extends RowHandlers {
  readonly item: ShelfItem;
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
}

/** The outer diameter of the ring drawn into exports (src/main/pin-mark.ts). */
const PIN_DIAMETER_DIP = 28;

const percent = (value: number, total: number): string =>
  `${(value / total) * 100}%`;

const KIND_LABEL = {
  area: "Screen area",
  drawing: "Drawing",
  paste: "Pasted image",
  pin: "Pinned spot",
  screenshot: "Screenshot",
} as const;

const FILE_SIZE = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
  notation: "compact",
  style: "unit",
  unit: "byte",
  unitDisplay: "narrow",
});

const metaText = (item: ShelfItem): string => {
  const when = whenText(item.createdAt);

  if (item.kind === "text") {
    return item.via === "selection" ? `${when} · from a selection` : when;
  }

  if (item.kind === "file") {
    return `${when} · ${FILE_SIZE.format(item.file.bytes)}`;
  }

  const where = item.source === null ? "" : ` · ${item.source}`;

  return `${when} · ${KIND_LABEL[item.via]}${where}`;
};

/**
 * Edits a text item in place, with its Markdown formatted as it is typed;
 * ⌘↩ or Return saves, ⇧↩ adds a line or list item, Escape keeps the old text.
 */
const TextEditor = ({
  item,
  onDone,
  onSave,
}: {
  readonly item: TextItem;
  readonly onSave: (text: string) => void;
  readonly onDone: () => void;
}) => {
  const [text, setText] = useState(item.text);
  // Escape throws the edit away; the blur that follows must not save it.
  const cancelled = useRef(false);

  const finish = (markdown: string): void => {
    if (cancelled.current) {
      return;
    }

    cancelled.current = true;

    const next = markdown.trim().slice(0, TEXT_MAX);

    if (next !== "" && next !== item.text) {
      onSave(next);
    }

    onDone();
  };

  return (
    <div className="border-input dark:bg-input/30 focus-within:border-ring focus-within:ring-ring/50 rounded-lg border px-2.5 py-2 focus-within:ring-3">
      <MarkdownField
        ariaLabel="Edit item"
        autoFocus
        keys={{
          onEscape: () => {
            cancelled.current = true;
            onDone();
          },
          onSubmit: finish,
        }}
        onBlur={(markdown) => {
          // An untouched note keeps its own Markdown, not the field's rewrite of it.
          finish(markdown === text ? markdown : text);
        }}
        onChange={setText}
        value={item.text}
      />
    </div>
  );
};

/** The note under an image or a file saves as you type; the main process waits for a pause before writing. */
const NoteField = ({
  autoFocus,
  item,
  onChange,
  onDone,
  onHide,
}: {
  readonly item: ImageItem | FileItem;
  readonly autoFocus: boolean;
  readonly onChange: (note: string) => void;
  readonly onDone: () => void;
  readonly onHide: () => void;
}) => {
  const [note, setNote] = useState(item.note);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) {
      ref.current?.focus();
    }
  }, [autoFocus]);

  return (
    <Textarea
      aria-label={
        item.kind === "image" ? "Note for this image" : "Note for this file"
      }
      className="min-h-0 resize-none"
      maxLength={TEXT_MAX}
      onChange={(event) => {
        setNote(event.target.value);
        onChange(event.target.value);
      }}
      onKeyDown={(event) => {
        const escape = event.key === "Escape";

        if (
          escape ||
          (event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing)
        ) {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.blur();
          onDone();

          if (escape) {
            onHide();
          }
        }
      }}
      placeholder="What matters here?"
      ref={ref}
      rows={1}
      value={note}
    />
  );
};

/**
 * The note under an image or file as text: two lines until the item is
 * selected. A double-click, Return or Edit Note opens it for typing.
 */
const NoteText = ({
  item,
  onContextMenu,
  onEdit,
  onSelect,
  selected,
}: {
  readonly item: ImageItem | FileItem;
  readonly selected: boolean;
} & Pick<RowHandlers, "onContextMenu" | "onEdit" | "onSelect">) =>
  item.note === "" ? null : (
    <button
      className={cn(
        "focus-visible:ring-ring/50 rounded-sm text-left text-sm leading-snug break-words whitespace-pre-wrap outline-none focus-visible:ring-3",
        item.done && "text-muted-foreground line-through",
        !selected && "line-clamp-2"
      )}
      onClick={onSelect}
      onContextMenu={contextMenuAt(onContextMenu)}
      onDoubleClick={onEdit}
      type="button"
    >
      {item.note}
    </button>
  );

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
    aria-label={item.note === "" ? "Select this image" : `Select: ${item.note}`}
    className={cn(
      "bg-muted after:ring-foreground/10 focus-visible:ring-ring/50 relative block shrink-0 cursor-grab overflow-hidden rounded-md outline-none after:pointer-events-none after:absolute after:inset-0 after:rounded-md after:ring-1 after:ring-inset focus-visible:ring-3 active:cursor-grabbing",
      compact ? "w-24" : "w-full"
    )}
    draggable
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
      alt={item.note === "" ? KIND_LABEL[item.via] : item.note}
      className="block h-auto w-full"
      draggable={false}
      height={item.image.heightPx}
      src={insetUrl.attachment(item.image.file)}
      width={item.image.widthPx}
    />
    {item.pin === null ? null : (
      <PinMarker
        left={percent(item.pin.x, item.image.widthPx)}
        top={percent(item.pin.y, item.image.heightPx)}
        width={percent(
          PIN_DIAMETER_DIP * item.image.pixelsPerDip,
          item.image.widthPx
        )}
      />
    )}
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
            "focus-visible:ring-ring/50 line-clamp-2 min-w-0 flex-1 rounded-sm text-left text-sm leading-snug break-words outline-none focus-visible:ring-3",
            item.note === "" && "text-muted-foreground",
            item.done && "text-muted-foreground line-through"
          )}
          onClick={onSelect}
          onContextMenu={contextMenuAt(onContextMenu)}
          type="button"
        >
          {item.note === "" ? KIND_LABEL[item.via] : item.note}
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
      {editing ? (
        <NoteField
          autoFocus
          item={item}
          key={item.id}
          onChange={onEditNote}
          onDone={onStopEditing}
          onHide={onHide}
        />
      ) : (
        <NoteText
          item={item}
          onContextMenu={onContextMenu}
          onEdit={onEdit}
          onSelect={onSelect}
          selected={selected}
        />
      )}
    </div>
  );
};

/** An attached file's name with its note: a field while the file is selected, else the note as text. */
const FileBody = ({
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
    <FileName
      item={item}
      onContextMenu={onContextMenu}
      onDragImage={onDragImage}
      onSelect={onSelect}
    />
    {editing ? (
      <NoteField
        autoFocus
        item={item}
        key={item.id}
        onChange={onEditNote}
        onDone={onStopEditing}
        onHide={onHide}
      />
    ) : (
      <NoteText
        item={item}
        onContextMenu={onContextMenu}
        onEdit={onEdit}
        onSelect={onSelect}
        selected={selected}
      />
    )}
  </div>
);

/** A text item's words, clamped to two lines until it is selected, and its links while it is. */
const TextBody = ({
  editing,
  item,
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
} & Pick<
  RowHandlers,
  | "onContextMenu"
  | "onEdit"
  | "onEditText"
  | "onOpenLink"
  | "onSelect"
  | "onStopEditing"
>) => {
  if (editing) {
    return (
      <TextEditor item={item} onDone={onStopEditing} onSave={onEditText} />
    );
  }

  const words = cn(
    "text-sm leading-snug break-words",
    item.done && "text-muted-foreground line-through"
  );

  return (
    <>
      {/* Open, its links work; closed, the whole text selects the card and shows two lines. */}
      {selected ? (
        <Markdown
          className={words}
          interactive
          onOpenLink={onOpenLink}
          text={item.text}
        />
      ) : (
        <button
          className={cn(
            "focus-visible:ring-ring/50 rounded-sm text-left outline-none focus-visible:ring-3",
            words
          )}
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
      {selected && item.links.length > 0 ? (
        <LinkList links={item.links} onOpenLink={onOpenLink} />
      ) : null}
    </>
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

export const ItemRow = (props: ItemRowProps) => {
  const { copied, editing, item, selected } = props;

  return (
    <li
      aria-current={selected ? "true" : undefined}
      className={cn(
        "group bg-background/60 relative flex items-start gap-3 rounded-lg border px-3 py-2.5",
        selected || props.picked
          ? "border-primary"
          : "border-foreground/10 hover:border-foreground/20",
        props.picked && "bg-primary/10",
        props.dragging && "opacity-40"
      )}
      data-item-id={item.id}
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
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {item.kind === "text" ? (
          <TextBody
            editing={editing}
            item={item}
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
        {item.context === null ? null : (
          <SourceLine
            context={item.context}
            onOpenLink={() => {
              props.onOpenLink();
            }}
          />
        )}
        {selected ? (
          <p className="text-muted-foreground text-xs">{metaText(item)}</p>
        ) : null}
      </div>
      <span
        className={cn(
          "-my-0.5 shrink-0",
          selected || copied
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

                props.onContextMenu({
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
          <TooltipContent side="left">
            {copied ? "Copied" : "More"}
          </TooltipContent>
        </Tooltip>
      </span>
    </li>
  );
};

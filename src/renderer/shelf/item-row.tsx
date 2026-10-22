import {
  File01Icon,
  Link01Icon,
  MoreHorizontalIcon,
  Tick02Icon,
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
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";

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

import { whenText } from "./format";

/** A right-click on any part of an item opens its native menu. */
const contextMenuAt =
  (open: RowHandlers["onContextMenu"]) =>
  (event: MouseEvent): void => {
    event.preventDefault();
    open({ x: event.clientX, y: event.clientY });
  };

/** Where an item came from, in one quiet line; a page address opens in the browser. */
const SourceLine = ({
  context,
  onOpenLink,
}: {
  readonly context: ItemContext;
  readonly onOpenLink: () => void;
}) => {
  const label = [context.app, context.title].filter(Boolean).join(" · ");

  if (context.url === null) {
    return label === "" ? null : (
      <p className="text-muted-foreground truncate text-xs">{label}</p>
    );
  }

  return (
    <button
      className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex min-w-0 items-center gap-1 self-start rounded-sm text-left text-xs outline-none focus-visible:ring-3"
      onClick={onOpenLink}
      title={context.url}
      type="button"
    >
      <HugeiconsIcon className="shrink-0" icon={Link01Icon} size={12} />
      <span className="truncate">{label === "" ? context.url : label}</span>
    </button>
  );
};

/** An attached file: its name and size; it drags out like an image. */
const FileBody = ({
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
      event.preventDefault();
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
      {item.note === "" ? item.file.name : item.note}
    </span>
  </button>
);

export interface RowHandlers {
  /** Opens the page an item was captured from. */
  readonly onOpenLink: () => void;
  readonly onSelect: () => void;
  /** A right-click opens the native item menu at that point. */
  readonly onContextMenu: (point: {
    readonly x: number;
    readonly y: number;
  }) => void;
  /** Double-clicking a text item edits it. */
  readonly onEdit: () => void;
  readonly onToggle: () => void;
  readonly onEditText: (text: string) => void;
  readonly onEditNote: (note: string) => void;
  readonly onStopEditing: () => void;
  readonly onDragImage: () => void;
}

export interface ItemRowProps extends RowHandlers {
  readonly item: ShelfItem;
  readonly selected: boolean;
  readonly editing: boolean;
  readonly copied: boolean;
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

/** Edits a text item in place; ⌘↩ or Return saves, ⇧↩ adds a line, Escape keeps the old text. */
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

  const finish = (): void => {
    if (text.trim() !== "" && text !== item.text) {
      onSave(text.trim());
    }

    onDone();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      finish();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onDone();
    }
  };

  return (
    <Textarea
      aria-label="Edit item"
      autoFocus
      className="min-h-0"
      maxLength={TEXT_MAX}
      onBlur={finish}
      onChange={(event) => {
        setText(event.target.value);
      }}
      onFocus={(event) => {
        const end = event.currentTarget.value.length;

        event.currentTarget.setSelectionRange(end, end);
      }}
      onKeyDown={onKeyDown}
      value={text}
    />
  );
};

/** The note under an image saves as you type; the main process waits for a pause before writing. */
const NoteField = ({
  autoFocus,
  item,
  onChange,
  onDone,
}: {
  readonly item: ImageItem;
  readonly autoFocus: boolean;
  readonly onChange: (note: string) => void;
  readonly onDone: () => void;
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
      aria-label="Note for this image"
      className="min-h-0"
      maxLength={TEXT_MAX}
      onChange={(event) => {
        setNote(event.target.value);
        onChange(event.target.value);
      }}
      onKeyDown={(event) => {
        if (
          event.key === "Escape" ||
          (event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing)
        ) {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.blur();
          onDone();
        }
      }}
      placeholder="What matters here?"
      ref={ref}
      rows={1}
      value={note}
    />
  );
};

/** The picture, which selects on click and drags out as a file. */
const Picture = ({
  compact,
  item,
  onContextMenu,
  onDragImage,
  onSelect,
}: {
  readonly item: ImageItem;
  readonly compact: boolean;
} & Pick<RowHandlers, "onContextMenu" | "onDragImage" | "onSelect">) => (
  <button
    aria-label={item.note === "" ? "Select this image" : `Select: ${item.note}`}
    className={cn(
      "bg-muted after:ring-foreground/10 focus-visible:ring-ring/50 relative block shrink-0 cursor-grab overflow-hidden rounded-md outline-none after:pointer-events-none after:absolute after:inset-0 after:rounded-md after:ring-1 after:ring-inset focus-visible:ring-3 active:cursor-grabbing",
      compact ? "w-24" : "w-full"
    )}
    draggable
    onClick={onSelect}
    onContextMenu={contextMenuAt(onContextMenu)}
    onDragStart={(event) => {
      event.preventDefault();
      onDragImage();
    }}
    title="Drag into another app"
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

/** Unselected images are a thumbnail beside their note; the selected one opens full width with its note field. */
const ImageBody = ({
  editing,
  item,
  onContextMenu,
  onDragImage,
  onEditNote,
  onSelect,
  onStopEditing,
  selected,
}: {
  readonly item: ImageItem;
  readonly selected: boolean;
  readonly editing: boolean;
} & Pick<
  RowHandlers,
  "onContextMenu" | "onDragImage" | "onEditNote" | "onSelect" | "onStopEditing"
>) => {
  if (!selected && !editing) {
    return (
      <div className="flex gap-2.5">
        <Picture
          compact
          item={item}
          onContextMenu={onContextMenu}
          onDragImage={onDragImage}
          onSelect={onSelect}
        />
        <button
          className={cn(
            "focus-visible:ring-ring/50 line-clamp-3 min-w-0 flex-1 rounded-sm text-left text-sm leading-snug break-words outline-none focus-visible:ring-3",
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
    <div className="flex flex-col gap-1.5">
      <Picture
        compact={false}
        item={item}
        onContextMenu={onContextMenu}
        onDragImage={onDragImage}
        onSelect={onSelect}
      />
      <NoteField
        autoFocus={editing}
        item={item}
        key={item.id}
        onChange={onEditNote}
        onDone={onStopEditing}
      />
    </div>
  );
};

/** A colour tag shows as a coloured left edge, drawn by [data-tagged] in styles.css. */
const tagAttributes = (item: ShelfItem) =>
  item.color === null
    ? {}
    : { "data-tagged": true, style: { "--tag": COLOR_HEX[item.color] } };

export const ItemRow = (props: ItemRowProps) => {
  const { copied, editing, item, selected } = props;

  return (
    <li
      aria-current={selected ? "true" : undefined}
      className={cn(
        "group bg-background/60 relative flex items-start gap-2.5 rounded-lg border px-2.5 py-2",
        selected
          ? "border-primary"
          : "border-foreground/10 hover:border-foreground/20"
      )}
      data-item-id={item.id}
      {...tagAttributes(item)}
    >
      <Checkbox
        aria-label={item.done ? "Mark as not done" : "Mark as done"}
        checked={item.done}
        className="mt-0.5"
        onCheckedChange={props.onToggle}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {item.kind === "text" && editing ? (
          <TextEditor
            item={item}
            onDone={props.onStopEditing}
            onSave={props.onEditText}
          />
        ) : null}
        {item.kind === "text" && !editing ? (
          <button
            className={cn(
              "focus-visible:ring-ring/50 rounded-sm text-left text-sm leading-snug break-words whitespace-pre-wrap outline-none focus-visible:ring-3",
              item.done && "text-muted-foreground line-through",
              !selected && "line-clamp-6"
            )}
            onClick={props.onSelect}
            onContextMenu={contextMenuAt(props.onContextMenu)}
            onDoubleClick={props.onEdit}
            type="button"
          >
            {item.text}
          </button>
        ) : null}
        {item.kind === "image" ? (
          <ImageBody
            editing={editing}
            item={item}
            onContextMenu={props.onContextMenu}
            onDragImage={props.onDragImage}
            onEditNote={props.onEditNote}
            onSelect={props.onSelect}
            onStopEditing={props.onStopEditing}
            selected={selected}
          />
        ) : null}
        {item.kind === "file" ? (
          <FileBody
            item={item}
            onContextMenu={props.onContextMenu}
            onDragImage={props.onDragImage}
            onSelect={props.onSelect}
          />
        ) : null}
        {item.context === null ? null : (
          <SourceLine context={item.context} onOpenLink={props.onOpenLink} />
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

                props.onContextMenu({ x: box.left, y: box.bottom + 2 });
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

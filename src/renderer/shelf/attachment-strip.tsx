import {
  Attachment01Icon,
  Cancel01Icon,
  ClipboardIcon,
  File01Icon,
  ImageNotFound01Icon,
  PaintBrush01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { insetUrl } from "@shared/inset-url";
import { ATTACHMENTS_MAX, attachmentName } from "@shared/shelf";
import type { AttachedImage, Attachment } from "@shared/shelf";
import { useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { tooltipText, Truncated } from "@/shared/clamp";

import type { RowList } from "./row-parts";

// Attachments on an item: the tiles a row shows, and everything details show of them.

/** What a tile does besides being looked at; one object, so a row and details pass one prop. */
export interface AttachmentHandlers {
  /** Opens an attached picture in the drawing window; `pins` with the Pin tool. */
  readonly open: (attachment: AttachedImage, pins?: boolean) => void;
  /** A system drag of the one file: a picture with its pins drawn in, a file as itself. */
  readonly dragOut: (attachment: Attachment) => void;
}

/** Details' three ways to add one: from a file dialog, from the clipboard, as a new drawing. */
export interface AttachmentAdders {
  readonly attachFiles: () => void;
  readonly pasteImage: () => void;
  readonly newDrawing: () => void;
}

const FILE_SIZE = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
  notation: "compact",
  style: "unit",
  unit: "byte",
  unitDisplay: "narrow",
});

const pinCount = (count: number): string =>
  count === 1 ? "1 pin" : `${count} pins`;

/** The whole name, then what it is: for the tooltip and for assistive technology. */
export const attachmentLabel = (attachment: Attachment): string => {
  const name = attachmentName(attachment);

  if (attachment.kind === "file") {
    return `${name} · ${FILE_SIZE.format(attachment.file.bytes)}`;
  }

  const what = attachment.scene?.base === null ? "Drawing" : "Picture";

  return attachment.pins.length === 0
    ? `${name} · ${what}`
    : `${name} · ${what}, ${pinCount(attachment.pins.length)}`;
};

/** A file's extension, shown in capitals, or "file" when it has none. */
const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf(".");

  return dot <= 0 || dot === name.length - 1 ? "file" : name.slice(dot + 1);
};

const TILE =
  "bg-muted after:ring-foreground/10 relative flex shrink-0 flex-col items-center justify-center overflow-hidden rounded-md after:pointer-events-none after:absolute after:inset-0 after:rounded-md after:ring-1 after:ring-inset";

/** A file tile's words: its name on two lines in details, its extension in a row; "Missing" for a picture that is gone, where there is room. */
const TileWords = ({
  large,
  missing,
  name,
}: {
  readonly name: string;
  readonly large: boolean;
  readonly missing: boolean;
}) => {
  if (missing) {
    return large ? (
      <span className="text-xs leading-tight">Missing</span>
    ) : null;
  }

  return large ? (
    <Truncated
      className="w-full text-center text-xs leading-tight wrap-anywhere"
      lines={2}
      text={name}
    />
  ) : (
    <Truncated
      className="w-full text-center text-xs leading-tight font-medium uppercase"
      text={extensionOf(name)}
      tooltip={name}
    />
  );
};

/**
 * What a tile shows: an attached picture, cut to the square, or a file's
 * icon with its extension (in a row) or its name on two lines (in
 * details). A picture whose file is gone shows that it is missing.
 */
const TileFace = ({
  attachment,
  large,
}: {
  readonly attachment: Attachment;
  readonly large: boolean;
}) => {
  const [missing, setMissing] = useState(false);

  if (attachment.kind === "image" && !missing) {
    return (
      <img
        alt=""
        className="size-full object-cover"
        draggable={false}
        onError={() => {
          setMissing(true);
        }}
        src={insetUrl.attachment(attachment.image.file)}
      />
    );
  }

  const name = attachmentName(attachment);

  return (
    <span
      className="text-muted-foreground flex w-full min-w-0 flex-col items-center gap-0.5 px-1"
      data-missing={missing ? "" : undefined}
    >
      <HugeiconsIcon
        className="shrink-0"
        icon={missing ? ImageNotFound01Icon : File01Icon}
        size={large ? 18 : 14}
      />
      <TileWords large={large} missing={missing} name={name} />
    </span>
  );
};

/** A tile as a square of the given size, for a row (40 px) or details (64 px). */
export const AttachmentTile = ({
  attachment,
  className,
  large = false,
}: {
  readonly attachment: Attachment;
  readonly large?: boolean;
  readonly className?: string;
}) => (
  <span className={cn(TILE, large ? "size-16" : "size-10", className)}>
    <TileFace attachment={attachment} large={large} />
  </span>
);

/** Starts the system drag of one attachment, not the card's move within the shelf. */
const dragOutOf =
  (attachment: Attachment, handlers: AttachmentHandlers) =>
  (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    handlers.dragOut(attachment);
  };

/**
 * A row's first attachments as small tiles, and "+N" for the rest, which
 * opens details. A tile selects the row on a click, opens a picture on a
 * double-click and drags out as a file; it answers the row's keys and is
 * no stop of its own for Tab, as the row's picture. A right-click opens
 * the item's menu, as anywhere on the card.
 */
export const AttachmentStrip = ({
  attachments,
  handlers,
  onMore,
  onSelect,
  strip,
}: {
  readonly attachments: readonly Attachment[];
  /** Null for an item without attachments: the row shows nothing for them. */
  readonly strip: RowList | null;
  readonly handlers: AttachmentHandlers;
  readonly onSelect: () => void;
  readonly onMore: () => void;
}) =>
  strip === null ? null : (
    <ul
      aria-label="Attachments"
      className="flex min-w-0 items-center gap-1.5"
      data-attachment-strip
    >
      {attachments.slice(0, strip.shown).map((attachment) => (
        <li className="shrink-0" key={attachment.id}>
          <button
            aria-label={attachmentLabel(attachment)}
            className="focus-visible:ring-ring/50 block cursor-grab rounded-md outline-none focus-visible:ring-3 active:cursor-grabbing"
            data-row-keys
            draggable
            onClick={onSelect}
            onDoubleClick={() => {
              if (attachment.kind === "image") {
                handlers.open(attachment);
              }
            }}
            onDragStart={dragOutOf(attachment, handlers)}
            tabIndex={-1}
            title={tooltipText(attachmentLabel(attachment))}
            type="button"
          >
            <AttachmentTile attachment={attachment} />
          </button>
        </li>
      ))}
      {strip.more === 0 ? null : (
        <li className="shrink-0">
          <Button
            aria-label={`${strip.more} more ${strip.more === 1 ? "attachment" : "attachments"} in details`}
            data-row-keys
            onClick={onMore}
            size="icon-sm"
            tabIndex={-1}
            variant="quiet"
          >
            +{strip.more}
          </Button>
        </li>
      )}
    </ul>
  );

/** After ⌫ the keyboard goes to the next tile, or the one before when the last went. */
const focusAfterRemoval = (tile: HTMLElement): void => {
  const entry = tile.closest("li");
  const next = entry?.nextElementSibling ?? entry?.previousElementSibling;

  next?.querySelector<HTMLElement>("[data-tile]")?.focus();
};

/**
 * Every attachment of an item, as larger tiles that wrap. A picture opens
 * in the drawing window on a click; a file only drags out. ⌫ or the ×,
 * which shows on hover or once the keyboard is on the tile, removes one.
 */
export const AttachmentGrid = ({
  attachments,
  handlers,
}: {
  readonly attachments: readonly Attachment[];
  readonly handlers: AttachmentHandlers & {
    readonly remove: (attachment: Attachment) => void;
  };
}) => (
  <ul className="flex flex-wrap gap-1.5" data-attachment-grid>
    {attachments.map((attachment) => {
      const label = attachmentLabel(attachment);

      const remove = (event: KeyboardEvent | MouseEvent): void => {
        event.preventDefault();
        event.stopPropagation();
        handlers.remove(attachment);
      };

      return (
        <li className="group/tile relative shrink-0" key={attachment.id}>
          <button
            aria-label={label}
            className={cn(
              "focus-visible:ring-ring/50 block rounded-md outline-none focus-visible:ring-3",
              attachment.kind === "image"
                ? "cursor-pointer hover:opacity-85"
                : "cursor-grab active:cursor-grabbing"
            )}
            data-tile
            draggable
            onClick={() => {
              if (attachment.kind === "image") {
                handlers.open(attachment);
              }
            }}
            onDragStart={dragOutOf(attachment, handlers)}
            onKeyDown={(event) => {
              if (event.key === "Backspace" || event.key === "Delete") {
                focusAfterRemoval(event.currentTarget);
                remove(event);
              }
            }}
            title={tooltipText(
              attachment.kind === "image" ? `${label}\nClick to open` : label
            )}
            type="button"
          >
            <AttachmentTile attachment={attachment} large />
          </button>
          <span className="absolute top-1 right-1 opacity-0 group-focus-within/tile:opacity-100 group-hover/tile:opacity-100">
            <Button
              aria-label={`Remove ${tooltipText(attachmentName(attachment))}`}
              onClick={remove}
              size="icon-xs"
              variant="overlay"
            >
              <HugeiconsIcon icon={Cancel01Icon} />
            </Button>
          </span>
        </li>
      );
    })}
  </ul>
);

/** How many an item holds of the most it can: "3/12". */
export const AttachmentCount = ({ count }: { readonly count: number }) => (
  <span className="text-muted-foreground text-xs tabular-nums">
    {count}/{ATTACHMENTS_MAX}
  </span>
);

/** The Add menu's entries for attachments; at the cap they are off, under a line that says why. */
export const AttachMenuItems = ({
  adders,
  count,
}: {
  readonly adders: AttachmentAdders;
  readonly count: number;
}) => {
  const full = count >= ATTACHMENTS_MAX;

  return (
    <>
      <DropdownMenuSeparator />
      {full ? (
        <DropdownMenuLabel>
          {ATTACHMENTS_MAX} attachments, the most an item holds
        </DropdownMenuLabel>
      ) : null}
      <DropdownMenuItem
        disabled={full}
        onSelect={() => {
          adders.attachFiles();
        }}
      >
        <HugeiconsIcon icon={Attachment01Icon} />
        Attach Files…
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={full}
        onSelect={() => {
          adders.pasteImage();
        }}
        shortcut="CommandOrControl+V"
      >
        <HugeiconsIcon icon={ClipboardIcon} />
        Paste Image
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={full}
        onSelect={() => {
          adders.newDrawing();
        }}
      >
        <HugeiconsIcon icon={PaintBrush01Icon} />
        New Drawing…
      </DropdownMenuItem>
    </>
  );
};

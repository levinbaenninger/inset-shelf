import { cn } from "@inset/ui/lib/utils";
import type { FileItem, ImageItem } from "@shared/shelf";
import { TEXT_MAX } from "@shared/shelf";
import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";

import { Textarea } from "@/components/ui/textarea";
import { Clamp } from "@/shared/clamp";

import { useCaretStart } from "./edit-start";
import type { RowHandlers } from "./item-row";
import {
  contextMenuAt,
  DONE,
  EDITING,
  focusRowOrSearchLater,
} from "./row-look";
import { ROW_CAPS } from "./row-parts";

/** The note's type, read or typed in: the same either way, so starting an edit moves nothing. */
const noteLook = (item: ImageItem | FileItem): string =>
  cn(
    "text-sm leading-snug break-words whitespace-pre-wrap",
    // Under a title the caption is the second line, quiet as it is in details.
    item.title !== null && "text-muted-foreground",
    item.done && DONE
  );

/** Where in the note's words a click landed, as an index into the note, or null off its words. */
const noteOffsetAt = (event: MouseEvent<HTMLElement>): number | null => {
  const at = document.caretPositionFromPoint(event.clientX, event.clientY);

  return at !== null && event.currentTarget.contains(at.offsetNode)
    ? at.offset
    : null;
};

/**
 * The note under an image or a file, typed in where it is read: no box, the
 * same type and lines. It saves as you type; the main process waits for a
 * pause before writing.
 */
const NoteField = ({
  caret,
  item,
  onChange,
  onDone,
  onHide,
}: {
  readonly item: ImageItem | FileItem;
  /** Where the caret starts, as an index into the note; the end without one. */
  readonly caret: number | null;
  readonly onChange: (note: string) => void;
  readonly onDone: () => void;
  readonly onHide: () => void;
}) => {
  const [note, setNote] = useState(item.note);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const field = ref.current;
    const at = caret ?? field?.value.length ?? 0;

    field?.focus();
    field?.setSelectionRange(at, at);
  }, [caret]);

  return (
    // The field takes its type from the note's own (a field's font is inherited), so nothing moves.
    <div className={cn(noteLook(item), EDITING)}>
      <Textarea
        aria-label={
          item.kind === "image" ? "Note for this image" : "Note for this file"
        }
        variant="inline"
        maxLength={TEXT_MAX}
        onBlur={onDone}
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

            const row = event.currentTarget.closest("[data-item-id]");

            // Leaving the field ends the edit (onBlur); Return hands the keyboard back to the row, or to the search when the edit took the row out of its results.
            event.currentTarget.blur();

            if (escape) {
              onHide();
            } else {
              focusRowOrSearchLater(row);
            }
          }
        }}
        placeholder="What matters here?"
        ref={ref}
        rows={1}
        value={note}
      />
    </div>
  );
};

/**
 * The note under an image or file as text: two lines until the item is
 * selected. On the open item a click edits it there; Return, a double-click
 * or Edit Caption edits it too.
 */
const NoteText = ({
  item,
  onContextMenu,
  onEdit,
  onEditAt,
  onSelect,
  selected,
}: {
  readonly item: ImageItem | FileItem;
  readonly selected: boolean;
  readonly onEditAt: (offset: number | null) => void;
} & Pick<RowHandlers, "onContextMenu" | "onEdit" | "onSelect">) => {
  if (item.note === "") {
    return null;
  }

  const note = (
    <button
      className={cn(
        "focus-visible:ring-ring/50 w-full rounded-sm text-left outline-none focus-visible:ring-3",
        selected && "cursor-text",
        noteLook(item)
      )}
      data-row-keys
      onClick={(event) => {
        if (!selected) {
          onSelect();
        } else if (window.getSelection()?.isCollapsed !== false) {
          onEditAt(noteOffsetAt(event));
        }
      }}
      onContextMenu={contextMenuAt(onContextMenu)}
      onDoubleClick={onEdit}
      type="button"
    >
      {/* A clamp has no effect on a button itself, only on a box inside it. */}
      <span className={cn("block", !selected && "line-clamp-2")}>
        {item.note}
      </span>
    </button>
  );

  return selected ? (
    <Clamp className={noteLook(item)} lines={ROW_CAPS.words} what="the note">
      {note}
    </Clamp>
  ) : (
    note
  );
};

/** The note, read or typed in, in one place: a click on the open note edits it at that word. */
export const Note = ({
  editing,
  item,
  onContextMenu,
  onEdit,
  onEditNote,
  onHide,
  onSelect,
  onStopEditing,
  selected,
}: {
  readonly item: ImageItem | FileItem;
  readonly selected: boolean;
  readonly editing: boolean;
} & Pick<
  RowHandlers,
  | "onContextMenu"
  | "onEdit"
  | "onEditNote"
  | "onHide"
  | "onSelect"
  | "onStopEditing"
>) => {
  const [caret, setCaret] = useCaretStart<number>(editing);

  // An open picture or file without a note offers one, a click away.
  if (!editing && selected && item.note === "") {
    return (
      <button
        className="text-muted-foreground/70 hover:text-muted-foreground focus-visible:ring-ring/50 cursor-text self-start rounded-sm text-left text-sm leading-snug outline-none focus-visible:ring-3"
        onClick={() => {
          setCaret(null);
          onEdit();
        }}
        type="button"
      >
        Add a note…
      </button>
    );
  }

  return editing ? (
    <NoteField
      caret={caret}
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
      onEditAt={(offset) => {
        setCaret(offset);
        onEdit();
      }}
      onSelect={onSelect}
      selected={selected}
    />
  );
};

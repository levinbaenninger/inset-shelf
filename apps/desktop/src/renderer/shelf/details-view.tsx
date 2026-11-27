import {
  AppWindowIcon,
  ArrowLeft01Icon,
  Attachment01Icon,
  ArrowUpRight01Icon,
  Calendar03Icon,
  Cancel01Icon,
  CheckListIcon,
  File01Icon,
  Location01Icon,
  MoreHorizontalIcon,
  PaintBrush01Icon,
  PlusSignIcon,
  StickyNote01Icon,
  TextAlignLeftIcon,
  TextIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, buttonVariants } from "@inset/ui/components/button";
import { cn } from "@inset/ui/lib/utils";
import type { DetailField, ShelfView } from "@shared/contracts";
import { dateText, dueChipText } from "@shared/due";
import { insetUrl } from "@shared/inset-url";
import {
  attachmentName,
  DESCRIPTION_MAX,
  PIN_LABEL_MAX,
  STEP_TEXT_MAX,
  TEXT_MAX,
  TITLE_MAX,
  withPinLabel,
} from "@shared/shelf";
import type {
  AttachedImage,
  AttachmentId,
  FileItem,
  ImageItem,
  Pin,
  ShelfItem,
  ShelfOp,
  Step,
  TextItem,
  WindowRef,
} from "@shared/shelf";
import { keyText } from "@shared/shortcut";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode, RefObject } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IN_PLACE, Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Truncated } from "@/shared/clamp";
import { PinGlyph, PinMarker } from "@/shared/pin-marker";
import { isMac } from "@/shared/platform";
import { coach } from "@/tutorial/anchors";

import {
  AttachmentCount,
  AttachmentGrid,
  AttachMenuItems,
} from "./attachment-strip";
import type { AttachmentAdders, AttachmentHandlers } from "./attachment-strip";
import { editPoint, useCaretStart, wordsClick } from "./edit-start";
import {
  dueLabel,
  DueMenu,
  dueTone,
  reopenLabel,
  windowName,
  WindowThumb,
} from "./item-meta";
import { LinkList, SourceLine, TextEditor } from "./item-row";
import { Markdown } from "./markdown";
import type { ScreenPoint } from "./markdown-field";
import type { MenuAnchor } from "./menus";

/** What ⌘Z in details can bring back. */
export type DetailsUndo =
  | { readonly kind: "step"; readonly step: Step; readonly index: number }
  | { readonly kind: "window"; readonly windowId: WindowRef["id"] }
  | {
      readonly kind: "pinLabel";
      /** The attached picture whose pin it is; null for the item's own. */
      readonly attachmentId: AttachmentId | null;
      readonly index: number;
      readonly label: string;
    }
  | {
      readonly kind: "attachment";
      readonly attachmentId: AttachmentId;
      readonly name: string;
    };

/** A field to open, from the Add menu or a field shortcut; seq makes each request new. */
export interface FieldRequest {
  readonly field: DetailField;
  readonly seq: number;
}

/** Steps put back by ⌘Z; seq makes each new. */
export interface StepsReset {
  readonly steps: readonly Step[];
  readonly seq: number;
}

export interface DetailsProps {
  readonly item: ShelfItem;
  readonly now: Date;
  readonly request: FieldRequest | null;
  readonly stepsReset: StepsReset | null;
  /** The main text (or the note) is being edited: Return. */
  readonly editing: boolean;
  readonly onBack: () => void;
  readonly onApply: (op: ShelfOp) => void;
  readonly onUndoable: (undo: DetailsUndo) => void;
  /** ⌘Z: puts back the last removed step or window, or a pin's label; false when there is none. */
  readonly onUndo: () => boolean;
  readonly onEdit: () => void;
  readonly onStopEditing: () => void;
  readonly onOpenLink: (url?: string) => void;
  /** All the item's windows when none is given. */
  readonly onReopenWindow: (window?: WindowRef) => void;
  readonly onLinkWindow: () => void;
  readonly onOpenImage: () => void;
  /** The image in the drawing window with the Pin tool picked. */
  readonly onOpenPins: () => void;
  readonly onMenu: (anchor: MenuAnchor) => void;
  readonly onHide: () => void;
  /** A failed save's banner, under the header. */
  readonly banner: ReactNode;
  /** The last Discard changes: when it is this item's, every field shows what is saved again. */
  readonly discarded: ShelfView["discarded"];
  readonly attachments: AttachmentHandlers & AttachmentAdders;
}

const TIME = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

const k = (accelerator: string): string => keyText(accelerator, isMac);

/** ⌘Z on a Mac, Ctrl+Z elsewhere, without Shift or Alt. */
const isUndoKey = (event: KeyboardEvent): boolean =>
  (isMac ? event.metaKey : event.ctrlKey) &&
  !event.shiftKey &&
  !event.altKey &&
  event.key.toLowerCase() === "z";

/** The card surface the list's items sit on, so details read as the same material. */
const SURFACE = "border-foreground/10 bg-background/60 rounded-lg border";

/** The ring of a part of details that has the keyboard without typing in it. */
const RING =
  "focus-visible:ring-ring/50 rounded-lg outline-none focus-visible:ring-3";

/**
 * A field's place, its card or its row: where the keyboard waits once Return
 * or Esc leaves the field's text, on the place's stop. Return there types in
 * the field again, and a second Esc goes back to the list.
 */
const place = {
  className:
    "has-[[data-place-stop]:focus-visible]:ring-ring/50 rounded-lg has-[[data-place-stop]:focus-visible]:ring-3",
  "data-field-place": "",
  onKeyDown: (event: KeyboardEvent<HTMLElement>): void => {
    if (
      event.key === "Enter" &&
      event.target instanceof Element &&
      event.target.matches("[data-place-stop]")
    ) {
      event.preventDefault();
      event.currentTarget.querySelector("textarea")?.focus();
    }
  },
} as const;

/** The place's last stop, after its field and buttons, so Tab goes on past them; the place draws its ring. */
const PlaceStop = () => (
  <span className="sr-only" data-place-stop tabIndex={-1} />
);

const leaveField = (field: HTMLElement): void => {
  field
    .closest("[data-field-place]")
    ?.querySelector<HTMLElement>("[data-place-stop]")
    // The field was just on screen; its stop at the place's end mustn't scroll a long one away.
    ?.focus({ preventScroll: true });
};

/** One typed-in field on its card, its words in line with the item's own at the top of details. */
const FieldBox = ({ children }: { readonly children: ReactNode }) => (
  <div {...place} className={cn(SURFACE, place.className, "p-1.5")}>
    {children}
    <PlaceStop />
  </div>
);

/** A labelled part of details; the label is small and quiet, like a section name in the list. */
const Field = ({
  action,
  children,
  icon,
  label,
}: {
  readonly label: string;
  readonly icon: typeof File01Icon;
  readonly children: ReactNode;
  readonly action?: ReactNode;
}) => (
  <section aria-label={label} className="flex flex-col gap-1.5">
    <div className="flex h-6 items-center gap-1.5">
      <HugeiconsIcon
        className="text-muted-foreground shrink-0"
        icon={icon}
        size={13}
      />
      <h3 className="text-muted-foreground min-w-0 flex-1 text-xs font-medium">
        <Truncated className="block" text={label} />
      </h3>
      {action}
    </div>
    {children}
  </section>
);

const percent = (value: number, total: number): string =>
  `${(value / total) * 100}%`;

/** The image, large, with its numbered pins; a double-click opens it to annotate. */
const ImagePreview = ({
  item,
  onOpenImage,
}: {
  readonly item: ImageItem;
  readonly onOpenImage: () => void;
}) => (
  <button
    aria-label="Annotate this image"
    className="bg-muted after:ring-foreground/10 focus-visible:ring-ring/50 relative block w-full overflow-hidden rounded-lg outline-none after:pointer-events-none after:absolute after:inset-0 after:rounded-lg after:ring-1 after:ring-inset focus-visible:ring-3"
    onClick={onOpenImage}
    title="Annotate and place pins"
    type="button"
  >
    <img
      alt={item.title ?? item.note}
      className="block h-auto w-full"
      draggable={false}
      height={item.image.heightPx}
      src={insetUrl.attachment(item.image.file)}
      width={item.image.widthPx}
    />
    {item.pins.map((pin, index) => (
      <PinMarker
        height={20}
        // oxlint-disable-next-line react/no-array-index-key -- a pin's place is its number.
        key={index}
        left={percent(pin.x, item.image.widthPx)}
        number={index + 1}
        top={percent(pin.y, item.image.heightPx)}
      />
    ))}
  </button>
);

/**
 * A text that saves as it is typed; main waits for a pause before writing.
 * While it has focus it keeps what is typed; otherwise it shows the saved
 * value, so an undo made elsewhere shows up here.
 */
const AutoText = ({
  autoFocus = false,
  label,
  max,
  multiline,
  onEdited,
  onSave,
  placeholder,
  value,
}: {
  readonly value: string;
  readonly label: string;
  readonly placeholder: string;
  readonly max: number;
  readonly multiline: boolean;
  readonly onSave: (value: string) => void;
  /** Focus left after the text changed: what it held when focus came in. */
  readonly onEdited?: (before: string) => void;
  readonly autoFocus?: boolean;
}) => {
  const [text, setText] = useState(value);
  const [saved, setSaved] = useState(value);
  const [focused, setFocused] = useState(false);
  const before = useRef(value);
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);

  if (value !== saved) {
    setSaved(value);

    if (!focused) {
      setText(value);
    }
  }

  useEffect(() => {
    if (autoFocus) {
      ref.current?.focus();
    }
  }, [autoFocus]);

  // Return ends a one-line field; Escape leaves any field for its place, so the next Escape goes back.
  const onKeyDown = (
    event: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>
  ): void => {
    if (
      event.key === "Escape" ||
      (!multiline && event.key === "Enter" && !event.nativeEvent.isComposing)
    ) {
      event.preventDefault();
      event.stopPropagation();
      leaveField(event.currentTarget);
    }
  };

  const props = {
    "aria-label": label,
    maxLength: max,
    onBlur: () => {
      setFocused(false);

      if (text !== before.current) {
        onEdited?.(before.current);
      }
    },
    onChange: (event: { readonly target: { readonly value: string } }) => {
      // A one-line text stays one line, even when a pasted text has breaks.
      const typed = multiline
        ? event.target.value
        : event.target.value.replaceAll(/\s*\n\s*/gu, " ");

      setText(typed);
      onSave(typed);
    },
    onFocus: () => {
      before.current = text;
      setFocused(true);
    },
    onKeyDown,
    placeholder,
    ref,
    value: text,
  };

  // Read as text until typed in. A one-line text wraps as it grows, so a long title shows whole.
  return <Textarea {...props} variant="inPlace" />;
};

/**
 * Next steps as a checklist to edit: Return adds a step below, Backspace in
 * an empty step removes it, ⌘Z right after brings it back, each can be
 * ticked.
 */
const StepsEditor = ({
  focusSeq,
  goesWhenLeft,
  newStep,
  onChange,
  onRemoved,
  onUndo,
  steps,
}: {
  readonly steps: readonly Step[];
  /** Changes when the last step should take focus. */
  readonly focusSeq: number;
  /** The step goes once focus leaves its row for good: not to its own checkbox or ×, nor only out of the window. */
  readonly goesWhenLeft: (step: Step) => boolean;
  readonly newStep: () => Step;
  readonly onChange: (steps: readonly Step[]) => void;
  readonly onRemoved: (step: Step, index: number) => void;
  readonly onUndo: () => boolean;
}) => {
  const refs = useRef(new Map<string, HTMLTextAreaElement>());
  // The step to focus once the next render has it on screen.
  const focusTarget = useRef<string | null>(null);
  // data-step-removed marks a removal not yet followed by typing: ⌘Z in a step
  // then brings it back instead of undoing text. The shelf's own Undo command
  // reads the same mark, whichever of the page and the menu sees ⌘Z first.
  const listRef = useRef<HTMLUListElement>(null);

  const markRemoved = (removed: boolean): void => {
    if (listRef.current !== null) {
      if (removed) {
        listRef.current.dataset.stepRemoved = "";
      } else {
        delete listRef.current.dataset.stepRemoved;
      }
    }
  };

  const focusStep = (id: string): void => {
    const field = refs.current.get(id);

    field?.focus();
    field?.setSelectionRange(field.value.length, field.value.length);
  };

  useEffect(() => {
    if (focusTarget.current !== null) {
      focusStep(focusTarget.current);
      focusTarget.current = null;
    }
  });

  const focusLast = useEffectEvent(() => {
    const last = steps.at(-1);

    if (last !== undefined) {
      focusStep(last.id);
    }
  });

  useEffect(() => {
    if (focusSeq > 0) {
      focusLast();
    }
  }, [focusSeq]);

  const remove = (index: number): void => {
    const step = steps[index];

    if (step === undefined) {
      return;
    }

    onRemoved(step, index);
    onChange(steps.filter((other) => other.id !== step.id));
    markRemoved(true);

    const before = steps[index - 1] ?? steps[index + 1];

    focusTarget.current = before?.id ?? null;
  };

  const onKeyDown = (
    event: KeyboardEvent<HTMLTextAreaElement>,
    index: number
  ): void => {
    const step = steps[index];

    if (step === undefined || event.nativeEvent.isComposing) {
      return;
    }

    if (
      isUndoKey(event) &&
      listRef.current?.dataset.stepRemoved !== undefined
    ) {
      event.preventDefault();
      markRemoved(false);
      onUndo();
    } else if (event.key === "Enter") {
      event.preventDefault();

      const added = newStep();

      focusTarget.current = added.id;
      onChange(steps.toSpliced(index + 1, 0, added));
    } else if (event.key === "Backspace" && step.text === "") {
      event.preventDefault();
      remove(index);
    } else if (
      (event.key === "ArrowUp" && event.currentTarget.selectionStart === 0) ||
      (event.key === "ArrowDown" &&
        event.currentTarget.selectionEnd === step.text.length)
    ) {
      // From the first or last line of a step, the arrows go on to the next step.
      const next = steps[index + (event.key === "ArrowDown" ? 1 : -1)];

      if (next !== undefined) {
        event.preventDefault();
        focusStep(next.id);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();

      // A step that goes as it is left hands the keyboard to Add step, which made it; any other waits on its row.
      if (goesWhenLeft(step)) {
        event.currentTarget
          .closest("section")
          ?.querySelector<HTMLElement>("[data-add-step]")
          ?.focus();
      } else {
        leaveField(event.currentTarget);
      }
    }
  };

  // The circle, the words and the × each sit in a box one line tall (h-7), so they share a centre line, typed in or not.
  return (
    <ul
      className={cn(SURFACE, "flex flex-col px-2 py-1.5 empty:hidden")}
      ref={listRef}
    >
      {steps.map((step, index) => (
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the row only hears focus leave it, and Return on it types in its step again; its checkbox, words and × take the other keys.
        <li
          {...place}
          className={cn(place.className, "group/step flex items-start gap-2")}
          key={step.id}
          onBlur={(event) => {
            if (
              goesWhenLeft(step) &&
              document.hasFocus() &&
              !(
                event.relatedTarget instanceof Node &&
                event.currentTarget.contains(event.relatedTarget)
              )
            ) {
              onChange(steps.filter((other) => other.id !== step.id));
            }
          }}
        >
          <span className="flex h-7 shrink-0 items-center">
            {/* Named by its words, as in the open row, and checked or not says the rest; a step not typed yet goes by its number. */}
            <Checkbox
              aria-label={
                step.text.trim() === "" ? `Step ${index + 1}` : step.text
              }
              checked={step.done}
              onCheckedChange={() => {
                onChange(
                  steps.map((other) =>
                    other.id === step.id
                      ? { ...other, done: !other.done }
                      : other
                  )
                );
              }}
            />
          </span>
          <Textarea
            aria-label={`Step ${index + 1}`}
            className={cn(
              "min-w-0 flex-1",
              step.done && "text-muted-foreground line-through"
            )}
            maxLength={STEP_TEXT_MAX}
            onChange={(event) => {
              markRemoved(false);
              onChange(
                steps.map((other) =>
                  other.id === step.id
                    ? { ...other, text: event.target.value }
                    : other
                )
              );
            }}
            onKeyDown={(event) => {
              onKeyDown(event, index);
            }}
            placeholder="Next step"
            ref={(node) => {
              if (node === null) {
                refs.current.delete(step.id);
              } else {
                refs.current.set(step.id, node);
              }
            }}
            value={step.text}
            variant="inPlace"
          />
          <span className="flex h-7 shrink-0 items-center opacity-0 transition-opacity group-focus-within/step:opacity-100 group-hover/step:opacity-100">
            <Button
              aria-label={`Remove step ${index + 1}`}
              onClick={() => {
                remove(index);
              }}
              size="icon-xs"
              variant="quiet"
            >
              <HugeiconsIcon icon={Cancel01Icon} />
            </Button>
          </span>
          <PlaceStop />
        </li>
      ))}
    </ul>
  );
};

/** Where a linked window reopens, in one quiet line: the site, the file's name, or the app. */
const windowWhere = (window: WindowRef): string => {
  if (window.url !== null) {
    try {
      const url = new URL(window.url);

      return `${url.hostname.replace(/^www\./u, "")}${url.pathname === "/" ? "" : url.pathname}`;
    } catch {
      return window.url;
    }
  }

  if (window.document !== null) {
    return window.document.split(/[/\\]/u).at(-1) ?? window.document;
  }

  return window.app ?? "";
};

const windowPlace = (window: WindowRef): string =>
  [window.app ?? "", windowWhere(window)]
    .filter((part, at, all) => part !== "" && all.indexOf(part) === at)
    .join(" · ");

/**
 * A window's description as words, or a quiet + Description when it has
 * none; a click edits it in a field of the same height. Return or leaving
 * the field keeps what was typed (it saves as it is typed), Esc puts back
 * what it held before.
 */
const WindowDescription = ({
  name,
  onSave,
  value,
}: {
  readonly name: string;
  readonly value: string;
  readonly onSave: (description: string) => void;
}) => {
  const [editing, setEditing] = useState(false);
  const before = useRef(value);
  // Return and Esc hand focus back to the words; a click elsewhere keeps it where it went.
  const refocus = useRef(false);
  const shown = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) {
      field.current?.focus();
    } else if (refocus.current) {
      refocus.current = false;
      shown.current?.focus();
    }
  }, [editing]);

  if (editing) {
    return (
      <Textarea
        aria-label={`Description of ${name}`}
        defaultValue={value}
        maxLength={DESCRIPTION_MAX}
        onBlur={() => {
          setEditing(false);
        }}
        onChange={(event) => {
          // One line, as it reads: a pasted text's breaks become spaces.
          const typed = event.target.value.replaceAll(/\s*\n\s*/gu, " ");

          if (typed !== event.target.value) {
            event.target.value = typed;
          }

          onSave(typed);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) {
            return;
          }

          if (event.key === "Escape" || event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            refocus.current = true;

            if (
              event.key === "Escape" &&
              event.currentTarget.value !== before.current
            ) {
              onSave(before.current);
            }

            setEditing(false);
          }
        }}
        placeholder="What this window shows"
        ref={field}
        variant="inPlace"
      />
    );
  }

  const edit = (): void => {
    before.current = value;
    setEditing(true);
  };

  return value === "" ? (
    <Button
      aria-label={`Add a description of ${name}`}
      className="self-start"
      onClick={edit}
      ref={shown}
      size="xs"
      variant="quiet"
    >
      <HugeiconsIcon data-icon="inline-start" icon={PlusSignIcon} />
      Description
    </Button>
  ) : (
    <button
      aria-label={`${value}. Edit the description of ${name}`}
      // The field's own look, so a click turns the words into it without a move.
      className={cn(IN_PLACE, "text-left break-words outline-none")}
      onClick={edit}
      ref={shown}
      type="button"
    >
      {value}
    </button>
  );
};

/** One linked window: its picture, name and place, its description, reopen, and a menu to move or remove it. */
const WindowRow = ({
  index,
  item,
  onApply,
  onReopen,
  onRemoved,
  window,
}: {
  readonly item: ShelfItem;
  readonly window: WindowRef;
  readonly index: number;
  readonly onApply: (op: ShelfOp) => void;
  readonly onReopen: () => void;
  readonly onRemoved: () => void;
}) => {
  const name = windowName(window);
  const reopen = reopenLabel(window);

  const move = (to: number): void => {
    onApply({
      id: item.id,
      index: to,
      type: "moveWindow",
      windowId: window.id,
    });
  };

  return (
    <li className="group/window relative flex flex-col gap-1.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <button
          aria-label={`${reopen}: ${name}`}
          className="focus-visible:ring-ring/50 shrink-0 rounded-md outline-none hover:opacity-85 focus-visible:ring-3"
          onClick={onReopen}
          type="button"
        >
          <WindowThumb className="h-9 w-14" window={window} />
        </button>
        {/* The name ends where the actions begin. */}
        <div className="flex min-w-0 flex-1 flex-col pr-17">
          <Truncated
            className="text-sm leading-tight font-medium"
            text={name}
          />
          <Truncated
            className="text-muted-foreground text-xs"
            text={windowPlace(window)}
          />
        </div>
      </div>
      {/* Quiet at rest, so they are seen without competing with the name; full on hover, or while the keyboard or a menu is on them. */}
      <div className="absolute top-0 right-0 flex h-9 items-center gap-0.5 opacity-40 transition-opacity group-focus-within/window:opacity-100 group-hover/window:opacity-100 has-[[data-state=open]]:opacity-100">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={reopen}
              onClick={onReopen}
              size="icon-sm"
              variant="ghost"
            >
              <HugeiconsIcon icon={ArrowUpRight01Icon} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">{reopen}</TooltipContent>
        </Tooltip>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={`More for ${name}`}
              size="icon-sm"
              variant="ghost"
            >
              <HugeiconsIcon icon={MoreHorizontalIcon} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={index === 0}
              onSelect={() => {
                move(index - 1);
              }}
            >
              Move Up
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={index === item.windows.length - 1}
              onSelect={() => {
                move(index + 1);
              }}
            >
              Move Down
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                onApply({
                  id: item.id,
                  type: "removeWindow",
                  windowId: window.id,
                });
                onRemoved();
              }}
              variant="destructive"
            >
              Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {/* Out past the row's inset by the field's own, so the words line up with the picture. */}
      <div className="-mx-1.5 flex min-w-0 flex-col">
        <WindowDescription
          name={name}
          onSave={(description) => {
            onApply({
              description,
              id: item.id,
              type: "describeWindow",
              windowId: window.id,
            });
          }}
          value={window.description}
        />
      </div>
    </li>
  );
};

/** The pins, right under the image they mark, each with an optional label: "1 · label". */
const PinLabels = ({
  label = "Pins",
  onEdited,
  onOpenPins,
  onSave,
  pins,
}: {
  readonly pins: readonly Pin[];
  /** The field's name: "Pins" for the item's own picture. */
  readonly label?: string;
  readonly onSave: (pins: Pin[]) => void;
  /** A label typed in, with what it said before, for ⌘Z. */
  readonly onEdited: (index: number, label: string) => void;
  readonly onOpenPins: () => void;
}) => (
  <Field
    action={
      <Button onClick={onOpenPins} size="xs" variant="quiet">
        <HugeiconsIcon data-icon="inline-start" icon={PaintBrush01Icon} />
        Move pins
      </Button>
    }
    icon={Location01Icon}
    label={label}
  >
    <ol className={cn(SURFACE, "flex flex-col gap-1 p-1.5")}>
      {pins.map((pin, index) => (
        // A pin has no id: its number and place name it, so a label field never shows another pin's text after a removal.
        // The pin sits beside a label's first line (h-7, a one-line field's height), however many lines it wraps to.
        <li
          {...place}
          className={cn(place.className, "flex items-start gap-2")}
          key={`${index}:${pin.x}:${pin.y}`}
        >
          <span className="flex h-7 shrink-0 items-center">
            <PinGlyph height={18} number={index + 1} />
          </span>
          <AutoText
            label={`Label for pin ${index + 1}`}
            max={PIN_LABEL_MAX}
            multiline={false}
            onEdited={(before) => {
              onEdited(index, before);
            }}
            onSave={(text) => {
              onSave(withPinLabel(pins, index, text));
            }}
            placeholder={`What pin ${index + 1} marks`}
            value={pin.label ?? ""}
          />
          <PlaceStop />
        </li>
      ))}
    </ol>
  </Field>
);

/**
 * The item's attachments, and under them the pin labels of the picture
 * whose tile last had the keyboard or a click.
 */
const AttachmentsField = ({
  attachments: handlers,
  item,
  onApply,
  onUndoable,
}: Pick<DetailsProps, "attachments" | "item" | "onApply" | "onUndoable">) => {
  const [picked, setPicked] = useState<AttachmentId | null>(null);

  const pinned = item.attachments.find(
    (attachment): attachment is AttachedImage =>
      attachment.id === picked &&
      attachment.kind === "image" &&
      attachment.pins.length > 0
  );

  if (item.attachments.length === 0) {
    return null;
  }

  return (
    <>
      <Field
        action={<AttachmentCount count={item.attachments.length} />}
        icon={Attachment01Icon}
        label="Attachments"
      >
        <AttachmentGrid
          active={pinned?.id ?? null}
          attachments={item.attachments}
          handlers={{
            ...handlers,
            remove: (attachment) => {
              onApply({
                attachmentId: attachment.id,
                id: item.id,
                type: "removeAttachment",
              });
              onUndoable({
                attachmentId: attachment.id,
                kind: "attachment",
                name: attachmentName(attachment),
              });
            },
          }}
          onPick={(attachment) => {
            setPicked(attachment.id);
          }}
        />
      </Field>
      {pinned === undefined ? null : (
        <PinLabels
          label={`Pins on ${pinned.name}`}
          onEdited={(index, label) => {
            onUndoable({
              attachmentId: pinned.id,
              index,
              kind: "pinLabel",
              label,
            });
          }}
          onOpenPins={() => {
            handlers.open(pinned, true);
          }}
          onSave={(pins) => {
            onApply({
              attachmentId: pinned.id,
              id: item.id,
              pins,
              type: "setAttachmentPins",
            });
          }}
          pins={pinned.pins}
        />
      )}
    </>
  );
};

const FileLine = ({ item }: { readonly item: FileItem }) => (
  <p
    className={cn(
      SURFACE,
      "flex min-w-0 items-center gap-2 px-3 py-2.5 text-sm"
    )}
  >
    <HugeiconsIcon
      className="text-muted-foreground shrink-0"
      icon={File01Icon}
      size={16}
    />
    <Truncated text={item.file.name} />
  </p>
);

type ContentProps = Pick<
  DetailsProps,
  | "editing"
  | "item"
  | "onApply"
  | "onEdit"
  | "onOpenImage"
  | "onOpenPins"
  | "onOpenLink"
  | "onStopEditing"
  | "onUndoable"
>;

/** A text item is its text: shown as in the list, edited in place with Return. */
const TextContent = ({
  editing,
  item,
  onApply,
  onEdit,
  onOpenLink,
  onStopEditing,
}: Omit<ContentProps, "item" | "onOpenImage" | "onOpenPins" | "onUndoable"> & {
  readonly item: TextItem;
}) => {
  const [caretAt, setCaretAt] = useCaretStart<ScreenPoint>(editing);

  return editing ? (
    // The same card as the words read in, so starting an edit moves nothing.
    <div className={cn(SURFACE, "px-3 py-2.5")}>
      <TextEditor
        caretAt={caretAt}
        item={item}
        onDone={onStopEditing}
        onSave={(text) => {
          onApply({ id: item.id, text, type: "editText" });
        }}
      />
    </div>
  ) : (
    // A click on the words edits them there, as in the open row; a link still opens. Return and Esc in the editor hand the keyboard back here, where Return edits again (use-shelf-keys.ts).
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- Edit in the item menu (Return) edits from the keyboard; the click only says where the caret goes.
    <div
      className={cn(SURFACE, RING, "cursor-text px-3 py-2.5")}
      data-row-keys
      tabIndex={-1}
      onClick={(event) => {
        const point = editPoint(wordsClick(event));

        if (point !== null) {
          setCaretAt(point);
          onEdit();
        }
      }}
    >
      <Markdown
        className="text-sm leading-snug break-words"
        interactive
        onOpenLink={onOpenLink}
        text={item.text}
      />
    </div>
  );
};

/** The item's own content at the top: its words, or its image or file with title, pins and note. */
const Content = (props: ContentProps) => {
  const { editing, item, onApply, onOpenImage } = props;

  if (item.kind === "text") {
    return (
      <TextContent
        editing={editing}
        item={item}
        onApply={onApply}
        onEdit={props.onEdit}
        onOpenLink={props.onOpenLink}
        onStopEditing={props.onStopEditing}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {item.kind === "image" ? (
        <ImagePreview item={item} onOpenImage={onOpenImage} />
      ) : (
        <FileLine item={item} />
      )}
      <Field icon={TextIcon} label="Title">
        <FieldBox>
          <AutoText
            label="Title"
            max={TITLE_MAX}
            multiline={false}
            onSave={(title) => {
              onApply({ id: item.id, title, type: "setTitle" });
            }}
            placeholder="Shown as the main line"
            value={item.title ?? ""}
          />
        </FieldBox>
      </Field>
      <Field
        action={
          <span className="text-muted-foreground/80 text-xs">
            {item.kind === "image"
              ? "Copied with the image"
              : "Copied with the file"}
          </span>
        }
        icon={StickyNote01Icon}
        label="Caption"
      >
        <FieldBox>
          <AutoText
            autoFocus={editing}
            key={editing ? "editing" : "note"}
            label={
              item.kind === "image"
                ? "Caption, copied with the image"
                : "Caption, copied with the file"
            }
            max={TEXT_MAX}
            multiline
            onSave={(note) => {
              onApply({ id: item.id, note, type: "editNote" });
            }}
            placeholder="A line to paste along with it"
            value={item.note}
          />
        </FieldBox>
      </Field>
      {item.kind === "image" && item.pins.length > 0 ? (
        <PinLabels
          onEdited={(index, label) => {
            props.onUndoable({
              attachmentId: null,
              index,
              kind: "pinLabel",
              label,
            });
          }}
          onOpenPins={props.onOpenPins}
          onSave={(pins) => {
            onApply({ id: item.id, pins, type: "setPins" });
          }}
          pins={item.pins}
        />
      ) : null}
    </div>
  );
};

const FIELD_LABEL: Readonly<Record<DetailField, string>> = {
  description: "Description",
  due: "Due",
  steps: "Next steps",
};

const FIELD_KEY: Readonly<Record<DetailField, string>> = {
  description: "CommandOrControl+D",
  due: "Shift+CommandOrControl+D",
  steps: "Shift+CommandOrControl+S",
};

const FIELD_ICON: Readonly<Record<DetailField, typeof File01Icon>> = {
  description: TextAlignLeftIcon,
  due: Calendar03Icon,
  steps: CheckListIcon,
};

const FIELDS: readonly DetailField[] = ["description", "steps", "due"];

/**
 * The one Add menu, under the fields it adds to, so details read top to
 * bottom: the item, its fields, then Add for the next one.
 */
const AddMenu = ({
  addable,
  attachments,
  item,
  onAdd,
  onLinkWindow,
  onOpenPins,
}: Pick<
  DetailsProps,
  "attachments" | "item" | "onLinkWindow" | "onOpenPins"
> & {
  readonly addable: readonly DetailField[];
  readonly onAdd: (field: DetailField) => void;
}) => {
  // The field picked in Add, opened once the menu has closed, so focus goes to it and not back to Add.
  const chosen = useRef<DetailField | null>(null);

  return (
    <div className="-mt-2">
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label="Add a field"
            size="xs"
            variant="quiet"
            {...coach("details-add")}
          >
            <HugeiconsIcon data-icon="inline-start" icon={PlusSignIcon} />
            Add
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="min-w-52"
          onCloseAutoFocus={(event) => {
            const field = chosen.current;

            if (field !== null) {
              event.preventDefault();
              chosen.current = null;
              onAdd(field);
            }
          }}
        >
          {addable.map((field) => (
            <DropdownMenuItem
              key={field}
              onSelect={() => {
                chosen.current = field;
              }}
              shortcut={FIELD_KEY[field]}
            >
              <HugeiconsIcon icon={FIELD_ICON[field]} />
              {FIELD_LABEL[field]}
            </DropdownMenuItem>
          ))}
          {addable.length > 0 ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem onSelect={onLinkWindow}>
            <HugeiconsIcon icon={AppWindowIcon} />
            Link Window…
          </DropdownMenuItem>
          {item.kind === "image" ? (
            <DropdownMenuItem onSelect={onOpenPins}>
              <HugeiconsIcon icon={Location01Icon} />
              Add Pins…
            </DropdownMenuItem>
          ) : null}
          <AttachMenuItems
            adders={attachments}
            count={item.attachments.length}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

/** Back, the title, ⋯ and Hide. */
const DetailsHeader = ({
  onBack,
  onHide,
  onMenu,
  titleRef,
}: Pick<DetailsProps, "onBack" | "onHide" | "onMenu"> & {
  readonly titleRef: RefObject<HTMLHeadingElement | null>;
}) => (
  <header className="drag-region flex h-12 shrink-0 items-center gap-1 px-2">
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label="Back to the list"
          onClick={onBack}
          size="icon"
          variant="ghost"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        Back <span className="opacity-70">{k("Left")} or Esc</span>
      </TooltipContent>
    </Tooltip>
    <h2
      className="min-w-0 flex-1 truncate text-sm font-medium outline-none"
      ref={titleRef}
      tabIndex={-1}
    >
      Details
    </h2>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label="More"
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();

            onMenu({
              align: "end",
              height: box.height,
              width: box.width,
              x: box.left,
              y: box.top,
            });
          }}
          size="icon"
          variant="ghost"
        >
          <HugeiconsIcon icon={MoreHorizontalIcon} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">More</TooltipContent>
    </Tooltip>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label="Hide Shelf"
          onClick={onHide}
          size="icon"
          variant="ghost"
        >
          <HugeiconsIcon icon={Cancel01Icon} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Hide Shelf</TooltipContent>
    </Tooltip>
  </header>
);

/**
 * Due: Set Due, or the chip once there is a day, both opening the Due
 * picker. One button plays both parts, so focus stays on it when a pick
 * turns Set Due into the chip.
 */
const DueField = ({
  item,
  now,
  onApply,
  onOpenChange,
  open,
}: {
  readonly item: ShelfItem;
  readonly now: Date;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onApply: (op: ShelfOp) => void;
}) => (
  <Field icon={Calendar03Icon} label="Due">
    <div className="flex min-h-7 items-center">
      {/* The × sits inside the chip's tint, as in the other Inset apps. */}
      <span
        className={cn(
          "inline-flex h-6 shrink-0 items-center rounded-md text-xs font-medium whitespace-nowrap tabular-nums",
          item.due !== null && dueTone(item.due, now)
        )}
      >
        <DueMenu
          due={item.due}
          now={now}
          onOpenChange={onOpenChange}
          onSet={(due) => {
            onApply({ due, id: item.id, type: "setDue" });
          }}
          open={open}
        >
          {item.due === null ? (
            <button
              className={buttonVariants({ size: "xs", variant: "outline" })}
              type="button"
            >
              <HugeiconsIcon data-icon="inline-start" icon={Calendar03Icon} />
              Set Due
            </button>
          ) : (
            <button
              aria-label={`${dueLabel(item.due, now)}. Change Due`}
              className="focus-visible:ring-ring/50 flex h-full items-center gap-1 rounded-md pr-0.5 pl-1.5 outline-none focus-visible:ring-3"
              title={dueLabel(item.due, now)}
              type="button"
            >
              <HugeiconsIcon
                className="shrink-0"
                icon={Calendar03Icon}
                size={11}
                strokeWidth={2}
              />
              {dueChipText(item.due, now)}
            </button>
          )}
        </DueMenu>
        {item.due === null ? null : (
          <button
            aria-label="Clear Due"
            className="focus-visible:ring-ring/50 grid h-full w-6 place-items-center rounded-md opacity-70 outline-none hover:opacity-100 focus-visible:ring-3"
            onClick={() => {
              onApply({ due: null, id: item.id, type: "setDue" });
            }}
            title="Clear Due"
            type="button"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={2} />
          </button>
        )}
      </span>
    </div>
  </Field>
);

const addedText = (item: ShelfItem): string => {
  const created = new Date(item.createdAt);

  const from =
    item.kind === "text" && item.via === "selection"
      ? " · from a selection"
      : "";

  return `Added ${dateText(created, new Date())}, ${TIME.format(created)}${from}`;
};

/** Where the item came from and the links copied with it; nothing when there are neither. */
const SourceField = ({
  item,
  onOpenLink,
}: {
  readonly item: ShelfItem;
  readonly onOpenLink: (url?: string) => void;
}) =>
  item.context === null &&
  (item.kind !== "text" || item.links.length === 0) ? null : (
    <Field icon={ArrowUpRight01Icon} label="Source">
      <div className="flex flex-col gap-1">
        {item.context === null ? null : (
          <div className="flex min-w-0">
            <SourceLine
              context={item.context}
              onOpenLink={() => {
                onOpenLink();
              }}
            />
          </div>
        )}
        {item.kind === "text" && item.links.length > 0 ? (
          <LinkList
            links={item.links}
            onOpenLink={onOpenLink}
            sourceUrl={item.context?.url ?? null}
          />
        ) : null}
      </div>
    </Field>
  );

/** The item's linked windows, each to reopen, describe, move or remove; Reopen all when there are several. */
const WindowsField = ({
  item,
  onApply,
  onReopenWindow,
  onUndoable,
}: Pick<
  DetailsProps,
  "item" | "onApply" | "onReopenWindow" | "onUndoable"
>) => (
  <Field
    action={
      item.windows.length > 1 ? (
        <Button
          onClick={() => {
            onReopenWindow();
          }}
          size="xs"
          variant="quiet"
        >
          Reopen all
        </Button>
      ) : null
    }
    icon={AppWindowIcon}
    label="Linked windows"
  >
    <ul className={cn(SURFACE, "flex flex-col gap-2.5 p-2")}>
      {item.windows.map((window, index) => (
        <WindowRow
          index={index}
          item={item}
          key={window.id}
          onApply={onApply}
          onRemoved={() => {
            onUndoable({ kind: "window", windowId: window.id });
          }}
          onReopen={() => {
            onReopenWindow(window);
          }}
          window={window}
        />
      ))}
    </ul>
  </Field>
);

/**
 * Level 2: everything about one item, for deliberate editing, as a view
 * pushed over the list. Empty fields take no room; Add, under the fields
 * (or ⌘D, ⇧⌘S, ⇧⌘D), brings them in. Every edit saves as it is made.
 */
export const DetailsView = (props: DetailsProps) => {
  const { item, now, request } = props;
  const [added, setAdded] = useState<ReadonlySet<DetailField>>(new Set());
  const [descriptionFocus, setDescriptionFocus] = useState(0);
  const [stepsFocus, setStepsFocus] = useState(0);
  const [dueOpen, setDueOpen] = useState(false);
  const [steps, setSteps] = useState<readonly Step[]>(item.steps);
  const titleRef = useRef<HTMLHeadingElement>(null);

  // Typed steps live here, so a slow echo from main never moves the caret; ⌘Z puts back its own.
  const [seenReset, setSeenReset] = useState(props.stepsReset?.seq ?? 0);

  if (props.stepsReset !== null && props.stepsReset.seq !== seenReset) {
    setSeenReset(props.stepsReset.seq);
    setSteps(props.stepsReset.steps);
  }

  // The view that brings the discard also brings the saved item, so the fields take its values at once.
  const [seenDiscard, setSeenDiscard] = useState(props.discarded?.seq ?? 0);

  if (
    props.discarded !== null &&
    props.discarded.id === item.id &&
    props.discarded.seq !== seenDiscard
  ) {
    setSeenDiscard(props.discarded.seq);
    setSteps(item.steps);
    setAdded(new Set());
    setDueOpen(false);
  }

  const shown: Readonly<Record<DetailField, boolean>> = {
    description: item.description !== "" || added.has("description"),
    due: item.due !== null || added.has("due"),
    steps: steps.length > 0 || added.has("steps"),
  };

  // Steps added here and never typed in: only these go when left blank, so Add step stays the one way to add one. A step that held words stays once cleared, and ⌘Z in it brings them back.
  const untyped = useRef(new Set<string>());

  const newStep = (): Step => {
    const step = { done: false, id: crypto.randomUUID(), text: "" };

    untyped.current.add(step.id);

    return step;
  };

  const saveSteps = (next: readonly Step[]): void => {
    for (const step of next) {
      if (step.text.trim() !== "") {
        untyped.current.delete(step.id);
      }
    }

    setSteps(next);
    props.onApply({ id: item.id, steps: [...next], type: "setSteps" });
  };

  const open = (field: DetailField): void => {
    setAdded((current) => new Set([...current, field]));

    if (field === "description") {
      setDescriptionFocus((seq) => seq + 1);
    } else if (field === "steps") {
      if (steps.length === 0) {
        saveSteps([newStep()]);
      }

      setStepsFocus((seq) => seq + 1);
    } else {
      setDueOpen(true);
    }
  };

  // Focus moves into details as they open; a field shortcut takes it to its field instead.
  const onOpened = useEffectEvent(() => {
    if (request === null) {
      titleRef.current?.focus();
    }
  });

  useEffect(() => {
    onOpened();
  }, []);

  const onRequest = useEffectEvent(() => {
    if (request !== null) {
      open(request.field);
    }
  });

  const requestSeq = request?.seq ?? null;

  // A frame later, so a menu that asked for it has closed and focus can move.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (requestSeq !== null) {
        onRequest();
      }
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [requestSeq]);

  // Empty steps left behind go when details close.
  const onClosed = useEffectEvent(() => {
    const kept = steps.filter((step) => step.text.trim() !== "");

    if (kept.length !== steps.length) {
      props.onApply({ id: item.id, steps: kept, type: "setSteps" });
    }
  });

  useEffect(
    () => () => {
      onClosed();
    },
    []
  );

  const filled = steps.filter((step) => step.text.trim() !== "");

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-details-view>
      <DetailsHeader
        onBack={props.onBack}
        onHide={props.onHide}
        onMenu={props.onMenu}
        titleRef={titleRef}
      />
      <div className="pb-2 empty:hidden">{props.banner}</div>
      <div
        className="shelf-list flex min-h-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto px-3 pt-1 pb-4"
        data-details
      >
        <Content
          editing={props.editing}
          item={item}
          onApply={props.onApply}
          onEdit={props.onEdit}
          onOpenImage={props.onOpenImage}
          onOpenLink={props.onOpenLink}
          onOpenPins={props.onOpenPins}
          onStopEditing={props.onStopEditing}
          onUndoable={props.onUndoable}
        />
        <AttachmentsField
          attachments={props.attachments}
          item={item}
          onApply={props.onApply}
          onUndoable={props.onUndoable}
        />
        {shown.description ? (
          <Field icon={TextAlignLeftIcon} label="Description">
            <FieldBox>
              <AutoText
                autoFocus={descriptionFocus > 0}
                key={descriptionFocus}
                label="Description"
                max={DESCRIPTION_MAX}
                multiline
                onSave={(description) => {
                  props.onApply({
                    description,
                    id: item.id,
                    type: "setDescription",
                  });
                }}
                placeholder="Add a description"
                value={item.description}
              />
            </FieldBox>
          </Field>
        ) : null}
        {shown.steps ? (
          <Field
            action={
              <span className="text-muted-foreground text-xs tabular-nums">
                {filled.filter((step) => step.done).length}/{filled.length}
              </span>
            }
            icon={CheckListIcon}
            label="Next steps"
          >
            <StepsEditor
              focusSeq={stepsFocus}
              newStep={newStep}
              onChange={saveSteps}
              goesWhenLeft={(step) =>
                step.text.trim() === "" && untyped.current.has(step.id)
              }
              onRemoved={(step, index) => {
                props.onUndoable({ index, kind: "step", step });
              }}
              onUndo={props.onUndo}
              steps={steps}
            />
            <div>
              <Button
                data-add-step
                onClick={() => {
                  saveSteps([...steps, newStep()]);
                  setStepsFocus((seq) => seq + 1);
                }}
                size="xs"
                variant="quiet"
              >
                <HugeiconsIcon data-icon="inline-start" icon={PlusSignIcon} />
                Add step
              </Button>
            </div>
          </Field>
        ) : null}
        {shown.due ? (
          <DueField
            item={item}
            now={now}
            onApply={props.onApply}
            onOpenChange={setDueOpen}
            open={dueOpen}
          />
        ) : null}
        <AddMenu
          addable={FIELDS.filter((field) => !shown[field])}
          attachments={props.attachments}
          item={item}
          onAdd={open}
          onLinkWindow={props.onLinkWindow}
          onOpenPins={props.onOpenPins}
        />
        {item.windows.length === 0 ? null : (
          <WindowsField
            item={item}
            onApply={props.onApply}
            onReopenWindow={props.onReopenWindow}
            onUndoable={props.onUndoable}
          />
        )}
        <SourceField item={item} onOpenLink={props.onOpenLink} />
        {/* When it was added: a quiet footer at the foot of details, not a field. */}
        <footer className="text-muted-foreground/80 mt-auto pt-2 text-xs">
          {addedText(item)}
        </footer>
      </div>
    </div>
  );
};

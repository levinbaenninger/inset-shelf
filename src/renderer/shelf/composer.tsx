import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { parseComposer, TEXT_MAX } from "@shared/shelf";
import { useImperativeHandle, useRef, useState } from "react";
import type { Ref } from "react";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
} from "@/components/ui/input-group";
import { cn } from "@/lib/utils";
import { Truncated } from "@/shared/clamp";
import { coach } from "@/tutorial/anchors";

import { MarkdownField } from "./markdown-field";
import type { MarkdownFieldHandle } from "./markdown-field";
import { AddMenu } from "./menus";
import type { AddActions } from "./menus";

export interface ComposerProps {
  readonly sectionName: string;
  readonly onSubmit: (text: string) => void;
  /** ↑ in an empty composer moves into the list. */
  readonly onLeaveUp: () => void;
  /** Escape in an empty composer hides the shelf. */
  readonly onEscape: () => void;
  readonly ref?: Ref<MarkdownFieldHandle>;
  /** The other ways to add, behind the "+": files, a drawing, a window link. */
  readonly addActions: AddActions;
  /** Kept mounted while details show, so a half-typed note survives. */
  readonly hidden?: boolean;
  /** The sections there are, so "# Name" says whether it makes one or goes to one. */
  readonly sectionNames: readonly string[];
}

/**
 * Return adds the note, ⇧↩ adds a line (or a list item), and "# Name"
 * switches to (or makes) a section. Markdown is formatted as it is typed.
 * The note being typed is the composer's own: a keystroke renders the field,
 * never the list above it.
 */
export const Composer = ({
  addActions,
  hidden = false,
  onEscape,
  onLeaveUp,
  onSubmit,
  ref,
  sectionName,
  sectionNames,
}: ComposerProps) => {
  const field = useRef<MarkdownFieldHandle>(null);
  // Markdown, so the field can be cleared once a note is added.
  const [text, setText] = useState("");

  useImperativeHandle<MarkdownFieldHandle | null, MarkdownFieldHandle | null>(
    ref,
    () => field.current
  );

  // "# Name" makes a section on Return; the chip says so before it happens.
  const entry = parseComposer(text);

  const existing =
    entry.kind === "section" &&
    sectionNames.some(
      (name) => name.toLowerCase() === entry.name.toLowerCase()
    );

  return (
    <div
      className={cn("px-2 pt-1 pb-2", hidden && "hidden")}
      {...coach("composer")}
    >
      {/* The field keeps at least half the width: a longer "# Name" chip wraps to its own line under it. */}
      <InputGroup className="h-auto flex-wrap items-start [&>:has(>[data-slot=input-group-control])]:min-w-1/2">
        <InputGroupAddon align="inline-start-top">
          <AddMenu
            actions={addActions}
            onClosed={() => {
              field.current?.focus();
            }}
          >
            <InputGroupButton
              aria-label="Add"
              size="icon-xs"
              {...coach("add-button")}
            >
              <HugeiconsIcon icon={PlusSignIcon} />
            </InputGroupButton>
          </AddMenu>
        </InputGroupAddon>
        <MarkdownField
          ariaLabel={`New note in ${sectionName}`}
          className="max-h-32 overflow-y-auto py-1.25 pr-2.5 pl-1.5"
          controlSlot
          headingRules={false}
          keys={{
            onEscape: (markdown) => {
              if (markdown.trim() === "") {
                onEscape();
              } else {
                setText("");
              }
            },
            onLeaveUp,
            onSubmit: (markdown) => {
              if (markdown.trim() !== "") {
                onSubmit(markdown.slice(0, TEXT_MAX));
                setText("");
              }
            },
          }}
          onChange={setText}
          placeholder="Jot down a thought…"
          ref={field}
          value={text}
        />
        {/* At the field's end, so "# Name" reads as a command, not a heading. */}
        <InputGroupAddon
          align="inline-end"
          aria-live="polite"
          className="ml-2 max-w-[calc(100%-0.5rem)] min-w-0"
        >
          {entry.kind === "section" ? (
            <span className="bg-pin/14 text-pin-ink dark:bg-pin/22 inline-flex h-5 max-w-full min-w-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium">
              <span className="shrink-0">↩</span>
              <Truncated
                text={`${existing ? "Go to section" : "New section"} ‘${entry.name}’`}
              />
            </span>
          ) : null}
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
};

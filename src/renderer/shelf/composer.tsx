import { FolderAddIcon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { parseComposer, TEXT_MAX } from "@shared/shelf";
import { useImperativeHandle, useRef } from "react";
import type { Ref } from "react";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
} from "@/components/ui/input-group";
import { cn } from "@/lib/utils";

import { MarkdownField } from "./markdown-field";
import type { MarkdownFieldHandle } from "./markdown-field";
import { AddMenu } from "./menus";
import type { AddActions } from "./menus";

export interface ComposerProps {
  readonly sectionName: string;
  /** Held by the shelf as Markdown, so it can clear the field once a note is added. */
  readonly text: string;
  readonly onTextChange: (text: string) => void;
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
 */
export const Composer = ({
  addActions,
  hidden = false,
  onEscape,
  onLeaveUp,
  onSubmit,
  onTextChange,
  ref,
  sectionName,
  sectionNames,
  text,
}: ComposerProps) => {
  const field = useRef<MarkdownFieldHandle>(null);

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
    <div className={cn("px-2 pt-1 pb-2", hidden && "hidden")}>
      {entry.kind === "section" ? (
        <p
          aria-live="polite"
          className="text-muted-foreground flex min-w-0 items-center gap-1.5 px-1 pb-1.5 text-xs"
        >
          <span className="bg-pin/14 text-pin-ink dark:bg-pin/22 inline-flex h-5 min-w-0 items-center gap-1 rounded-md px-1.5 font-medium">
            <HugeiconsIcon
              className="shrink-0"
              icon={FolderAddIcon}
              size={12}
            />
            <span className="shrink-0">↩</span>
            <span className="truncate">
              {existing ? "Go to section" : "New section"} ‘{entry.name}’
            </span>
          </span>
        </p>
      ) : null}
      <InputGroup className="h-auto items-start">
        <InputGroupAddon align="inline-start-top">
          <AddMenu
            actions={addActions}
            onClosed={() => {
              field.current?.focus();
            }}
          >
            <InputGroupButton aria-label="Add" size="icon-xs">
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
                onTextChange("");
              }
            },
            onLeaveUp,
            onSubmit: (markdown) => {
              if (markdown.trim() !== "") {
                onSubmit(markdown.slice(0, TEXT_MAX));
                onTextChange("");
              }
            },
          }}
          onChange={onTextChange}
          placeholder="Jot down a thought…"
          ref={field}
          value={text}
        />
      </InputGroup>
    </div>
  );
};

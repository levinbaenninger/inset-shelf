import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { TEXT_MAX } from "@shared/shelf";
import { useImperativeHandle, useRef } from "react";
import type { Ref } from "react";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
} from "@/components/ui/input-group";

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
  /** The other ways to add, behind the "+": an area, files, a drawing. */
  readonly addActions: AddActions;
}

/**
 * Return adds the note, ⇧↩ adds a line (or a list item), and "# Name"
 * switches to (or makes) a section. Markdown is formatted as it is typed.
 */
export const Composer = ({
  addActions,
  onEscape,
  onLeaveUp,
  onSubmit,
  onTextChange,
  ref,
  sectionName,
  text,
}: ComposerProps) => {
  const field = useRef<MarkdownFieldHandle>(null);

  useImperativeHandle<MarkdownFieldHandle | null, MarkdownFieldHandle | null>(
    ref,
    () => field.current
  );

  return (
    <div className="px-2 pt-1 pb-2">
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

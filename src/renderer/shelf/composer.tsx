import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { TEXT_MAX } from "@shared/shelf";
import type { KeyboardEvent, Ref } from "react";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";

import { AddMenu } from "./menus";
import type { AddActions } from "./menus";

export interface ComposerProps {
  readonly sectionName: string;
  /** Held by the shelf, so a menu can start a section by filling in "# ". */
  readonly text: string;
  readonly onTextChange: (text: string) => void;
  readonly onSubmit: (text: string) => void;
  /** ↑ in an empty composer moves into the list. */
  readonly onLeaveUp: () => void;
  /** Escape in an empty composer hides the shelf. */
  readonly onEscape: () => void;
  readonly ref?: Ref<HTMLTextAreaElement>;
  /** The other ways to add, behind the "+": an area, files, a drawing. */
  readonly addActions: AddActions;
}

/** Return adds the note, ⇧↩ adds a line, and "# Name" switches to (or makes) a section. */
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
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.nativeEvent.isComposing) {
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();

      if (text.trim() !== "") {
        onSubmit(text);
        onTextChange("");
      }
    } else if (event.key === "ArrowUp" && text === "") {
      event.preventDefault();
      onLeaveUp();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();

      if (text === "") {
        onEscape();
      } else {
        onTextChange("");
      }
    }
  };

  return (
    <div className="px-2 pt-1 pb-2">
      <InputGroup>
        <InputGroupAddon>
          <AddMenu actions={addActions}>
            <InputGroupButton aria-label="Add" size="icon-xs">
              <HugeiconsIcon icon={PlusSignIcon} />
            </InputGroupButton>
          </AddMenu>
        </InputGroupAddon>
        <InputGroupTextarea
          aria-label={`New note in ${sectionName}`}
          className="max-h-32 min-h-0"
          maxLength={TEXT_MAX}
          onChange={(event) => {
            onTextChange(event.target.value);
          }}
          onKeyDown={onKeyDown}
          placeholder="Jot down a thought…"
          ref={ref}
          rows={1}
          value={text}
        />
      </InputGroup>
    </div>
  );
};

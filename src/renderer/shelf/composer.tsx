import { TEXT_MAX } from "@shared/shelf";
import type { ClipboardEvent, KeyboardEvent, Ref } from "react";

import { Textarea } from "@/components/ui/textarea";

export interface ComposerProps {
  readonly sectionName: string;
  /** Held by the shelf, so a menu can start a section by filling in "# ". */
  readonly text: string;
  readonly onTextChange: (text: string) => void;
  readonly onSubmit: (text: string) => void;
  readonly onPasteImage: (bytes: Uint8Array<ArrayBuffer>) => void;
  /** ↑ in an empty composer moves into the list. */
  readonly onLeaveUp: () => void;
  /** Escape in an empty composer hides the shelf. */
  readonly onEscape: () => void;
  readonly ref?: Ref<HTMLTextAreaElement>;
}

const imageFrom = (event: ClipboardEvent<HTMLTextAreaElement>): File | null => {
  for (const item of event.clipboardData.items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      return item.getAsFile();
    }
  }

  return null;
};

const pasteFile = async (
  file: File,
  onPasteImage: (bytes: Uint8Array<ArrayBuffer>) => void
): Promise<void> => {
  onPasteImage(new Uint8Array(await file.arrayBuffer()));
};

/** Return adds the note, ⇧↩ adds a line, and "# Name" switches to (or makes) a section. */
export const Composer = ({
  onEscape,
  onLeaveUp,
  onPasteImage,
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
    <div className="px-3 pt-2 pb-3">
      <Textarea
        aria-label={`New note in ${sectionName}`}
        className="max-h-32 min-h-0 resize-none"
        maxLength={TEXT_MAX}
        onChange={(event) => {
          onTextChange(event.target.value);
        }}
        onKeyDown={onKeyDown}
        onPaste={(event) => {
          const file = imageFrom(event);

          if (file !== null) {
            event.preventDefault();
            void pasteFile(file, onPasteImage);
          }
        }}
        placeholder="Note or prompt"
        ref={ref}
        rows={1}
        value={text}
      />
    </div>
  );
};

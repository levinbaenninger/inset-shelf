import { TEXT_MAX } from "@shared/shelf";
import { shortcutLabels } from "@shared/shortcut";
import { useState } from "react";
import type { ClipboardEvent, KeyboardEvent, Ref } from "react";

import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";
import { isMac } from "@/shared/platform";

export interface ComposerProps {
  readonly sectionName: string;
  readonly onSubmit: (text: string) => void;
  readonly onPasteImage: (bytes: Uint8Array<ArrayBuffer>) => void;
  /** ↑ in an empty composer moves into the list. */
  readonly onLeaveUp: () => void;
  /** Escape in an empty composer hides the shelf. */
  readonly onEscape: () => void;
  readonly ref?: Ref<HTMLTextAreaElement>;
}

const labels = shortcutLabels(isMac);

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
  ref,
  sectionName,
}: ComposerProps) => {
  const [text, setText] = useState("");

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.nativeEvent.isComposing) {
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();

      if (text.trim() !== "") {
        onSubmit(text);
        setText("");
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
        setText("");
      }
    }
  };

  return (
    <div className="flex flex-col gap-1.5 px-3 pt-2 pb-3">
      <Textarea
        aria-label={`New note in ${sectionName}`}
        className="max-h-32 min-h-0 resize-none"
        maxLength={TEXT_MAX}
        onChange={(event) => {
          setText(event.target.value);
        }}
        onKeyDown={onKeyDown}
        onPaste={(event) => {
          const file = imageFrom(event);

          if (file !== null) {
            event.preventDefault();
            void pasteFile(file, onPasteImage);
          }
        }}
        placeholder="Write a note or a prompt for later"
        ref={ref}
        rows={1}
        value={text}
      />
      <p className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span>
          <Kbd>{labels.doubleShift}</Kbd> saves selected text
        </span>
        <span>
          <Kbd>{labels.area}</Kbd> area or pin
        </span>
        <span>
          <Kbd>#</Kbd> name starts a section
        </span>
      </p>
    </div>
  );
};

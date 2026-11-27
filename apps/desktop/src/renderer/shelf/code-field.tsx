import { cn } from "@inset/ui/lib/utils";
import { useEffect, useImperativeHandle, useRef } from "react";
import type { Ref } from "react";

import { CODE_BLOCK } from "./markdown";
import type {
  MarkdownFieldHandle,
  MarkdownFieldKeys,
  ScreenPoint,
} from "./markdown-field";

/**
 * A field for code: plain text in the block it reads in, so its value is
 * the item's words exactly, every space and blank line kept, and no key or
 * paste can turn it into something else. Return and ⇧↩ add a line, ⌘↩ (Ctrl+↩)
 * saves, Escape keeps the old code.
 */
export const CodeField = ({
  ariaLabel,
  caretAt,
  className,
  keys,
  onBlur,
  onChange,
  ref,
  value,
}: {
  readonly value: string;
  readonly onChange: (text: string) => void;
  readonly onBlur: (text: string) => void;
  readonly keys: Pick<MarkdownFieldKeys, "onEscape" | "onSubmit">;
  readonly ariaLabel: string;
  /** The caret goes to the character under this point, where the user clicked, instead of the end. */
  readonly caretAt: ScreenPoint | null;
  readonly className?: string;
  readonly ref?: Ref<MarkdownFieldHandle>;
}) => {
  const textarea = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      element: () => textarea.current,
      focus: () => {
        textarea.current?.focus();
      },
    }),
    []
  );

  useEffect(() => {
    const field = textarea.current;

    if (field === null) {
      return;
    }

    const at =
      caretAt === null
        ? null
        : document.caretPositionFromPoint(caretAt.x, caretAt.y);

    const offset = at?.offsetNode === field ? at.offset : field.value.length;

    field.focus();
    field.setSelectionRange(offset, offset);
  }, [caretAt]);

  return (
    <div className={cn("min-w-0 flex-1", className)}>
      <textarea
        aria-label={ariaLabel}
        className={cn(
          CODE_BLOCK,
          "block w-full resize-none py-1.5 outline-none field-sizing-content"
        )}
        defaultValue={value}
        onBlur={(event) => {
          onBlur(event.currentTarget.value);
        }}
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) {
            return;
          }

          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            keys.onSubmit(event.currentTarget.value);
          } else if (event.key === "Escape") {
            event.preventDefault();
            keys.onEscape(event.currentTarget.value);
          }
        }}
        ref={textarea}
        spellCheck={false}
      />
    </div>
  );
};

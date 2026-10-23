import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { useEffect, useImperativeHandle, useRef } from "react";
import type { Ref } from "react";

import { cn } from "@/lib/utils";

/** The editor that has the keyboard, so the menu bar's Undo and Redo reach its own history. */
let focusedEditor: Editor | null = null;

export const editorWithFocus = (): Editor | null => focusedEditor;

/**
 * A hard break is written as two spaces and a newline; the shelf shows a plain
 * newline as a break anyway (remark-breaks), so notes keep plain newlines.
 */
const toMarkdown = (editor: Editor): string =>
  editor.getMarkdown().replaceAll("  \n", "\n");

/** What a note field does with the keys a plain field would not. */
export interface MarkdownFieldKeys {
  /** Return, or ⌘↩: the note is done. */
  readonly onSubmit: (markdown: string) => void;
  /** Escape. */
  readonly onEscape: (markdown: string) => void;
  /** ↑ in an empty field. */
  readonly onLeaveUp?: () => void;
}

export interface MarkdownFieldHandle {
  readonly focus: () => void;
  /** The editable element, to tell whether it has focus. */
  readonly element: () => HTMLElement | null;
}

const isInside = (editor: Editor, node: string): boolean =>
  editor.isActive(node);

/** The editable element's attributes: a multi-line text box, and in an input group its control. */
const fieldAttributes = (
  ariaLabel: string,
  className: string | undefined,
  controlSlot: boolean
) => {
  const attributes = {
    "aria-label": ariaLabel,
    "aria-multiline": "true",
    class: cn("shelf-editor outline-none", className),
    role: "textbox",
  };

  return controlSlot
    ? { ...attributes, "data-slot": "input-group-control" }
    : attributes;
};

/**
 * A note field that formats Markdown as it is typed: **bold**, *italic*,
 * `code`, lists, quotes and headings show at once, and pasted formatting is
 * kept. It still reads and writes Markdown, so notes are stored as before.
 */
export const MarkdownField = ({
  ariaLabel,
  autoFocus = false,
  className,
  controlSlot = false,
  keys,
  onBlur,
  onChange,
  placeholder,
  ref,
  value,
}: {
  /** Markdown; the field follows it when it changes from outside, such as after a note is added. */
  readonly value: string;
  readonly onChange: (markdown: string) => void;
  readonly keys: MarkdownFieldKeys;
  readonly ariaLabel: string;
  readonly placeholder?: string;
  readonly autoFocus?: boolean;
  readonly className?: string;
  /** In an input group, the field is its control, which draws the group's focus ring. */
  readonly controlSlot?: boolean;
  readonly onBlur?: (markdown: string) => void;
  readonly ref?: Ref<MarkdownFieldHandle>;
}) => {
  // ProseMirror's key handler is set up once; it reads the newest callbacks from here.
  const latest = useRef({ keys, onBlur, onChange });
  const emitted = useRef(value);
  const editorRef = useRef<Editor | null>(null);

  useEffect(() => {
    latest.current = { keys, onBlur, onChange };
  });

  const editor = useEditor({
    autofocus: autoFocus ? "end" : false,
    content: value,
    contentType: "markdown",
    editorProps: {
      attributes: fieldAttributes(ariaLabel, className, controlSlot),
      handleKeyDown: (_view, event) => {
        const { current } = editorRef;

        if (current === null || event.isComposing) {
          return false;
        }

        const { keys: handlers } = latest.current;

        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          handlers.onSubmit(toMarkdown(current));

          return true;
        }

        if (event.key === "Enter" && event.shiftKey) {
          // A new item in a list, a new line in code, else a new paragraph, so "- " or "> " can start one.
          if (isInside(current, "listItem")) {
            // On an empty item it leaves the list, as in any editor.
            return current.state.selection.$from.parent.content.size === 0
              ? current.commands.liftListItem("listItem")
              : current.commands.splitListItem("listItem");
          }

          return isInside(current, "codeBlock")
            ? false
            : current.commands.splitBlock();
        }

        if (event.key === "Enter" && !isInside(current, "codeBlock")) {
          handlers.onSubmit(toMarkdown(current));

          return true;
        }

        if (event.key === "Escape") {
          handlers.onEscape(toMarkdown(current));

          return true;
        }

        if (
          event.key === "ArrowUp" &&
          current.isEmpty &&
          handlers.onLeaveUp !== undefined
        ) {
          handlers.onLeaveUp();

          return true;
        }

        return false;
      },
    },
    extensions: [
      StarterKit.configure({
        dropcursor: false,
        heading: { levels: [1, 2, 3] },
        // Links open from the list, through the app, never inside the field.
        link: { autolink: true, openOnClick: false },
        trailingNode: false,
        underline: false,
      }),
      Markdown.configure({ markedOptions: { breaks: true, gfm: true } }),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
    ],
    onBlur: ({ editor: current }) => {
      if (focusedEditor === current) {
        focusedEditor = null;
      }

      latest.current.onBlur?.(toMarkdown(current));
    },
    onFocus: ({ editor: current }) => {
      focusedEditor = current;
    },
    onUpdate: ({ editor: current }) => {
      const markdown = toMarkdown(current);

      emitted.current = markdown;
      latest.current.onChange(markdown);
    },
  });

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // The value set from outside (cleared after adding a note) replaces what is typed.
  useEffect(() => {
    if (editor !== null && value !== emitted.current) {
      emitted.current = value;
      editor.commands.setContent(value, { contentType: "markdown" });
    }
  }, [editor, value]);

  useImperativeHandle(
    ref,
    () => ({
      element: () => editor?.view.dom ?? null,
      focus: () => {
        editor?.commands.focus("end");
      },
    }),
    [editor]
  );

  return <EditorContent className="min-w-0 flex-1" editor={editor} />;
};

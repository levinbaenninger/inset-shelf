import { cn } from "@inset/ui/lib/utils";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { useEffect, useImperativeHandle, useRef } from "react";
import type { Ref } from "react";

import { NOTE_EXTENSIONS, noteMarkdown } from "./note-markdown";

/** The editor that has the keyboard, so the menu bar's Undo and Redo reach its own history. */
let focusedEditor: Editor | null = null;

export const editorWithFocus = (): Editor | null => focusedEditor;

const toMarkdown = (editor: Editor): string => {
  // NOTE_EXTENSIONS holds Markdown, which gives every field's editor this.
  if (editor.markdown === undefined) {
    throw new Error("A note field reads and writes Markdown.");
  }

  return noteMarkdown(editor.markdown, editor.getJSON());
};

/** What a note field does with the keys a plain field would not. */
export interface MarkdownFieldKeys {
  /** Return, or ⌘↩: the note is done. */
  readonly onSubmit: (markdown: string) => void;
  /** Escape. */
  readonly onEscape: (markdown: string) => void;
  /** ↑ in an empty field. */
  readonly onLeaveUp?: () => void;
}

/** A point on screen, in CSS pixels: where a click asked for the caret. */
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export interface MarkdownFieldHandle {
  readonly focus: () => void;
  /** The editable element, to tell whether it has focus. */
  readonly element: () => HTMLElement | null;
}

/**
 * Every Markdown shortcut but "# ", for the note field: there "# Name" makes
 * a section, so it must not turn into a bold heading as it is typed.
 */
const RULES_WITHOUT_HEADINGS = [
  "blockquote",
  "bold",
  "bulletList",
  "code",
  "codeBlock",
  "horizontalRule",
  "italic",
  "orderedList",
  "strike",
];

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
  caretAt = null,
  className,
  controlSlot = false,
  followValue = true,
  headingRules = true,
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
  /** With autoFocus: the caret goes to the words under this point, where the user clicked, instead of the end. */
  readonly caretAt?: ScreenPoint | null;
  readonly className?: string;
  /** In an input group, the field is its control, which draws the group's focus ring. */
  readonly controlSlot?: boolean;
  /** Whether "# " turns a line into a heading as it is typed. */
  readonly headingRules?: boolean;
  /** False: `value` only starts the field, and a later one (main's echo of the edit) leaves what is typed alone. */
  readonly followValue?: boolean;
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
    autofocus: autoFocus && caretAt === null ? "end" : false,
    content: value,
    contentType: "markdown",
    enableInputRules: headingRules ? true : RULES_WITHOUT_HEADINGS,
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
      ...NOTE_EXTENSIONS,
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

  // Placed once the words are laid out where the read text was, so the point lands on the same word.
  const placed = useRef(false);

  useEffect(() => {
    if (!autoFocus || caretAt === null || editor === null || placed.current) {
      return;
    }

    placed.current = true;
    requestAnimationFrame(() => {
      const at = editor.view.posAtCoords({ left: caretAt.x, top: caretAt.y });

      editor
        .chain()
        .focus()
        .setTextSelection(at?.pos ?? editor.state.doc.content.size)
        .run();
    });
  }, [autoFocus, caretAt, editor]);

  // The value set from outside (cleared after adding a note) replaces what is typed.
  useEffect(() => {
    if (followValue && editor !== null && value !== emitted.current) {
      emitted.current = value;
      editor.commands.setContent(value, { contentType: "markdown" });
    }
  }, [editor, followValue, value]);

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

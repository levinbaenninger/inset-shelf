import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { drawingBridge } from "@/shared/bridge";
import { useLocalKeys } from "@/shared/keys";

import { Page } from "./page";
import { exportPng } from "./render";
import {
  addMark,
  canRedo,
  canUndo,
  clearMarks,
  emptyHistory,
  redo,
  undo,
} from "./sketch";
import type { Color, History, Mark, Stroke, Tool } from "./sketch";
import { Toolbar } from "./toolbar";
import { SAVE_KEYS, useDark, useDrawingKeys } from "./use-drawing-keys";

const api = drawingBridge();

/** Resolves to a problem to show, or null once main has the drawing. */
const saveDrawing = async (
  copy: boolean,
  marks: readonly Mark[]
): Promise<string | null> => {
  try {
    const png = await exportPng(marks);

    if (png === null) {
      return null;
    }

    const result = await api.save({ copy, png });

    return result.ok ? null : result.message;
  } catch {
    return "The drawing could not be saved.";
  }
};

/** One drawing from a blank page; the app remounts it for a fresh page. */
const Editor = () => {
  const [history, setHistory] = useState<History>(emptyHistory);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState<Color>("ink");
  const [stroke, setStroke] = useState<Stroke>("thin");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const dark = useDark();
  const marks = history.present;
  const empty = marks.length === 0;

  // Takes the marks to save, so ⌘↩ in the text field can include the text it just added.
  const save = async (
    copy: boolean,
    toSave: readonly Mark[]
  ): Promise<void> => {
    if (saving || toSave.length === 0) {
      return;
    }

    setSaving(true);
    setProblem(null);
    setProblem(await saveDrawing(copy, toSave));
    setSaving(false);
  };

  const add = (mark: Mark): History => {
    const next = addMark(history, mark);

    setHistory(next);

    return next;
  };

  useLocalKeys({
    // Only an empty page closes on Esc, so a stray key never throws a drawing away.
    onEscape: () => {
      if (empty) {
        api.cancel();
      }
    },
    onSave: () => {
      void save(false, marks);
    },
  });

  useEffect(() => {
    api.setDirty(!empty);
  }, [empty]);

  // The menu bar's Undo and Redo arrive here instead of as keys.
  useEffect(
    () =>
      api.on("edit", (kind) => {
        setHistory((current) =>
          kind === "undo" ? undo(current) : redo(current)
        );
      }),
    []
  );

  useDrawingKeys({
    pickTool: setTool,
    redo: () => {
      setHistory(redo(history));
    },
    undo: () => {
      setHistory(undo(history));
    },
  });

  return (
    <main className="bg-background flex h-svh flex-col overflow-hidden select-none">
      <header className="drag-region flex h-12 shrink-0 items-center justify-end gap-2 border-b pr-3 pl-20">
        {problem === null ? null : (
          <p className="text-destructive min-w-0 truncate text-xs" role="alert">
            {problem}
          </p>
        )}
        <Button
          disabled={empty || saving}
          onClick={() => {
            void save(true, marks);
          }}
          variant="secondary"
        >
          Copy and Save
        </Button>
        <Button
          disabled={empty || saving}
          onClick={() => {
            void save(false, marks);
          }}
        >
          Save
          <Kbd>{SAVE_KEYS}</Kbd>
        </Button>
      </header>
      <div className="relative min-h-0 flex-1">
        <Page
          color={color}
          dark={dark}
          marks={marks}
          onAdd={(mark) => {
            add(mark);
          }}
          onSubmit={(mark) => {
            const next = mark === null ? history : add(mark);

            void save(false, next.present);
          }}
          stroke={stroke}
          tool={tool}
        />
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
          <Toolbar
            canClear={!empty}
            canRedo={canRedo(history)}
            canUndo={canUndo(history)}
            color={color}
            dark={dark}
            onClear={() => {
              setHistory(clearMarks(history));
            }}
            onColor={setColor}
            onRedo={() => {
              setHistory(redo(history));
            }}
            onStroke={setStroke}
            onTool={setTool}
            onUndo={() => {
              setHistory(undo(history));
            }}
            stroke={stroke}
            tool={tool}
          />
        </div>
      </div>
    </main>
  );
};

/** Opening the window again sends `reset`, which starts over with a blank page and no history. */
export const DrawingApp = () => {
  const [session, setSession] = useState(0);

  useEffect(
    () =>
      api.on("reset", () => {
        setSession((current) => current + 1);
      }),
    []
  );

  return <Editor key={session} />;
};

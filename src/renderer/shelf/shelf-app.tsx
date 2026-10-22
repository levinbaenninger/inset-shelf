import { Cancel01Icon, CropIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ShelfView } from "@shared/contracts";
import { itemsInSection } from "@shared/shelf";
import type { ItemId, ShelfOp } from "@shared/shelf";
import { shortcutLabels } from "@shared/shortcut";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { shelfBridge } from "@/shared/bridge";
import { isMac } from "@/shared/platform";
import { useExpiringState } from "@/shared/use-expiring-state";
import { usePushedView } from "@/shared/use-pushed-view";

import { Banners } from "./banners";
import { Composer } from "./composer";
import { ItemRow } from "./item-row";
import { SectionMenu } from "./section-menu";
import { selectionAfterRemoval, stepSelection } from "./selection";
import { useShelfKeys } from "./use-shelf-keys";

const api = shelfBridge();
const labels = shortcutLabels(isMac);

const COPIED_MS = 1400;
const UNDO_VISIBLE_MS = 6000;

const load = async (): Promise<ShelfView> => await api.getView();

const subscribe = (listener: (view: ShelfView | null) => void) =>
  api.on("view", listener);

const apply = (op: ShelfOp): void => {
  api.apply(op);
};

const reveal = (id: ItemId): void => {
  requestAnimationFrame(() => {
    document
      .querySelector(`[data-item-id="${id}"]`)
      ?.scrollIntoView({ block: "nearest" });
  });
};

const EmptySection = ({ name }: { readonly name: string }) => (
  <div className="text-muted-foreground flex flex-col gap-3 px-5 py-8 text-sm">
    <p className="text-foreground font-medium">Nothing in {name} yet</p>
    <ul className="flex flex-col gap-2">
      <li>
        Select text in any app and tap <Kbd>{labels.doubleShift}</Kbd>.
      </li>
      <li>
        Press <Kbd>{labels.area}</Kbd>, then drag over the screen to keep an
        area, or click to pin a spot.
      </li>
      <li>Write a note or a prompt below, or paste an image.</li>
    </ul>
  </div>
);

const HeaderButton = ({
  hint,
  icon,
  label,
  onClick,
}: {
  readonly label: string;
  readonly hint: string;
  readonly icon: typeof CropIcon;
  readonly onClick: () => void;
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        aria-label={label}
        onClick={onClick}
        size="icon-sm"
        variant="ghost"
      >
        <HugeiconsIcon icon={icon} />
      </Button>
    </TooltipTrigger>
    <TooltipContent side="bottom">
      {label} <Kbd>{hint}</Kbd>
    </TooltipContent>
  </Tooltip>
);

const UndoBar = ({ onUndo }: { readonly onUndo: () => void }) => (
  <output className="bg-muted mx-3 mb-1 flex items-center justify-between rounded-lg px-3 py-1.5 text-xs">
    <span>Item deleted</span>
    <Button onClick={onUndo} size="xs" variant="ghost">
      Undo <Kbd>{isMac ? "⌘Z" : "Ctrl+Z"}</Kbd>
    </Button>
  </output>
);

const Shelf = ({ view }: { readonly view: ShelfView }) => {
  const { canUndo, doc, focus, status } = view;
  const items = itemsInSection(doc, doc.activeSectionId);
  const ids = items.map((item) => item.id);
  const newest = ids.at(-1);

  const sectionName =
    doc.sections.find((section) => section.id === doc.activeSectionId)?.name ??
    "";

  const [selectedId, setSelectedId] = useState<ItemId | null>(null);
  const [editingId, setEditingId] = useState<ItemId | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [handledFocus, setHandledFocus] = useState(0);
  const [copiedId, setCopiedId] = useExpiringState<ItemId>(COPIED_MS);
  const [undoShown, setUndoShown] = useExpiringState<true>(UNDO_VISIBLE_MS);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // A capture asks main to show its item: select it, and open an image's note for typing.
  if (focus !== null && focus.seq !== handledFocus) {
    const kind = doc.items.find((item) => item.id === focus.id)?.kind;

    setHandledFocus(focus.seq);
    setSelectedId(focus.id);
    setEditingId(kind === "image" ? focus.id : null);
  }

  useEffect(() => {
    if (focus !== null) {
      reveal(focus.id);
    }
  }, [focus]);

  // New items arrive at the bottom: keep the newest in view.
  useEffect(() => {
    if (newest !== undefined) {
      reveal(newest);
    }
  }, [newest]);

  const selected = items.find((item) => item.id === selectedId);

  const copy = async (id: ItemId): Promise<void> => {
    const result = await api.copy(id);

    if (result.ok) {
      setCopiedId(id);
    }
  };

  const remove = (id: ItemId): void => {
    setSelectedId(selectionAfterRemoval(ids, id));
    setEditingId(null);
    apply({ id, type: "remove" });
    setUndoShown(true);
  };

  const undo = (): void => {
    apply({ type: "undoRemove" });
    setUndoShown(null);
  };

  const focusComposer = (): void => {
    setSelectedId(null);
    composerRef.current?.focus();
  };

  // Moving into the list leaves the note field, so plain keys act on the selection.
  const selectItem = (id: ItemId): void => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    setSelectedId(id);
    reveal(id);
  };

  const onSelected = (run: (id: ItemId) => void): (() => void) | null =>
    selected === undefined
      ? null
      : () => {
          run(selected.id);
        };

  useShelfKeys({
    copy: onSelected((id) => {
      void copy(id);
    }),
    edit: onSelected(setEditingId),
    hide: () => {
      api.hide();
    },
    move: (offset) => {
      const next = stepSelection(ids, selectedId, offset);

      if (next === null) {
        focusComposer();
      } else {
        selectItem(next);
      }
    },
    remove: onSelected(remove),
    startNote: focusComposer,
    toggleDone: onSelected((id) => {
      apply({ id, type: "toggleDone" });
    }),
    toggleMenu: () => {
      setMenuOpen((open) => !open);
    },
    undo: canUndo ? undo : null,
  });

  return (
    <div className="bg-background text-foreground flex h-svh flex-col">
      <header className="drag-region flex h-11 shrink-0 items-center justify-between gap-1 px-2">
        <h1 className="sr-only">Inset Shelf: {sectionName}</h1>
        <SectionMenu
          doc={doc}
          onClearDone={() => {
            apply({ type: "clearDone" });
          }}
          onOpenChange={setMenuOpen}
          onSelect={(id) => {
            setSelectedId(null);
            apply({ id, type: "selectSection" });
          }}
          open={menuOpen}
        />
        <div className="flex items-center">
          <HeaderButton
            hint={labels.area}
            icon={CropIcon}
            label="Capture area or pin"
            onClick={() => {
              api.captureArea();
            }}
          />
          <HeaderButton
            hint="Esc"
            icon={Cancel01Icon}
            label="Hide shelf"
            onClick={() => {
              api.hide();
            }}
          />
        </div>
      </header>
      <Banners
        onDismissProblem={() => {
          api.dismissProblem();
        }}
        onOpenKeySettings={() => {
          api.openKeySettings();
        }}
        status={status}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <EmptySection name={sectionName} />
        ) : (
          <ul
            aria-label={`Items in ${sectionName}`}
            className="flex flex-col gap-0.5 px-1.5 py-1 outline-none"
          >
            {items.map((item) => (
              <ItemRow
                copied={copiedId === item.id}
                editing={editingId === item.id}
                item={item}
                key={item.id}
                onCopy={() => {
                  void copy(item.id);
                }}
                onDragImage={() => {
                  api.startDrag(item.id);
                }}
                onEditNote={(note) => {
                  apply({ id: item.id, note, type: "editNote" });
                }}
                onEditText={(text) => {
                  apply({ id: item.id, text, type: "editText" });
                }}
                onRemove={() => {
                  remove(item.id);
                }}
                onEdit={() => {
                  setSelectedId(item.id);
                  setEditingId(item.id);
                }}
                onSelect={() => {
                  setSelectedId(item.id);
                }}
                onStopEditing={() => {
                  setEditingId(null);
                }}
                onToggle={() => {
                  apply({ id: item.id, type: "toggleDone" });
                }}
                selected={selectedId === item.id}
              />
            ))}
          </ul>
        )}
      </div>
      {undoShown !== null && canUndo ? <UndoBar onUndo={undo} /> : null}
      <Composer
        onEscape={() => {
          api.hide();
        }}
        onLeaveUp={() => {
          if (newest !== undefined) {
            selectItem(newest);
          }
        }}
        onPasteImage={(bytes) => {
          void api.pasteImage(bytes);
        }}
        onSubmit={(text) => {
          apply({ text, type: "compose" });
        }}
        ref={composerRef}
        sectionName={sectionName}
      />
    </div>
  );
};

export const ShelfApp = () => {
  const view = usePushedView<ShelfView | null>(load, subscribe, null);

  return view === null ? null : <Shelf view={view} />;
};

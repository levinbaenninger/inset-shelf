import { MoreHorizontalIcon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ShelfCommand, ShelfView } from "@shared/contracts";
import type { MenuChoice } from "@shared/menus";
import { groupItems } from "@shared/shelf";
import type { ItemId, ShelfOp } from "@shared/shelf";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { ComponentProps, PointerEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { filePath, shelfBridge } from "@/shared/bridge";
import { isMac } from "@/shared/platform";
import { useExpiringState } from "@/shared/use-expiring-state";
import { usePushedView } from "@/shared/use-pushed-view";

import { Banners } from "./banners";
import { Composer } from "./composer";
import { ItemRow } from "./item-row";
import { ItemMenu, SectionMenu } from "./menus";
import type { ItemMenuAnchor } from "./menus";
import { selectionAfterRemoval, stepSelection } from "./selection";
import { isTextField, useShelfKeys } from "./use-shelf-keys";

const api = shelfBridge();

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

/** A text field, or a text selection anywhere, keeps the normal Copy and Undo. */
const inTextContext = (): boolean =>
  isTextField(document.activeElement) ||
  window.getSelection()?.isCollapsed === false;

/** Takes the props of a menu trigger wrapped around it. */
const HeaderButton = ({
  icon,
  label,
  ...props
}: {
  readonly label: string;
  readonly icon: typeof Search01Icon;
} & ComponentProps<typeof Button>) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button aria-label={label} size="icon-sm" variant="ghost" {...props}>
        <HugeiconsIcon icon={icon} />
      </Button>
    </TooltipTrigger>
    <TooltipContent side="bottom">{label}</TooltipContent>
  </Tooltip>
);

const UndoBar = ({ onUndo }: { readonly onUndo: () => void }) => (
  <output className="bg-foreground/5 mx-3 mb-1 flex items-center justify-between rounded-lg px-3 py-1 text-xs">
    <span>Deleted</span>
    <Button onClick={onUndo} size="xs" variant="ghost">
      Undo
    </Button>
  </output>
);

/** Files dropped or pasted in: by path when they have one, else as image bytes (an image copied from a page). */
const addDataFiles = async (files: readonly File[]): Promise<void> => {
  const paths = files.flatMap((file) => {
    const found = filePath(file);

    return found === "" ? [] : [found];
  });

  if (paths.length > 0) {
    await api.addFiles(paths);

    return;
  }

  const images = files.filter((file) => file.type.startsWith("image/"));

  await Promise.all(
    images.map(async (file) => {
      await api.pasteImage(new Uint8Array(await file.arrayBuffer()));
    })
  );
};

const hasFiles = (event: DragEvent): boolean =>
  event.dataTransfer?.types.includes("Files") === true;

/** Files can be dropped anywhere on the shelf, or pasted when the clipboard holds files. */
const useFileDrops = (): boolean => {
  const [over, setOver] = useState(false);

  const onDragOver = useEffectEvent((event: DragEvent) => {
    if (hasFiles(event)) {
      event.preventDefault();
      setOver(true);
    }
  });

  const onDragLeave = useEffectEvent((event: DragEvent) => {
    if (event.relatedTarget === null) {
      setOver(false);
    }
  });

  const onDrop = useEffectEvent((event: DragEvent) => {
    setOver(false);

    if (hasFiles(event)) {
      event.preventDefault();
      void addDataFiles([...(event.dataTransfer?.files ?? [])]);
    }
  });

  const onPaste = useEffectEvent((event: ClipboardEvent) => {
    const files = [...(event.clipboardData?.files ?? [])];

    if (files.length > 0) {
      event.preventDefault();
      void addDataFiles(files);
    }
  });

  useEffect(() => {
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("paste", onPaste);

    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("paste", onPaste);
    };
  }, []);

  return over;
};

const Shelf = ({ view }: { readonly view: ShelfView }) => {
  const { canUndo, doc, focus, status } = view;
  const [query, setQuery] = useState("");
  const groups = groupItems(doc, query);
  const items = groups.flatMap((group) => group.items);
  // ↑ and ↓ walk the items in the order they are shown, across sections.
  const ids = items.map((item) => item.id);

  const newest = doc.items.findLast(
    (item) => item.sectionId === doc.activeSectionId
  )?.id;

  const searchRef = useRef<HTMLInputElement>(null);
  const dropping = useFileDrops();

  const sectionName =
    doc.sections.find((section) => section.id === doc.activeSectionId)?.name ??
    "";

  const [selectedId, setSelectedId] = useState<ItemId | null>(null);
  const [editingId, setEditingId] = useState<ItemId | null>(null);
  const [draft, setDraft] = useState("");
  const [handledFocus, setHandledFocus] = useState(0);
  const [copiedId, setCopiedId] = useExpiringState<ItemId>(COPIED_MS);
  const [undoShown, setUndoShown] = useExpiringState<true>(UNDO_VISIBLE_MS);
  const [menuAnchor, setMenuAnchor] = useState<ItemMenuAnchor | null>(null);
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
  });

  // A click on empty space in the list lets go of the selection and any note being edited.
  const onListPointerDown = (event: PointerEvent<HTMLElement>): void => {
    if (
      event.target instanceof Element &&
      event.target.closest("li, button, input, textarea") !== null
    ) {
      return;
    }

    setSelectedId(null);
    setEditingId(null);

    if (
      document.activeElement instanceof HTMLElement &&
      isTextField(document.activeElement) &&
      document.activeElement !== composerRef.current
    ) {
      document.activeElement.blur();
    }
  };

  const choose = (choice: MenuChoice): void => {
    switch (choice.kind) {
      case "selectSection": {
        apply({ id: choice.id, type: "selectSection" });
        break;
      }

      case "clearDone": {
        apply({ type: "clearDone" });
        break;
      }

      case "newSection": {
        setDraft("# ");
        focusComposer();
        break;
      }

      case "openSettings": {
        api.openSettings();
        break;
      }

      case "copy": {
        void copy(choice.id);
        break;
      }

      case "copyWithLink": {
        api.copyWithLink(choice.id);
        break;
      }

      case "open": {
        api.openImage(choice.id);
        break;
      }

      case "setColor": {
        apply({ color: choice.color, id: choice.id, type: "setColor" });
        break;
      }

      case "edit": {
        setSelectedId(choice.id);
        setEditingId(choice.id);
        break;
      }

      case "toggleDone": {
        apply({ id: choice.id, type: "toggleDone" });
        break;
      }

      case "remove": {
        remove(choice.id);
        break;
      }

      case "moveTo": {
        apply({ id: choice.id, sectionId: choice.sectionId, type: "moveItem" });
        break;
      }

      default: {
        break;
      }
    }
  };

  const onCommand = useEffectEvent((command: ShelfCommand) => {
    switch (command.kind) {
      case "find": {
        searchRef.current?.focus();
        searchRef.current?.select();
        break;
      }

      case "newNote": {
        focusComposer();
        break;
      }

      case "newSection": {
        setDraft("# ");
        focusComposer();
        break;
      }

      case "copy": {
        if (inTextContext()) {
          api.nativeEdit("copy");
        } else if (selected !== undefined) {
          void copy(selected.id);
        }

        break;
      }

      case "undo": {
        if (inTextContext()) {
          api.nativeEdit("undo");
        } else if (canUndo) {
          undo();
        }

        break;
      }

      default: {
        break;
      }
    }
  });

  useEffect(() => api.on("command", onCommand), []);

  // Elsewhere than macOS, Chromium takes Ctrl+C and Ctrl+Z as its own edit
  // commands, so the menu never sees them: outside text the page answers them.
  const onEditKey = useEffectEvent((event: KeyboardEvent) => {
    const key = event.key.toLowerCase();

    if (
      isMac ||
      event.defaultPrevented ||
      !event.ctrlKey ||
      event.altKey ||
      event.shiftKey ||
      (key !== "c" && key !== "z") ||
      inTextContext()
    ) {
      return;
    }

    event.preventDefault();
    onCommand({ kind: key === "c" ? "copy" : "undo" });
  });

  useEffect(() => {
    window.addEventListener("keydown", onEditKey);

    return () => {
      window.removeEventListener("keydown", onEditKey);
    };
  }, []);

  return (
    <div
      className={cn(
        "shelf-panel text-foreground flex h-svh flex-col rounded-xl",
        dropping && "ring-pin ring-2 ring-inset"
      )}
    >
      <header className="drag-region flex h-12 shrink-0 items-center gap-1 px-2">
        <h1 className="sr-only">Inset Shelf</h1>
        <InputGroup>
          <InputGroupAddon>
            <HugeiconsIcon icon={Search01Icon} />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search the shelf"
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setQuery("");
                event.currentTarget.blur();
              }
            }}
            placeholder="Search"
            ref={searchRef}
            type="search"
            value={query}
          />
        </InputGroup>
        <SectionMenu doc={doc} onChoose={choose}>
          <HeaderButton icon={MoreHorizontalIcon} label="Sections" />
        </SectionMenu>
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
      <div
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-1"
        onPointerDown={onListPointerDown}
      >
        {groups.length === 0 ? (
          <p className="text-muted-foreground px-3 py-8 text-center text-sm">
            {query === "" ? "Nothing here yet" : "No matches"}
          </p>
        ) : null}
        {groups.map((group) => (
          <section aria-label={group.section.name} key={group.section.id}>
            <button
              aria-pressed={group.active}
              className={cn(
                "focus-visible:ring-ring/50 flex w-full items-center gap-1.5 rounded-md px-1 pt-2.5 pb-1.5 text-left text-xs font-medium outline-none focus-visible:ring-3",
                group.active ? "text-foreground" : "text-muted-foreground"
              )}
              onClick={() => {
                apply({ id: group.section.id, type: "selectSection" });
              }}
              title={group.active ? "New items go here" : "Add new items here"}
              type="button"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "size-1.5 rounded-full",
                  group.active ? "bg-pin" : "bg-transparent"
                )}
              />
              {group.section.name}
            </button>
            <ul className="flex flex-col gap-1.5">
              {group.items.map((item) => (
                <ItemRow
                  copied={copiedId === item.id}
                  editing={editingId === item.id}
                  item={item}
                  key={item.id}
                  onContextMenu={(anchor) => {
                    setSelectedId(item.id);
                    setMenuAnchor({ ...anchor, id: item.id });
                  }}
                  onDragImage={() => {
                    api.startDrag(item.id);
                  }}
                  onEdit={() => {
                    setSelectedId(item.id);
                    setEditingId(item.id);
                  }}
                  onEditNote={(note) => {
                    apply({ id: item.id, note, type: "editNote" });
                  }}
                  onOpen={() => {
                    api.openImage(item.id);
                  }}
                  onOpenLink={() => {
                    api.openLink(item.id);
                  }}
                  onEditText={(text) => {
                    apply({ id: item.id, text, type: "editText" });
                  }}
                  onSelect={() => {
                    // Picking another item ends editing elsewhere, so Copy and the list keys act on the pick.
                    if (editingId !== item.id) {
                      setEditingId(null);

                      const field = document.activeElement;

                      if (field instanceof HTMLElement && isTextField(field)) {
                        field.blur();
                      }
                    }

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
          </section>
        ))}
      </div>
      <ItemMenu
        anchor={menuAnchor}
        doc={doc}
        onChoose={choose}
        onClose={() => {
          setMenuAnchor(null);
        }}
      />
      {undoShown !== null && canUndo ? <UndoBar onUndo={undo} /> : null}
      <Composer
        addActions={{
          attachFiles: () => {
            api.attachFiles();
          },
          captureArea: () => {
            api.captureArea();
          },
          newDrawing: () => {
            api.newDrawing();
          },
        }}
        onEscape={() => {
          api.hide();
        }}
        onLeaveUp={() => {
          if (newest !== undefined) {
            selectItem(newest);
          }
        }}
        onSubmit={(text) => {
          apply({ text, type: "compose" });
        }}
        onTextChange={setDraft}
        ref={composerRef}
        sectionName={sectionName}
        text={draft}
      />
    </div>
  );
};

export const ShelfApp = () => {
  const view = usePushedView<ShelfView | null>(load, subscribe, null);

  return view === null ? null : <Shelf view={view} />;
};

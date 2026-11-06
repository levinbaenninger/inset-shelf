import { Cancel01Icon, MoreHorizontalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type {
  ActionResult,
  DetailField,
  ItemAction,
  NotSavedItem,
  ShelfCommand,
  ShelfStatus,
  ShelfView,
} from "@shared/contracts";
import { parseSearch } from "@shared/due";
import type { MenuChoice } from "@shared/menus";
import { groupItems, itemText, UNDO_MAX } from "@shared/shelf";
import type {
  ItemId,
  SectionId,
  ShelfItem,
  ShelfOp,
  WindowRef,
} from "@shared/shelf";
import { keyText } from "@shared/shortcut";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { ComponentProps, PointerEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { onMenusOpen } from "@/lib/menu-keys";
import { cn } from "@/lib/utils";
import { filePath, shelfBridge } from "@/shared/bridge";
import { isMac } from "@/shared/platform";
import { useExpiringState } from "@/shared/use-expiring-state";
import { usePushedView } from "@/shared/use-pushed-view";

import { Banners, NotSavedBanner } from "./banners";
import { Composer } from "./composer";
import { ConfirmDialog } from "./confirm-dialog";
import type { ConfirmRequest } from "./confirm-dialog";
import { DetailsView } from "./details-view";
import { liveEdits } from "./drafts";
import { EmptyShelf } from "./empty-shelf";
import { focusRow, ItemRow } from "./item-row";
import { Markdown } from "./markdown";
import { editorWithFocus } from "./markdown-field";
import type { MarkdownFieldHandle } from "./markdown-field";
import { PointerMenu, ShelfMenu } from "./menus";
import type { OpenMenu } from "./menus";
import { QuitPromptDialog } from "./quit-prompt";
import {
  DueSuggestions,
  NoMatches,
  SearchBar,
  withDueFilter,
} from "./search-bar";
import {
  SectionHeader,
  SectionNameField,
  useCollapsedSections,
} from "./section-header";
import {
  rangePick,
  selectionAfterRemoval,
  stepSelection,
  togglePick,
} from "./selection";
import { ShortcutSheet } from "./shortcut-sheet";
import { useDetails } from "./use-details";
import { useItemDrag } from "./use-item-drag";
import { useSearchHighlight } from "./use-search-highlight";
import { isTextField, useShelfKeys } from "./use-shelf-keys";

const api = shelfBridge();

onMenusOpen((open) => {
  api.menuOpen(open);
});

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

/** The menu choices main carries out alone: Settings, and where there is no menu bar, Float on Top and Help. */
type MainChoice = Extract<
  MenuChoice,
  { readonly kind: "openSettings" | "setFloatOnTop" | "openHelp" }
>;

const MAIN_CHOICES = new Set<MenuChoice["kind"]>([
  "openHelp",
  "openSettings",
  "setFloatOnTop",
]);

const isMainChoice = (choice: MenuChoice): choice is MainChoice =>
  MAIN_CHOICES.has(choice.kind);

const chooseInMain = (choice: MainChoice): void => {
  switch (choice.kind) {
    case "openSettings": {
      api.openSettings();
      break;
    }

    case "setFloatOnTop": {
      api.setFloatOnTop(choice.on);
      break;
    }

    case "openHelp": {
      api.openHelp();
      break;
    }

    default: {
      break;
    }
  }
};

/** A text field, or a text selection anywhere, keeps the normal Copy and Undo. */
const ITEM_CHOICES = new Set<MenuChoice["kind"]>([
  "details",
  "copyDetails",
  "copy",
  "copyWithLink",
  "open",
  "openSource",
  "setColor",
  "edit",
  "toggleDone",
  "remove",
  "moveTo",
]);

type ItemChoice = Extract<
  MenuChoice,
  {
    readonly kind:
      | "details"
      | "copyDetails"
      | "copy"
      | "copyWithLink"
      | "open"
      | "openSource"
      | "setColor"
      | "edit"
      | "toggleDone"
      | "remove"
      | "moveTo";
  }
>;

const isItemChoice = (choice: MenuChoice): choice is ItemChoice =>
  ITEM_CHOICES.has(choice.kind);

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
  readonly icon: typeof Cancel01Icon;
} & ComponentProps<typeof Button>) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button aria-label={label} size="icon" variant="ghost" {...props}>
        <HugeiconsIcon icon={icon} />
      </Button>
    </TooltipTrigger>
    <TooltipContent side="bottom">{label}</TooltipContent>
  </Tooltip>
);

/** How long a confirmation toast stays: long enough to read, short enough to forget. */
const NOTICE_MS = 1800;

const noticeToast = (message: string): void => {
  toast.success(message, { duration: NOTICE_MS });
};

const ignoreLink = (): void => undefined;

/** An item's words for a toast: a note formatted as on its card, cut to two lines. */
const Excerpt = ({ item }: { readonly item: ShelfItem }) =>
  item.kind === "text" ? (
    <Markdown
      className="line-clamp-2 break-words"
      interactive={false}
      onOpenLink={ignoreLink}
      text={item.text}
    />
  ) : (
    <span className="line-clamp-2 break-words">{itemText(item)}</span>
  );

const deletedToast = (id: ItemId): string => `deleted-${id}`;

/** Files dropped or pasted in: by path when they have one, else as image bytes (an image copied from a page). */
const addDataFiles = async (files: readonly File[]): Promise<void> => {
  const paths = files.flatMap((file) => {
    const found = filePath(file);

    return found === "" ? [] : [found];
  });

  if (paths.length > 0) {
    const result = await api.addFiles(paths);

    if (result.ok) {
      noticeToast(
        paths.length === 1 ? "Added 1 file" : `Added ${paths.length} files`
      );
    }

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

/**
 * Files can be dropped anywhere on the shelf, or pasted when the clipboard
 * holds files. One of the shelf's own images or files dragged back in is not
 * added again (`ownDrag`).
 */
const useFileDrops = (ownDrag: () => boolean): boolean => {
  const [over, setOver] = useState(false);

  const onDragOver = useEffectEvent((event: DragEvent) => {
    if (hasFiles(event) && !ownDrag()) {
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

    if (hasFiles(event) && !ownDrag()) {
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

/**
 * Ends a text edit still open in a row or in details, so a copy, export or
 * drag that follows takes the words the field shows: the editor saves on
 * blur, before the next message to main.
 */
const flushEdits = (): void => {
  liveEdits.flushAll();

  const active = document.activeElement;

  if (
    active instanceof HTMLElement &&
    active.isContentEditable &&
    active.closest("[data-item-id], [data-details-view]") !== null
  ) {
    active.blur();
  }
};

/** Retry in the banners and on a row; they go once the disk holds every change. True when it did. */
const retrySave = async (): Promise<boolean> => {
  const saved = await api.retrySave();

  if (!saved.ok) {
    toast.error(`Still not saved. ${saved.message}`, { duration: NOTICE_MS });
  }

  return saved.ok;
};

/** How long a refused copy's Retry stays on screen. */
const REFUSED_MS = 8000;

let refusedToast: string | number | undefined;

/**
 * Every copy the shelf asks for goes through here: an edit still open is
 * saved first, main copies only once the disk holds it (src/main/copy-gate.ts),
 * and a copy that couldn't be made says why and shows nothing as copied.
 * One refused because its changes aren't saved offers Retry, which saves;
 * then it can be copied again.
 */
const requestCopy = async (
  send: () => Promise<ActionResult>
): Promise<boolean> => {
  flushEdits();

  const outcome = await send();

  if (outcome.ok) {
    return true;
  }

  if (outcome.retrySave === true) {
    // A new refusal replaces the last one, so they never pile up and each shows as new.
    toast.dismiss(refusedToast);
    refusedToast = toast.error(outcome.message, {
      action: {
        label: "Retry",
        onClick: () => {
          void (async () => {
            if (await retrySave()) {
              noticeToast("Saved. You can copy it now.");
            }
          })();
        },
      },
      duration: REFUSED_MS,
    });
  } else {
    toast.error(outcome.message, { duration: NOTICE_MS });
  }

  return false;
};

/** Several items as one numbered list. */
const copyList = async (list: readonly ShelfItem[]): Promise<void> => {
  if (list.length === 0) {
    return;
  }

  const ids = list.map((item) => item.id);

  if (await requestCopy(async () => await api.copyList(ids))) {
    noticeToast(
      list.length === 1
        ? "Copied as a list"
        : `Copied ${list.length} items as a list`
    );
  }
};

/** Checks them all off, or, when all are done, unchecks them all. */
const toggleMany = (list: readonly ShelfItem[]): void => {
  const done = !list.every((item) => item.done);

  for (const item of list) {
    if (item.done !== done) {
      apply({ id: item.id, type: "toggleDone" });
    }
  }
};

/** What the keys and Copy act on: the picked items, else the open one. */
const chosenItems = (
  pickedItems: readonly ShelfItem[],
  selected: ShelfItem | undefined
): readonly ShelfItem[] => {
  if (pickedItems.length > 0) {
    return pickedItems;
  }

  return selected === undefined ? [] : [selected];
};

const itemCount = (count: number): string =>
  count === 1 ? "1 item" : `${count} items`;

/** Today, kept fresh: the Due chips turn at midnight and when the shelf comes back. */
const useNow = (): Date => {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const tick = (): void => {
      setNow(new Date());
    };

    const timer = setInterval(tick, 60_000);

    window.addEventListener("focus", tick);

    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", tick);
    };
  }, []);

  return now;
};

const PICK_ONE = "Pick one item to see its details";

/** Above the note field, inset like the fields; the shelf is narrower than Sonner's usual toast. In details, at the bottom. */
const ShelfToaster = ({ raised }: { readonly raised: boolean }) => {
  const offset = { bottom: raised ? 52 : 8, left: 8, right: 8 };

  return (
    <Toaster mobileOffset={offset} offset={offset} position="bottom-center" />
  );
};

/** A removal in details that Undo or ⌘Z puts back. */
const undoableToast = (message: string, undo: () => boolean): void => {
  toast(message, {
    action: {
      label: "Undo",
      onClick: () => {
        undo();
      },
    },
    description: `${keyText("CommandOrControl+Z", isMac)} puts it back`,
    duration: UNDO_VISIBLE_MS,
    id: "details-undo",
  });
};

/** Opens a linked window again, or every window of the item when none is given. */
const reopenWindow = (id: ItemId, window?: WindowRef): void => {
  api.reopenWindow(window === undefined ? { id } : { id, windowId: window.id });
};

/** Where focus goes back to when a menu closes: the button that opened it, else the item it belongs to. */
interface MenuReturn {
  readonly opener: HTMLElement | null;
  readonly owner: ItemId | null;
}

/**
 * Puts focus back after a menu has gone, unless a choice or a click already
 * put it somewhere (an editor, details, the search field). The selected item
 * comes first: after ⌫ it is the one after the deleted owner, which may not
 * have left the list yet.
 */
const returnFocus = ({ opener, owner }: MenuReturn): void => {
  const active = document.activeElement;

  if (active !== null && active !== document.body) {
    return;
  }

  if (opener?.isConnected === true && opener.checkVisibility()) {
    opener.focus({ preventScroll: true });

    return;
  }

  if (
    !focusRow(document.querySelector('[data-item-id][aria-current="true"]')) &&
    owner !== null
  ) {
    focusRow(document.querySelector(`[data-item-id="${owner}"]`));
  }
};

/** Discard changes takes back what details could undo. */
const useForgetOnDiscard = (
  discarded: ShelfView["discarded"],
  forget: () => void
): void => {
  const onDiscarded = useEffectEvent(forget);
  const seq = discarded?.seq ?? 0;

  useEffect(() => {
    if (seq > 0) {
      onDiscarded();
    }
  }, [seq]);
};

/** The open item's own "Not saved", when a failed save left its changes unwritten. */
const DetailsNotSaved = ({
  entry,
  onDiscard,
  status,
}: {
  readonly entry: NotSavedItem | undefined;
  readonly status: ShelfStatus;
  readonly onDiscard: () => void;
}) =>
  entry === undefined ? null : (
    <NotSavedBanner
      undo={entry.undo}
      message={status.saveError ?? "The shelf could not be saved to disk."}
      onDiscard={onDiscard}
      onRetry={() => {
        void retrySave();
      }}
    />
  );

const Shelf = ({ view }: { readonly view: ShelfView }) => {
  const { canUndo, doc, focus, status } = view;
  const [query, setQuery] = useState("");
  const now = useNow();
  const [editingId, setEditingId] = useState<ItemId | null>(null);
  // The item being typed in stays shown while its words stop matching the search.
  const groups = groupItems(doc, query, now, editingId);
  const { collapsed, setOpen } = useCollapsedSections();
  // A search shows its matches in folded sections too.
  const searching = query.trim() !== "";
  const isOpen = (id: SectionId): boolean => searching || !collapsed.has(id);

  // A shelf with nothing on it, and no sections made yet, shows how to start instead.
  const firstRun =
    !searching && doc.items.length === 0 && doc.sections.length === 1;

  const items = groups.flatMap((group) =>
    isOpen(group.section.id) ? group.items : []
  );

  // ↑ and ↓ walk the items in the order they are shown, across sections.
  const ids = items.map((item) => item.id);

  const newest = doc.items.findLast(
    (item) => item.sectionId === doc.activeSectionId
  )?.id;

  const searchRef = useRef<HTMLInputElement>(null);

  // Several items picked together (⌘-click, ⇧-click, ⌘A), apart from the one open item.
  const [picked, setPicked] = useState<readonly ItemId[]>([]);
  const [anchorId, setAnchorId] = useState<ItemId | null>(null);

  /** Moves items to the end of a section and says so. */
  const moveItems = (moving: readonly ItemId[], sectionId: SectionId): void => {
    const name = doc.sections.find((section) => section.id === sectionId)?.name;

    const count = moving.filter(
      (id) => doc.items.find((item) => item.id === id)?.sectionId !== sectionId
    ).length;

    for (const id of moving) {
      apply({ id, sectionId, type: "moveItem" });
    }

    if (count > 0 && name !== undefined) {
      noticeToast(
        count === 1 ? `Moved to ${name}` : `Moved ${count} items to ${name}`
      );
    }
  };

  /** A picked card takes the other picks along. */
  const carriedWith = (id: ItemId): readonly ItemId[] =>
    picked.includes(id) ? picked : [id];

  // A card dropped on a section moves there, to its end.
  const drag = useItemDrag({
    canMove: (id, sectionId) => {
      const dragged = doc.items.find((item) => item.id === id);

      return (
        dragged !== undefined &&
        carriedWith(dragged.id).some(
          (other) =>
            doc.items.find((item) => item.id === other)?.sectionId !== sectionId
        )
      );
    },
    move: (id, sectionId) => {
      const moved = doc.items.find((item) => item.id === id);

      if (moved !== undefined) {
        moveItems(carriedWith(moved.id), sectionId);
      }
    },
  });

  const dropping = useFileDrops(drag.draggingOut);

  const sectionName =
    doc.sections.find((section) => section.id === doc.activeSectionId)?.name ??
    "";

  const [selectedId, setSelectedId] = useState<ItemId | null>(null);
  const [draft, setDraft] = useState("");
  const [handledFocus, setHandledFocus] = useState(0);
  const [copiedId, setCopiedId] = useExpiringState<ItemId>(COPIED_MS);
  // The deletions shown as toasts, newest last, so ⌘Z can close the one it undoes.
  const [deletions, setDeletions] = useState<readonly ItemId[]>([]);
  const [openMenu, setOpenMenu] = useState<OpenMenu | null>(null);
  // A ref: the menu reports it has closed after its fade, long after the render that opened it.
  const menuReturn = useRef<MenuReturn>({ opener: null, owner: null });

  /**
   * Opens a menu at an anchor. A button that opened it (⋯) gets focus back
   * when it closes; a right-click gives it to the item the menu belongs to.
   */
  const showMenu = (menu: OpenMenu, owner: ItemId | null = null): void => {
    const active = document.activeElement;

    menuReturn.current = {
      opener: menu.width > 0 && active instanceof HTMLElement ? active : null,
      owner,
    };
    setOpenMenu(menu);
  };

  const [renamingId, setRenamingId] = useState<SectionId | null>(null);
  const [confirming, setConfirming] = useState<ConfirmRequest | null>(null);
  const [namingSection, setNamingSection] = useState(false);
  const composerRef = useRef<MarkdownFieldHandle>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Level 2: the item whose details are pushed over the list.
  const details = useDetails({ apply, doc, listRef });
  const detailsItem = details.item;
  const inDetails = detailsItem !== undefined;
  const [sheetOpen, setSheetOpen] = useState(false);

  useSearchHighlight(listRef, query);

  const notSaved = new Map(view.notSaved.map((entry) => [entry.id, entry]));

  useForgetOnDiscard(view.discarded, details.forgetUndo);

  const countOf = (sectionId: SectionId, done: boolean | null): number =>
    doc.items.filter(
      (item) =>
        item.sectionId === sectionId && (done === null || item.done === done)
    ).length;

  /** Checked items go for good, so the shelf asks first. */
  const clearDone = (sectionId: SectionId): void => {
    const count = countOf(sectionId, true);
    const name = doc.sections.find((section) => section.id === sectionId)?.name;

    if (count === 0) {
      return;
    }

    setConfirming({
      action: "Clear",
      description: `${itemCount(count)} checked off in ${name ?? "this section"} will be deleted. This can’t be undone.`,
      run: () => {
        apply({ sectionId, type: "clearDone" });
        noticeToast(`Cleared ${itemCount(count)}`);
      },
      title: "Clear checked items?",
    });
  };

  /** An empty section goes at once; one with items asks first. */
  const removeSection = (sectionId: SectionId): void => {
    const count = countOf(sectionId, null);
    const name = doc.sections.find((section) => section.id === sectionId)?.name;

    if (count === 0) {
      apply({ id: sectionId, type: "removeSection" });

      return;
    }

    setConfirming({
      action: "Delete",
      description: `Its ${itemCount(count)} will be deleted too. This can’t be undone.`,
      run: () => {
        apply({ id: sectionId, type: "removeSection" });
      },
      title: `Delete “${name ?? "section"}”?`,
    });
  };

  // A capture asks main to show its item: open its section, select it, and open an image's note for typing.
  if (focus !== null && focus.seq !== handledFocus) {
    const shown = doc.items.find((item) => item.id === focus.id);
    const kind = shown?.kind;

    if (shown !== undefined) {
      setOpen(shown.sectionId, true);
    }

    setHandledFocus(focus.seq);
    setSelectedId(focus.id);
    setEditingId(kind === "image" || focus.edit === true ? focus.id : null);
    details.close();
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
  const pickedItems = items.filter((item) => picked.includes(item.id));

  const chosen = chosenItems(pickedItems, selected);

  const openDetails = (id: ItemId, field?: DetailField): void => {
    setPicked([]);
    setSelectedId(id);
    setEditingId(null);
    details.open(id, field);
  };

  const closeDetails = (): void => {
    setEditingId(null);
    details.close();
  };

  /** → and the field shortcuts: details for the one selected item; several picked get a hint. */
  const detailsFor = (field?: DetailField): void => {
    if (inDetails) {
      if (field !== undefined) {
        details.requestField(field);
      }
    } else if (pickedItems.length > 1) {
      toast(PICK_ONE, { duration: NOTICE_MS, id: "pick-one" });
    } else if (selected !== undefined) {
      openDetails(selected.id, field);
    } else if (field !== undefined) {
      toast("Select an item first", { duration: NOTICE_MS, id: "pick-one" });
    }
  };

  const unpick = (): void => {
    setPicked([]);
  };

  /** ⇧⌘C: the picked items, else the open items of the section new items go to. */
  const copyAsList = (): void => {
    void copyList(
      chosen.length > 0
        ? chosen
        : doc.items.filter(
            (item) => item.sectionId === doc.activeSectionId && !item.done
          )
    );
  };

  /** Picks one item with ⌘-click or a range with ⇧-click; the open item closes. */
  const pick = (id: ItemId, mode: "toggle" | "range"): void => {
    const field = document.activeElement;

    if (field instanceof HTMLElement && isTextField(field)) {
      field.blur();
    }

    setEditingId(null);

    if (mode === "range") {
      setPicked(rangePick(ids, anchorId ?? selectedId, id));
    } else {
      setPicked(togglePick(ids, picked, selectedId, id));
      setAnchorId(id);
    }

    setSelectedId(null);
  };

  const copy = async (id: ItemId): Promise<void> => {
    if (await requestCopy(async () => await api.copy(id))) {
      setCopiedId(id);
    }
  };

  /** ⌥⌘C and Copy with Link: the item as text, with its link or every detail. */
  const copyAsText = async (
    id: ItemId,
    kind: "copyDetails" | "copyWithLink"
  ): Promise<void> => {
    if (await requestCopy(async () => await api[kind](id))) {
      setCopiedId(id);

      if (kind === "copyDetails") {
        noticeToast("Copied with details");
      }
    }
  };

  /** Puts back one deleted item and closes its toast. */
  const restore = (id: ItemId): void => {
    apply({ id, type: "undoRemove" });
    setDeletions((current) => current.filter((other) => other !== id));
    toast.dismiss(deletedToast(id));
  };

  /** Each deletion gets its own toast, and its Undo puts back that item. */
  const remove = (id: ItemId): void => {
    const item = doc.items.find((candidate) => candidate.id === id);

    setSelectedId(selectionAfterRemoval(ids, [id]));
    setEditingId(null);
    apply({ id, type: "remove" });
    setDeletions((current) => [...current, id].slice(-UNDO_MAX));

    toast("Deleted", {
      action: {
        label: "Undo",
        onClick: () => {
          restore(id);
        },
      },
      description: item === undefined ? undefined : <Excerpt item={item} />,
      duration: UNDO_VISIBLE_MS,
      id: deletedToast(id),
      onAutoClose: () => {
        setDeletions((current) => current.filter((other) => other !== id));
      },
    });
  };

  /** Deletes several at once, with one Undo for all; past the undo limit it asks first, as they go for good. */
  const removeMany = (list: readonly ItemId[]): void => {
    const run = (): void => {
      unpick();
      // The next item still shown takes the selection, and with it the focus a closing menu gives back.
      setSelectedId(selectionAfterRemoval(ids, list));
      setEditingId(null);

      for (const id of list) {
        apply({ id, type: "remove" });
      }

      if (list.length > UNDO_MAX) {
        return;
      }

      setDeletions((current) => [...current, ...list].slice(-UNDO_MAX));

      toast(`Deleted ${list.length} items`, {
        action: {
          label: "Undo",
          onClick: () => {
            for (const id of list) {
              apply({ id, type: "undoRemove" });
            }

            setDeletions((current) =>
              current.filter((other) => !list.includes(other))
            );
          },
        },
        duration: UNDO_VISIBLE_MS,
      });
    };

    if (list.length <= UNDO_MAX) {
      run();

      return;
    }

    setConfirming({
      action: "Delete",
      description: `${itemCount(list.length)} will be deleted. This can’t be undone.`,
      run,
      title: `Delete ${list.length} items?`,
    });
  };

  /** Discard changes on an item a failed save left unwritten; one the disk never held is deleted, with Undo. */
  const discardChanges = (id: ItemId): void => {
    const undo = notSaved.get(id)?.undo;

    if (undo === undefined || undo === null) {
      return;
    }

    // Words still being typed into the item go with the rest of its changes, and its field closes on the saved words.
    liveEdits.drop(id);

    if (undo === "discard") {
      api.discardChanges(id);
      noticeToast("Changes discarded");
    } else {
      remove(id);
    }

    if (editingId === id) {
      setEditingId(null);
    }
  };

  /** ⌘Z: the last deletion comes back. */
  const undo = (): void => {
    const last = deletions.at(-1);

    if (last === undefined) {
      apply({ type: "undoRemove" });
    } else {
      restore(last);
    }
  };

  /** ⌥⌘↑ and ⌥⌘↓: the item goes to the end of the section above or below, which opens to show it. */
  const moveToNeighbour = (id: ItemId, offset: 1 | -1): void => {
    const item = doc.items.find((candidate) => candidate.id === id);

    const index = doc.sections.findIndex(
      (section) => section.id === item?.sectionId
    );

    const target = doc.sections[index + offset];

    if (item === undefined || target === undefined) {
      return;
    }

    setOpen(target.id, true);
    apply({ id, sectionId: target.id, type: "moveItem" });
    reveal(id);
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

  /** A key acts on all picked items when there are several, else on the open one. */
  const onChosen = (
    one: (id: ItemId) => void,
    many: (list: readonly ShelfItem[]) => void
  ): (() => void) | null =>
    pickedItems.length > 1
      ? () => {
          many(pickedItems);
        }
      : onSelected(one);

  const listKeys = {
    edit: onSelected(setEditingId),
    forward: () => {
      detailsFor();
    },
    // Escape, layered: open menus and fields close themselves first, then details go back, then picks let go, then the shelf hides.
    hide: () => {
      if (inDetails) {
        closeDetails();
      } else if (picked.length > 0) {
        unpick();
      } else {
        api.hide();
      }
    },
    move: (offset: 1 | -1) => {
      unpick();

      const next = stepSelection(ids, selectedId, offset);

      if (next === null) {
        focusComposer();
      } else {
        selectItem(next);
      }
    },
    remove: onChosen(remove, (list) => {
      removeMany(list.map((item) => item.id));
    }),
    startNote: focusComposer,
    toggleDone: onChosen((id) => {
      apply({ id, type: "toggleDone" });
    }, toggleMany),
  };

  useShelfKeys({ ...listKeys, back: closeDetails }, inDetails);

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
    unpick();

    if (
      document.activeElement instanceof HTMLElement &&
      isTextField(document.activeElement) &&
      document.activeElement !== composerRef.current?.element()
    ) {
      document.activeElement.blur();
    }
  };

  /** A choice in an item's menu. */
  const chooseForItem = (choice: ItemChoice): void => {
    flushEdits();

    switch (choice.kind) {
      case "details": {
        openDetails(choice.id);
        break;
      }

      case "copyDetails":
      case "copyWithLink": {
        void copyAsText(choice.id, choice.kind);
        break;
      }

      case "copy": {
        void copy(choice.id);
        break;
      }

      case "open": {
        api.openImage(choice.id);
        break;
      }

      case "openSource": {
        api.openLink({ id: choice.id });
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
        moveItems([choice.id], choice.sectionId);
        break;
      }

      default: {
        break;
      }
    }
  };

  const choose = (choice: MenuChoice): void => {
    if (isMainChoice(choice)) {
      chooseInMain(choice);

      return;
    }

    if (isItemChoice(choice)) {
      chooseForItem(choice);

      return;
    }

    switch (choice.kind) {
      case "selectSection": {
        apply({ id: choice.id, type: "selectSection" });
        break;
      }

      case "clearDone": {
        clearDone(choice.sectionId);
        break;
      }

      case "renameSection": {
        setRenamingId(choice.id);
        break;
      }

      case "removeSection": {
        removeSection(choice.id);
        break;
      }

      case "newSection": {
        closeDetails();
        setNamingSection(true);
        break;
      }

      case "newWindowLink": {
        api.newWindowLink();
        break;
      }

      case "shortcuts": {
        setSheetOpen(true);
        break;
      }

      case "copyList": {
        void copyList(doc.items.filter((item) => choice.ids.includes(item.id)));
        break;
      }

      case "toggleMany": {
        toggleMany(doc.items.filter((item) => choice.ids.includes(item.id)));
        break;
      }

      case "moveMany": {
        moveItems(choice.ids, choice.sectionId);
        break;
      }

      case "removeMany": {
        removeMany(choice.ids);
        break;
      }

      default: {
        break;
      }
    }
  };

  /** The menu bar's Item menu, on the selected item; a text field keeps ⌥⌘C to itself. */
  const onItemAction = (action: ItemAction): void => {
    if (action === "copyList") {
      copyAsList();

      return;
    }

    if (
      selected === undefined ||
      ((action === "copyWithLink" || action === "copyDetails") &&
        inTextContext())
    ) {
      if (selected === undefined && pickedItems.length > 1) {
        toast(PICK_ONE, { duration: NOTICE_MS, id: "pick-one" });
      }

      return;
    }

    const { id } = selected;

    flushEdits();

    switch (action) {
      case "copyDetails":
      case "copyWithLink": {
        void copyAsText(id, action);
        break;
      }

      case "open": {
        if (selected.kind === "image") {
          api.openImage(id);
        } else {
          api.openLink({ id });
        }

        break;
      }

      case "edit": {
        setEditingId(id);
        break;
      }

      case "details": {
        detailsFor();
        break;
      }

      case "linkWindow": {
        api.linkWindows(id);
        break;
      }

      case "toggleDone": {
        apply({ id, type: "toggleDone" });
        break;
      }

      case "previousSection":
      case "nextSection": {
        moveToNeighbour(id, action === "nextSection" ? 1 : -1);
        break;
      }

      case "remove": {
        remove(id);
        break;
      }

      default: {
        break;
      }
    }
  };

  /** ⌘Z: a note field's own history, another field's native one, a removal in details, else the last deletion. */
  const undoCommand = (): void => {
    const field = editorWithFocus();

    // Right after a step was removed, ⌘Z in the steps brings it back (details-view.tsx).
    const stepRemoved =
      document.activeElement?.closest<HTMLElement>("[data-step-removed]") ??
      null;

    if (field !== null) {
      field.commands.undo();
    } else if (stepRemoved !== null && details.undo()) {
      delete stepRemoved.dataset.stepRemoved;
      noticeToast("Put back");
    } else if (inTextContext()) {
      api.nativeEdit("undo");
    } else if (details.undo()) {
      noticeToast("Put back");
    } else if (canUndo && !inDetails) {
      undo();
    }
  };

  /** Copy, Redo and Select All: a text field's own, else the shelf's. */
  const editCommand = (kind: "copy" | "redo" | "selectAll"): void => {
    const field = editorWithFocus();

    if (kind === "redo") {
      if (field === null) {
        api.nativeEdit("redo");
      } else {
        field.commands.redo();
      }
    } else if (inTextContext()) {
      api.nativeEdit(kind);
    } else if (kind === "selectAll") {
      // Every item shown in the list; details have nothing to pick.
      if (!inDetails) {
        setSelectedId(null);
        setEditingId(null);
        setPicked(ids);
      }
    } else if (pickedItems.length > 1) {
      void copyList(pickedItems);
    } else if (selected !== undefined) {
      void copy(selected.id);
    }
  };

  const onCommand = useEffectEvent((command: ShelfCommand) => {
    // The quit prompt holds the shelf: a menu bar choice or a key main answered can't open or change anything behind it (Round 8).
    if (status.quitPrompt !== null) {
      return;
    }

    // A menu key main answered (Windows), or a menu bar choice: an open menu is done with.
    setOpenMenu(null);

    switch (command.kind) {
      case "item": {
        onItemAction(command.action);
        break;
      }

      case "clearDone": {
        clearDone(doc.activeSectionId);
        break;
      }

      case "find": {
        closeDetails();
        requestAnimationFrame(() => {
          searchRef.current?.focus();
          searchRef.current?.select();
        });
        break;
      }

      case "field": {
        detailsFor(command.field);
        break;
      }

      case "shortcuts": {
        setSheetOpen(true);
        break;
      }

      case "newNote": {
        closeDetails();
        requestAnimationFrame(focusComposer);
        break;
      }

      case "newSection": {
        closeDetails();
        setNamingSection(true);
        break;
      }

      case "undo": {
        undoCommand();
        break;
      }

      case "copy":
      case "redo":
      case "selectAll": {
        editCommand(command.kind);
        break;
      }

      default: {
        break;
      }
    }
  });

  useEffect(() => api.on("command", onCommand), []);

  useEffect(
    () =>
      api.on("notice", ({ message, tone }) => {
        if (tone === "failed") {
          toast.error(message, { duration: NOTICE_MS });
        } else {
          noticeToast(message);
        }
      }),
    []
  );

  // Coming forward, the shelf is ready for a note, unless something else is
  // under way: a note or item being edited, or a search with words in it.
  const onWindowFocus = useEffectEvent(() => {
    const active = document.activeElement;

    const idle =
      active === null ||
      active === document.body ||
      (active === searchRef.current && query === "");

    if (idle && editingId === null) {
      composerRef.current?.focus();
    }
  });

  useEffect(() => {
    window.addEventListener("focus", onWindowFocus);

    if (document.hasFocus()) {
      onWindowFocus();
    }

    return () => {
      window.removeEventListener("focus", onWindowFocus);
    };
  }, []);

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
      (key !== "a" && key !== "c" && key !== "z") ||
      inTextContext()
    ) {
      return;
    }

    event.preventDefault();

    const kinds = { a: "selectAll", c: "copy", z: "undo" } as const;

    onCommand({ kind: kinds[key] });
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
      <h1 className="sr-only">Inset Shelf</h1>
      {detailsItem === undefined ? null : (
        <DetailsView
          banner={
            <DetailsNotSaved
              entry={notSaved.get(detailsItem.id)}
              onDiscard={() => {
                discardChanges(detailsItem.id);
              }}
              status={status}
            />
          }
          discarded={view.discarded}
          editing={editingId === detailsItem.id}
          item={detailsItem}
          key={detailsItem.id}
          now={now}
          onApply={apply}
          onBack={closeDetails}
          onEdit={() => {
            setEditingId(detailsItem.id);
          }}
          onHide={() => {
            api.hide();
          }}
          onLinkWindow={() => {
            api.linkWindows(detailsItem.id);
          }}
          onMenu={(anchor) => {
            showMenu(
              { ...anchor, target: { id: detailsItem.id, kind: "item" } },
              detailsItem.id
            );
          }}
          onOpenImage={() => {
            api.openImage(detailsItem.id);
          }}
          onOpenPins={() => {
            api.openPins(detailsItem.id);
          }}
          onOpenLink={(url) => {
            api.openLink({ id: detailsItem.id, url });
          }}
          onReopenWindow={(window) => {
            reopenWindow(detailsItem.id, window);
          }}
          onStopEditing={() => {
            setEditingId(null);
          }}
          onUndo={() => details.undo()}
          onUndoable={(entry) => {
            details.pushUndo(entry);

            // A label edit shows as it is typed; only removals need a toast to undo them.
            if (entry.kind !== "pinLabel") {
              undoableToast(
                entry.kind === "step" ? "Step removed" : "Window removed",
                details.undo
              );
            }
          }}
          request={details.request}
          stepsReset={details.stepsReset}
        />
      )}
      <div className="flex min-h-0 flex-1 flex-col" hidden={inDetails}>
        <header className="drag-region flex h-12 shrink-0 items-center gap-1 px-2">
          <SearchBar
            inputRef={searchRef}
            onChange={setQuery}
            onHide={() => {
              api.hide();
            }}
            query={query}
          />
          <ShelfMenu floatOnTop={status.floatOnTop} onChoose={choose}>
            <HeaderButton icon={MoreHorizontalIcon} label="More" />
          </ShelfMenu>
          <HeaderButton
            icon={Cancel01Icon}
            label="Hide Shelf"
            onClick={() => {
              api.hide();
            }}
          />
        </header>
        <Banners
          onDismissProblem={() => {
            api.dismissProblem();
          }}
          onOpenKeySettings={() => {
            api.openKeySettings();
          }}
          onRetrySave={() => {
            void retrySave();
          }}
          status={status}
        />
        <div
          className="shelf-list min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-1 pl-2"
          ref={listRef}
          onContextMenu={(event) => {
            // Items and section headings open their own menus.
            if (!event.defaultPrevented) {
              event.preventDefault();
              showMenu({
                align: "start",
                height: 0,
                target: { kind: "shelf" },
                width: 0,
                x: event.clientX,
                y: event.clientY,
              });
            }
          }}
          onPointerDown={onListPointerDown}
        >
          <DueSuggestions
            onChoose={(filter) => {
              setQuery(withDueFilter(query, filter));
              searchRef.current?.focus();
            }}
            query={query}
          />
          {groups.length === 0 && parseSearch(query).pendingDue === null ? (
            <NoMatches
              onClear={() => {
                setQuery("");
                searchRef.current?.focus();
              }}
              query={query}
            />
          ) : null}
          {firstRun ? <EmptyShelf /> : null}
          {(firstRun ? [] : groups).map((group) => {
            const open = isOpen(group.section.id);

            return (
              <section
                aria-label={group.section.name}
                className={cn(
                  "rounded-lg pb-1 transition-colors",
                  drag.overSectionId === group.section.id &&
                    "bg-pin/10 ring-pin/60 ring-1 ring-inset"
                )}
                key={group.section.id}
                {...drag.sectionProps(group.section.id)}
              >
                <SectionHeader
                  active={group.active}
                  collapsed={!open}
                  onMakeActive={() => {
                    apply({ id: group.section.id, type: "selectSection" });
                  }}
                  onOpenMenu={(anchor) => {
                    showMenu({
                      ...anchor,
                      target: { id: group.section.id, kind: "section" },
                    });
                  }}
                  onRename={(name) => {
                    apply({
                      id: group.section.id,
                      name,
                      type: "renameSection",
                    });
                  }}
                  onStopRenaming={() => {
                    setRenamingId(null);
                  }}
                  onToggle={() => {
                    setOpen(group.section.id, !open);
                  }}
                  renaming={renamingId === group.section.id}
                  section={group.section}
                />
                {open && group.items.length === 0 ? (
                  <p className="text-muted-foreground px-2 pb-1 text-xs">
                    Nothing here yet
                  </p>
                ) : null}
                {open ? (
                  <ul className="flex flex-col gap-1.5">
                    {group.items.map((item) => (
                      <ItemRow
                        copied={copiedId === item.id}
                        dragProps={drag.itemProps(item.id, itemText(item))}
                        dragging={drag.draggingId === item.id}
                        onPick={(mode) => {
                          pick(item.id, mode);
                        }}
                        picked={picked.includes(item.id)}
                        editing={editingId === item.id}
                        item={item}
                        key={item.id}
                        onContextMenu={(anchor) => {
                          // On one of several picked items, the menu acts on all of them.
                          const several =
                            picked.length > 1 && picked.includes(item.id);

                          showMenu(
                            {
                              ...anchor,
                              target: several
                                ? { ids: picked, kind: "items" }
                                : { id: item.id, kind: "item" },
                            },
                            item.id
                          );

                          // The menu takes the keyboard; a field keeping focus behind it would be hidden from assistive technology.
                          if (document.activeElement instanceof HTMLElement) {
                            document.activeElement.blur();
                          }

                          if (!several) {
                            unpick();
                            setSelectedId(item.id);
                          }
                        }}
                        onDragImage={() => {
                          flushEdits();
                          drag.startDragOut(item.id);
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
                        onOpenLink={(url) => {
                          api.openLink({ id: item.id, url });
                        }}
                        onHide={() => {
                          api.hide();
                        }}
                        onEditText={(text) => {
                          apply({ id: item.id, text, type: "editText" });
                        }}
                        onSelect={() => {
                          // Picking another item ends editing elsewhere, so Copy and the list keys act on the pick.
                          if (editingId !== item.id) {
                            setEditingId(null);

                            const field = document.activeElement;

                            if (
                              field instanceof HTMLElement &&
                              isTextField(field)
                            ) {
                              field.blur();
                            }
                          }

                          unpick();
                          setAnchorId(item.id);
                          setSelectedId(item.id);
                        }}
                        onStopEditing={() => {
                          setEditingId(null);
                        }}
                        onToggle={() => {
                          apply({ id: item.id, type: "toggleDone" });
                        }}
                        onToggleStep={(step) => {
                          apply({
                            id: item.id,
                            stepId: step.id,
                            type: "toggleStep",
                          });
                        }}
                        onReopenWindow={(window) => {
                          reopenWindow(item.id, window);
                        }}
                        onShowDetails={() => {
                          openDetails(item.id);
                        }}
                        notSaved={notSaved.get(item.id)}
                        onDiscardChanges={() => {
                          discardChanges(item.id);
                        }}
                        onRetrySave={() => {
                          void retrySave();
                        }}
                        now={now}
                        selected={selectedId === item.id}
                      />
                    ))}
                  </ul>
                ) : null}
              </section>
            );
          })}
          {namingSection ? (
            <div className="flex h-9 items-center pt-1">
              <SectionNameField
                initial=""
                label="New section name"
                onCancel={() => {
                  setNamingSection(false);
                }}
                onSave={(name) => {
                  apply({ name, type: "addSection" });
                  setNamingSection(false);
                }}
              />
            </div>
          ) : null}
        </div>
      </div>
      <PointerMenu
        doc={doc}
        floatOnTop={status.floatOnTop}
        menu={openMenu}
        onChoose={choose}
        onClose={() => {
          setOpenMenu(null);
        }}
        onClosed={() => {
          returnFocus(menuReturn.current);
        }}
      />
      <ConfirmDialog
        onClose={() => {
          setConfirming(null);
        }}
        request={confirming}
      />
      <QuitPromptDialog
        onAnswer={(answer) => {
          api.answerQuit(answer);
        }}
        prompt={status.quitPrompt}
      />
      <ShortcutSheet onOpenChange={setSheetOpen} open={sheetOpen} />
      <ShelfToaster raised={!inDetails} />
      <Composer
        addActions={{
          attachFiles: () => {
            api.attachFiles();
          },
          newDrawing: () => {
            api.newDrawing();
          },
          newWindowLink: () => {
            api.newWindowLink();
          },
        }}
        hidden={inDetails}
        sectionNames={doc.sections.map((section) => section.name)}
        onEscape={() => {
          api.hide();
        }}
        onLeaveUp={() => {
          // The item just above the note field: the last one shown, past folded sections.
          const last = ids.at(-1);

          if (last !== undefined) {
            selectItem(last);
          }
        }}
        onSubmit={(text) => {
          // A note lands in the section new items go to, which opens to show it.
          setOpen(doc.activeSectionId, true);
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

import { itemText } from "@shared/shelf";
import type { ItemId, ShelfItem, Step, WindowRef } from "@shared/shelf";
import { useLayoutEffect, useMemo, useRef } from "react";
import type { DragEvent } from "react";

import type { AttachmentHandlers } from "./attachment-strip";
import type { RowHandlers } from "./item-row";
import type { MenuAnchor } from "./menus";
import type { RowDropProps } from "./use-attach-drop";
import type { ItemDrag } from "./use-item-drag";

/**
 * What every row can ask of the shelf, by the item's id. One object for the
 * whole list that keeps its identity across renders and always runs the
 * latest render's code, so a row re-renders only when its own data changes
 * (item-row.tsx memoises it on that).
 */
export interface RowActions {
  readonly attachments: (id: ItemId) => AttachmentHandlers;
  readonly contextMenu: (id: ItemId, anchor: MenuAnchor) => void;
  readonly discardChanges: (id: ItemId) => void;
  readonly dragImage: (id: ItemId) => void;
  readonly dragProps: (
    id: ItemId,
    text: string
  ) => ReturnType<ItemDrag["itemProps"]>;
  readonly dropProps: (item: ShelfItem, open: boolean) => Partial<RowDropProps>;
  readonly edit: (id: ItemId) => void;
  readonly editNote: (id: ItemId, note: string) => void;
  readonly editText: (id: ItemId, text: string) => void;
  readonly hide: () => void;
  readonly open: (id: ItemId) => void;
  readonly openLink: (id: ItemId, url?: string) => void;
  readonly pick: (id: ItemId, mode: "toggle" | "range") => void;
  readonly reopenWindow: (id: ItemId, window: WindowRef) => void;
  readonly retrySave: () => void;
  readonly select: (id: ItemId) => void;
  readonly showDetails: (id: ItemId) => void;
  readonly stopEditing: () => void;
  readonly toggle: (id: ItemId) => void;
  readonly toggleStep: (id: ItemId, step: Step) => void;
}

/** `actions` as one object that never changes, whose every call runs the latest `actions`. */
export const useRowActions = (actions: RowActions): RowActions => {
  const latest = useRef(actions);

  useLayoutEffect(() => {
    latest.current = actions;
  });

  return useMemo(
    (): RowActions => ({
      attachments: (id) => latest.current.attachments(id),
      contextMenu: (id, anchor) => {
        latest.current.contextMenu(id, anchor);
      },
      discardChanges: (id) => {
        latest.current.discardChanges(id);
      },
      dragImage: (id) => {
        latest.current.dragImage(id);
      },
      dragProps: (id, text) => latest.current.dragProps(id, text),
      dropProps: (item, open) => latest.current.dropProps(item, open),
      edit: (id) => {
        latest.current.edit(id);
      },
      editNote: (id, note) => {
        latest.current.editNote(id, note);
      },
      editText: (id, text) => {
        latest.current.editText(id, text);
      },
      hide: () => {
        latest.current.hide();
      },
      open: (id) => {
        latest.current.open(id);
      },
      openLink: (id, url) => {
        latest.current.openLink(id, url);
      },
      pick: (id, mode) => {
        latest.current.pick(id, mode);
      },
      reopenWindow: (id, window) => {
        latest.current.reopenWindow(id, window);
      },
      retrySave: () => {
        latest.current.retrySave();
      },
      select: (id) => {
        latest.current.select(id);
      },
      showDetails: (id) => {
        latest.current.showDetails(id);
      },
      stopEditing: () => {
        latest.current.stopEditing();
      },
      toggle: (id) => {
        latest.current.toggle(id);
      },
      toggleStep: (id, step) => {
        latest.current.toggleStep(id, step);
      },
    }),
    []
  );
};

/** A drop handler that asks the row's drop props at the moment of the event, so they are never a render old. */
const dropHandler =
  (
    actions: RowActions,
    item: ShelfItem,
    name: keyof RowDropProps
  ): ((event: DragEvent) => void) =>
  (event) => {
    actions.dropProps(item, true)[name]?.(event);
  };

/**
 * One row's handlers, bound to its item: what the row hands its parts. Each
 * calls through `actions` when it runs, so the same handlers serve every
 * render of the row.
 */
export const bindRow = (
  actions: RowActions,
  item: ShelfItem,
  open: boolean
): RowHandlers & {
  readonly dragProps: ReturnType<ItemDrag["itemProps"]>;
  readonly dropProps: Partial<RowDropProps>;
  readonly onPick: (mode: "toggle" | "range") => void;
} => {
  const { id } = item;

  return {
    attachments: {
      dragOut: (attachment) => {
        actions.attachments(id).dragOut(attachment);
      },
      open: (attachment, pins) => {
        actions.attachments(id).open(attachment, pins);
      },
    },
    dragProps: {
      draggable: true,
      onDragEnd: () => {
        actions.dragProps(id, itemText(item)).onDragEnd();
      },
      onDragStart: (event) => {
        actions.dragProps(id, itemText(item)).onDragStart(event);
      },
    },
    // Only the open row takes files; the others pass them to the shelf.
    dropProps: open
      ? {
          onDragLeave: dropHandler(actions, item, "onDragLeave"),
          onDragOver: dropHandler(actions, item, "onDragOver"),
          onDrop: dropHandler(actions, item, "onDrop"),
        }
      : {},
    onContextMenu: (anchor) => {
      actions.contextMenu(id, anchor);
    },
    onDiscardChanges: () => {
      actions.discardChanges(id);
    },
    onDragImage: () => {
      actions.dragImage(id);
    },
    onEdit: () => {
      actions.edit(id);
    },
    onEditNote: (note) => {
      actions.editNote(id, note);
    },
    onEditText: (text) => {
      actions.editText(id, text);
    },
    onHide: () => {
      actions.hide();
    },
    onOpen: () => {
      actions.open(id);
    },
    onOpenLink: (url) => {
      actions.openLink(id, url);
    },
    onPick: (mode) => {
      actions.pick(id, mode);
    },
    onReopenWindow: (window) => {
      actions.reopenWindow(id, window);
    },
    onRetrySave: () => {
      actions.retrySave();
    },
    onSelect: () => {
      actions.select(id);
    },
    onShowDetails: () => {
      actions.showDetails(id);
    },
    onStopEditing: () => {
      actions.stopEditing();
    },
    onToggle: () => {
      actions.toggle(id);
    },
    onToggleStep: (step) => {
      actions.toggleStep(id, step);
    },
  };
};

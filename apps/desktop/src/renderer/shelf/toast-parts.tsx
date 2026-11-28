import { itemText } from "@shared/shelf";
import type { ShelfItem } from "@shared/shelf";

import { Markdown } from "./markdown";

// What the shelf's toasts share (shelf-app.tsx, attach-files.tsx): how long they stay, and an item's words under them.

/** How long a confirmation toast stays: long enough to read, short enough to forget. */
export const NOTICE_MS = 1800;

/** How long a toast with Undo stays. */
export const UNDO_VISIBLE_MS = 6000;

const ignoreLink = (): void => undefined;

/** An item's words for a toast: a note formatted as on its card, cut to one line. */
export const Excerpt = ({ item }: { readonly item: ShelfItem }) =>
  item.kind === "text" ? (
    <Markdown
      className="line-clamp-1 break-words"
      interactive={false}
      onOpenLink={ignoreLink}
      text={item.text}
    />
  ) : (
    <span className="line-clamp-1 break-words">{itemText(item)}</span>
  );

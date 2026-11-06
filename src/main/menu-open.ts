import type {
  BaseWindow,
  KeyboardEvent,
  MenuItem,
  MenuItemConstructorOptions,
} from "electron";

import { menuEntryForKey } from "./menu-keys";
import type { KeyInput, MenuNode } from "./menu-keys";

/**
 * Round 6: which pages have a menu open. While one does, main runs none of
 * the app's shortcuts for it, and the page's menu takes the keys
 * (src/renderer/lib/menu-keys.ts). The page says when its first menu opens
 * and its last one closes. A page that loses its window's focus, navigates,
 * reloads, crashes or is destroyed may never say its menu closed, so main
 * forgets the menu then too; the page says again if the menu is still open
 * when its window comes back.
 */

/** Something that fires events: a page (Electron's WebContents) or its window. */
export interface Emitter {
  // oxlint-disable-next-line typescript/method-signature-style -- Electron's on() has one overload per event, which only a method signature (compared bivariantly) accepts.
  on(event: string, listener: () => void): void;
}

/** What the tracker needs of a page: Electron's WebContents has it all. */
export interface MenuPage extends Emitter {
  readonly isDestroyed: () => boolean;
  readonly setIgnoreMenuShortcuts: (ignore: boolean) => void;
}

/** The page events after which a menu that was open can't say it closed. */
const PAGE_ENDS = [
  "did-navigate",
  "did-start-loading",
  "render-process-gone",
  "destroyed",
] as const;

export interface MenuOpenTracker<Page extends MenuPage> {
  /** The page says a menu opened (true) or its last one closed. */
  readonly set: (page: Page, open: boolean) => void;
  readonly isOpen: (page: Page | null) => boolean;
  /** Forgets the page's menu each time its window loses focus or the page ends. */
  readonly watch: (page: Page, window: Emitter) => void;
}

export const createMenuOpenTracker = <
  Page extends MenuPage,
>(): MenuOpenTracker<Page> => {
  const open = new WeakSet<Page>();

  const set = (page: Page, isOpen: boolean): void => {
    if (isOpen) {
      open.add(page);
    } else {
      open.delete(page);
    }

    // On macOS the menu bar's keys then reach the page's menu instead.
    if (!page.isDestroyed()) {
      page.setIgnoreMenuShortcuts(isOpen);
    }
  };

  return {
    isOpen: (page) => page !== null && open.has(page),
    set,
    watch: (page, window) => {
      const forget = (): void => {
        set(page, false);
      };

      window.on("blur", forget);

      for (const event of PAGE_ENDS) {
        page.on(event, forget);
      }
    },
  };
};

/**
 * The menu bar's keys do nothing while the focused page has a menu open:
 * that menu takes the keys it shows. A click on the menu bar still works.
 * setIgnoreMenuShortcuts already keeps the keys from the menu bar on macOS;
 * this holds them even where it doesn't.
 */
export const holdMenuBarKeys = (
  template: readonly MenuItemConstructorOptions[],
  held: () => boolean
): MenuItemConstructorOptions[] =>
  template.map((item) => {
    const { click, submenu } = item;
    const guarded = { ...item };

    if (click !== undefined) {
      // Item 8's key handler runs entries with no event at all.
      guarded.click = (
        menuItem: MenuItem,
        window: BaseWindow | undefined,
        event: KeyboardEvent | undefined
      ) => {
        if (event?.triggeredByAccelerator === true && held()) {
          return;
        }

        click(menuItem, window, event ?? {});
      };
    }

    if (Array.isArray(submenu)) {
      guarded.submenu = holdMenuBarKeys(submenu, held);
    }

    return guarded;
  });

/** What a page's key handler may do with a key press. */
export interface KeyPressEvent {
  readonly preventDefault: () => void;
}

/** Hears each key press in a page before the page does: Electron's before-input-event. */
export type KeyListener = (event: KeyPressEvent, input: KeyInput) => void;

export interface MenuKeyDeps<Entry> {
  readonly onKey: (listener: KeyListener) => void;
  /** The app menu's entries now. */
  readonly menu: () => readonly Entry[];
  /** Whether the page has a menu open, which then takes every key. */
  readonly held: () => boolean;
  readonly run: (entry: Entry) => void;
}

/**
 * Runs the app menu's entry for a key press in this page (item 8): on
 * Windows the frameless windows have no menu bar to take the keys from.
 * Preventing the event also keeps it from the page and its menus. While a
 * menu is open in the page, every key is left to it.
 */
export const answerMenuKeys = <Entry extends MenuNode<Entry>>(
  deps: MenuKeyDeps<Entry>
): void => {
  deps.onKey((event, input) => {
    if (deps.held()) {
      return;
    }

    const entry = menuEntryForKey(deps.menu(), input);

    if (entry !== null) {
      event.preventDefault();
      deps.run(entry);
    }
  });
};

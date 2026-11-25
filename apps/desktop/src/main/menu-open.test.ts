import type { MenuItem } from "electron";
import { describe, expect, it } from "vitest";

import type { KeyInput, MenuNode } from "./menu-keys";
import {
  answerMenuKeys,
  createMenuOpenTracker,
  holdMenuBarKeys,
} from "./menu-open";
import type { KeyListener } from "./menu-open";

/** Fires events as Electron's windows and pages do. */
const fakeEmitter = () => {
  const listeners = new Map<string, readonly (() => void)[]>();

  return {
    emit: (event: string): void => {
      for (const listener of listeners.get(event) ?? []) {
        listener();
      }
    },
    on: (event: string, listener: () => void): void => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
  };
};

interface PageState {
  destroyed: boolean;
  /** What main last told the page about the menu bar's keys. */
  ignoringMenuBar: boolean | null;
}

/** A page as Electron's WebContents fires its events. */
const fakePage = () => {
  const state: PageState = { destroyed: false, ignoringMenuBar: null };

  return {
    ...fakeEmitter(),
    isDestroyed: () => state.destroyed,
    setIgnoreMenuShortcuts: (ignore: boolean) => {
      if (state.destroyed) {
        throw new Error("Object has been destroyed");
      }

      state.ignoringMenuBar = ignore;
    },
    state,
  };
};

type FakePage = ReturnType<typeof fakePage>;

const CTRL_SHIFT_N: KeyInput = {
  alt: false,
  control: true,
  isAutoRepeat: false,
  key: "N",
  meta: false,
  shift: true,
  type: "keyDown",
};

interface Entry extends MenuNode<Entry> {
  readonly label: string;
}

const MENU: readonly Entry[] = [
  {
    label: "File",
    submenu: {
      items: [
        { accelerator: "CommandOrControl+N", label: "New Note" },
        { accelerator: "Shift+CommandOrControl+N", label: "New Section…" },
      ],
    },
  },
];

/** The shelf's page in its window, with Windows' key handler, the tracker and a record of what ran. */
const setup = () => {
  const page = fakePage();
  const window = fakeEmitter();
  const menus = createMenuOpenTracker<FakePage>();
  const ran: string[] = [];
  const keys: KeyListener[] = [];

  menus.watch(page, window);
  answerMenuKeys({
    held: () => menus.isOpen(page),
    menu: () => MENU,
    onKey: (listener) => {
      keys.push(listener);
    },
    run: (entry) => {
      ran.push(entry.label);
    },
  });

  /** Presses a key as Windows hands it to main: whether main kept it from the page. */
  const press = (input: KeyInput): boolean => {
    let prevented = false;

    const event = {
      preventDefault: () => {
        prevented = true;
      },
    };

    for (const listener of keys) {
      listener(event, input);
    }

    return prevented;
  };

  return { menus, page, press, ran, window };
};

describe(createMenuOpenTracker, () => {
  it("leaves Ctrl+Shift+N to an open menu, and runs New Section once the window loses focus", () => {
    const { menus, page, press, ran, window } = setup();

    menus.set(page, true);

    expect([
      press(CTRL_SHIFT_N),
      ran,
      page.state.ignoringMenuBar,
    ]).toStrictEqual([false, [], true]);

    window.emit("blur");

    expect([
      press(CTRL_SHIFT_N),
      ran,
      page.state.ignoringMenuBar,
    ]).toStrictEqual([true, ["New Section…"], false]);
  });

  it.each(["did-navigate", "did-start-loading", "render-process-gone"])(
    "forgets the menu when the page fires %s",
    (event) => {
      const { menus, page, press, ran } = setup();

      menus.set(page, true);
      page.emit(event);

      expect([menus.isOpen(page), press(CTRL_SHIFT_N), ran]).toStrictEqual([
        false,
        true,
        ["New Section…"],
      ]);
    }
  );

  it("forgets the menu of a destroyed page without touching it", () => {
    const { menus, page } = setup();

    menus.set(page, true);
    page.state.destroyed = true;
    page.emit("destroyed");

    expect([menus.isOpen(page), page.state.ignoringMenuBar]).toStrictEqual([
      false,
      true,
    ]);
  });

  it("holds the keys again when a menu opens after the window comes back", () => {
    const { menus, page, press, ran, window } = setup();

    menus.set(page, true);
    window.emit("blur");
    menus.set(page, true);

    expect([press(CTRL_SHIFT_N), ran]).toStrictEqual([false, []]);

    menus.set(page, false);

    expect([press(CTRL_SHIFT_N), ran]).toStrictEqual([true, ["New Section…"]]);
  });
});

describe(holdMenuBarKeys, () => {
  it("drops the menu bar's key while a menu is open, but not a click on it", () => {
    const ran: string[] = [];
    let held = true;

    const [file] = holdMenuBarKeys(
      [
        {
          label: "File",
          submenu: [
            {
              accelerator: "Shift+CommandOrControl+N",
              click: () => {
                ran.push("New Section…");
              },
              label: "New Section…",
            },
          ],
        },
      ],
      () => held
    );

    const newSection = Array.isArray(file?.submenu)
      ? file.submenu[0]?.click
      : undefined;

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SAFETY: the click under test never reads its menu item.
    const item = {} as MenuItem;

    newSection?.(item, undefined, { triggeredByAccelerator: true });
    newSection?.(item, undefined, { triggeredByAccelerator: false });
    held = false;
    newSection?.(item, undefined, { triggeredByAccelerator: true });

    expect(ran).toStrictEqual(["New Section…", "New Section…"]);
  });
});

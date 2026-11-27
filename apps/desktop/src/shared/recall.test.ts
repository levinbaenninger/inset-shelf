import { describe, expect, it } from "vite-plus/test";

import {
  AWAY_MS,
  GAP_MS,
  hasPlaces,
  hereOf,
  hereWith,
  holdsPagesFrom,
  INITIAL_RECALL,
  itemsFrom,
  onlyItems,
  pageKey,
  placeOf,
  samePlace,
  stepRecall,
  typedNote,
} from "./recall";
import type {
  Opening,
  PlaceKey,
  PlaceSource,
  RecallEvent,
  RecallState,
} from "./recall";
import {
  applyOp,
  emptyShelf,
  groupItems,
  ItemIdSchema,
  SectionIdSchema,
  WindowIdSchema,
} from "./shelf";
import type {
  ItemContext,
  MainOp,
  OpEnv,
  ShelfDoc,
  ShelfOp,
  WindowRef,
} from "./shelf";

describe(pageKey, () => {
  it.each([
    [
      "a pull request and its files",
      "https://github.com/acme/app/pull/12/files",
      "https://github.com/acme/app/pull/12",
    ],
    [
      "an issue and one of its comments",
      "https://github.com/acme/app/issues/7#issuecomment-1",
      "https://github.com/acme/app/issues/7",
    ],
    [
      "two pages of one repository",
      "https://github.com/acme/app/blob/main/a.ts",
      "https://github.com/acme/app/tree/main",
    ],
    [
      "a Claude chat with and without a query",
      "https://claude.ai/chat/4b1d?ref=sidebar",
      "https://claude.ai/chat/4b1d",
    ],
    [
      "a ChatGPT thread with and without a query",
      "https://chatgpt.com/c/68f0?model=x",
      "https://chatgpt.com/c/68f0",
    ],
    [
      "a page with tracking added, www. and a trailing slash",
      "https://www.example.com/docs/a/?utm_source=news&page=2&fbclid=1",
      "https://example.com/docs/a?page=2",
    ],
    [
      "a query in another order",
      "https://example.com/search?b=2&a=1",
      "https://example.com/search?a=1&b=2",
    ],
    [
      "a heading on a page",
      "https://example.com/docs/a#install",
      "https://example.com/docs/a",
    ],
    [
      "a page opened from a file",
      "file:///Users/x/site/index.html",
      "file:///Users/x/site/index.html",
    ],
  ])("%s are one place", (_, a, b) => {
    expect(pageKey(a)).not.toBeNull();
    expect(pageKey(a)).toBe(pageKey(b));
  });

  it.each([
    [
      "a pull request and its repository's code",
      "https://github.com/acme/app/pull/12",
      "https://github.com/acme/app/blob/main/a.ts",
    ],
    [
      "two pull requests",
      "https://github.com/acme/app/pull/12",
      "https://github.com/acme/app/pull/13",
    ],
    [
      "two routes of one web app",
      "https://mail.example.com/#/inbox",
      "https://mail.example.com/#/sent",
    ],
    [
      "two pages of one site",
      "https://example.com/docs/a",
      "https://example.com/docs/b",
    ],
    [
      "two files",
      "file:///Users/x/site/index.html",
      "file:///Users/x/site/about.html",
    ],
  ])("%s are two places", (_, a, b) => {
    expect(pageKey(a)).not.toBe(pageKey(b));
  });

  it.each([
    "https://example.com/",
    "https://www.github.com",
    "https://example.com/#top",
    "not an address",
    "mailto:someone@example.com",
  ])("names no page for %s", (raw) => {
    expect(pageKey(raw)).toBeNull();
  });
});

const source = (parts: Partial<PlaceSource>): PlaceSource => ({
  app: null,
  appLink: null,
  title: null,
  url: null,
  ...parts,
});

describe(samePlace, () => {
  it.each([
    [
      "a pull request against its /files page",
      source({
        app: "Safari",
        url: "https://github.com/acme/app/pull/12",
      }),
      source({
        app: "Google Chrome",
        url: "https://github.com/acme/app/pull/12/files",
      }),
      "page",
    ],
    [
      "a Claude chat in Chrome against the Claude app",
      source({
        app: "Google Chrome",
        title: "Plan the move - Claude",
        url: "https://claude.ai/chat/4b1d",
      }),
      source({
        app: "Claude",
        appLink: "claude://chat/4b1d",
        title: "Claude",
        url: "https://claude.ai/chat/4b1d",
      }),
      "page",
    ],
    [
      "a ChatGPT thread by its link",
      source({
        app: "ChatGPT",
        appLink: "codex://threads/68f0",
        title: "Fix the build",
      }),
      source({
        app: "ChatGPT",
        appLink: "codex://threads/68f0",
        title: "ChatGPT",
      }),
      "link",
    ],
    [
      "a T3 Code thread by its link",
      source({ app: "T3 Code (Beta)", appLink: "t3code://thread/a1" }),
      source({
        app: "T3 Code (Beta)",
        appLink: "t3code://thread/a1",
        title: "school/inset-shelf / Build Inset Shelf landing page",
      }),
      "link",
    ],
    [
      // Read from a running Code on macOS: "<file> — <folder>".
      "two files of one Code project",
      source({ app: "Code", title: ".claude.json — levin" }),
      source({ app: "Code", title: "● settings.json — levin" }),
      "project",
    ],
    [
      "two files of one Cursor project",
      source({ app: "Cursor", title: "index.ts — inset-shelf" }),
      source({ app: "Cursor", title: "shelf.ts — inset-shelf" }),
      "project",
    ],
    [
      "the same title, an unread count and an unsaved mark aside",
      source({ app: "Notes", title: "Standup" }),
      source({ app: "Notes", title: "(3) • Standup" }),
      "title",
    ],
    [
      "a Windows browser window without an address against a page saved with one",
      source({
        app: "Google Chrome",
        title: "Release checklist",
        url: "https://example.com/docs/release",
      }),
      source({
        app: "Google Chrome",
        title: "Release checklist - Google Chrome",
      }),
      "title",
    ],
  ] as const)("%s → %s", (_, item, front, rule) => {
    expect(samePlace(item, front)).toBe(rule);
  });

  it.each([
    [
      "two pages with the same title",
      source({
        app: "Safari",
        title: "Docs",
        url: "https://example.com/docs/a",
      }),
      source({
        app: "Safari",
        title: "Docs",
        url: "https://example.com/docs/b",
      }),
    ],
    [
      "the same title in two apps",
      source({ app: "Notes", title: "Standup" }),
      source({ app: "TextEdit", title: "Standup" }),
    ],
    [
      "a title that only names the app",
      source({ app: "Slack", title: "Slack" }),
      source({ app: "Slack", title: "Slack" }),
    ],
    [
      "a title too short to name anything",
      source({ app: "Terminal", title: "~" }),
      source({ app: "Terminal", title: "~" }),
    ],
    [
      "two Code projects with a file of the same name",
      source({ app: "Code", title: "index.ts — inset-shelf" }),
      source({ app: "Code", title: "index.ts — inset-web" }),
    ],
    [
      "a Code window without a folder against one with",
      source({ app: "Code", title: "Visual Studio Code" }),
      source({ app: "Code", title: "index.ts — inset-shelf" }),
    ],
    [
      "two ChatGPT threads",
      source({ app: "ChatGPT", appLink: "codex://threads/1" }),
      source({ app: "ChatGPT", appLink: "codex://threads/2" }),
    ],
    [
      "the same app and nothing else",
      source({ app: "Finder" }),
      source({ app: "Finder" }),
    ],
  ] as const)("%s are not one place", (_, item, front) => {
    expect(samePlace(item, front)).toBeNull();
  });
});

describe(placeOf, () => {
  it("names the front window by the strongest rule it answers", () => {
    expect(
      placeOf(source({ url: "https://github.com/acme/app/pull/12/files" }))
    ).toBe(pageKey("https://github.com/acme/app/pull/12"));
    expect(placeOf(source({ app: "Code", title: "a.ts — inset-shelf" }))).toBe(
      placeOf(source({ app: "Code", title: "b.ts — inset-shelf" }))
    );
    expect(placeOf(source({ app: "Notes", title: "Standup" }))).not.toBe(
      placeOf(source({ app: "TextEdit", title: "Standup" }))
    );
    expect(placeOf(source({ app: "Finder" }))).toBeNull();
  });
});

const uuid = (n: number) =>
  `3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1b${String(n).padStart(2, "0")}`;

const env = (start = 10): OpEnv => {
  let next = start;

  return {
    newItemId: () => ItemIdSchema.parse(uuid((next += 1))),
    newSectionId: () => SectionIdSchema.parse(uuid((next += 1))),
    now: () => new Date("2026-11-25T10:00:00.000Z"),
  };
};

const PR: ItemContext = {
  app: "Safari",
  appLink: null,
  title: "Fix the build",
  url: "https://github.com/acme/app/pull/12",
};

const linkedWindow = (url: string): WindowRef => ({
  app: "Safari",
  appPath: null,
  capturedAt: "2026-11-25T10:00:00.000Z",
  description: "",
  document: null,
  id: WindowIdSchema.parse(uuid(90)),
  thumb: null,
  title: "Fix the build",
  url,
});

const addText = (body: string, context: ItemContext | null): MainOp => ({
  context,
  html: null,
  text: body,
  type: "addText",
  via: "selection",
});

/** Five items: from the pull request, done from it, from elsewhere, linked to it in a second section, and from nowhere. */
const shelf = (): ShelfDoc => {
  const e = env();
  // The ids env() hands out in order: items 11 to 13, the section 14, items 15 and 16.
  const done = ItemIdSchema.parse(uuid(12));
  const linked = ItemIdSchema.parse(uuid(15));

  const ops: readonly (ShelfOp | MainOp)[] = [
    addText("from the pull request", PR),
    addText("done, from the pull request", PR),
    addText("from elsewhere", {
      ...PR,
      url: "https://github.com/acme/app/pull/13",
    }),
    { name: "Later", type: "addSection" },
    addText("linked to the pull request", null),
    addText("from nowhere", null),
    { id: done, type: "toggleDone" },
    {
      id: linked,
      type: "attachWindows",
      windows: [linkedWindow("https://github.com/acme/app/pull/12/files")],
    },
  ];

  let doc = emptyShelf(SectionIdSchema.parse(uuid(1)));

  for (const op of ops) {
    ({ doc } = applyOp(doc, op, e, []));
  }

  return doc;
};

describe(itemsFrom, () => {
  const doc = shelf();

  const text = (ids: readonly string[]) =>
    ids.map((id) => {
      const found = doc.items.find((item) => item.id === id);

      return found?.kind === "text" ? found.text : "";
    });

  it("finds the open items from the front window, by their source or a linked window, in shelf order", () => {
    expect(
      text(
        itemsFrom(
          doc,
          source({
            app: "Google Chrome",
            url: "https://github.com/acme/app/pull/12",
          })
        )
      )
    ).toStrictEqual(["from the pull request", "linked to the pull request"]);
  });

  it("finds nothing for a window no item came from", () => {
    expect(
      itemsFrom(
        doc,
        source({ app: "Safari", url: "https://github.com/acme/app/pull/99" })
      )
    ).toStrictEqual([]);
  });
});

describe(holdsPagesFrom, () => {
  it("asks for an app's page address only when an open item came from a page in it", () => {
    const doc = shelf();

    expect(holdsPagesFrom(doc, "Safari")).toBeTruthy();
    expect(holdsPagesFrom(doc, "Google Chrome")).toBeFalsy();
    expect(holdsPagesFrom(doc, null)).toBeFalsy();
  });
});

describe(hereOf, () => {
  it("names the window the shelf opens beside and its items, or nothing", () => {
    const doc = shelf();

    const pr = source({
      app: "Safari",
      url: "https://github.com/acme/app/pull/12",
    });

    expect(hereOf(doc, pr)).toStrictEqual({
      ids: itemsFrom(doc, pr),
      label: "GitHub · acme/app #12",
    });
    expect(hereOf(doc, source({ app: "Notes", title: "Standup" }))).toBeNull();
    expect(hereOf(doc, null)).toBeNull();
  });
});

/** The shelf opened beside the pull request: the open items from it, and its source for a note typed under the chip. */
const opening = (doc: ShelfDoc, seq = 4): Opening => ({
  context: PR,
  here: {
    filter: true,
    ids: itemsFrom(doc, PR),
    label: "GitHub · acme/app #12",
    seq,
  },
});

/** The shelf after a composer request, mapped as main maps it for this opening, and the item it made. */
const typed = (
  doc: ShelfDoc,
  op: Extract<ShelfOp, { readonly type: "compose" }>,
  open: Opening | null
) => {
  const result = applyOp(doc, typedNote(op, open), env(60), []);

  return {
    doc: result.doc,
    item: result.doc.items.find((item) => item.id === result.addedId),
  };
};

describe(typedNote, () => {
  const doc = shelf();
  const text = "Ask about the flaky test";
  const plain = typed(doc, { text, type: "compose" }, opening(doc)).item;

  it("gives a note typed under this opening's chip the window's source, and changes nothing else", () => {
    expect(plain?.context).toBeNull();
    expect(
      typed(doc, { here: 4, text, type: "compose" }, opening(doc)).item
    ).toStrictEqual({ ...plain, context: PR });
  });

  it("makes a plain note when the request names an earlier opening", () => {
    expect(
      typed(doc, { here: 3, text, type: "compose" }, opening(doc)).item
    ).toStrictEqual(plain);
    expect(
      typed(doc, { here: 4, text, type: "compose" }, null).item
    ).toStrictEqual(plain);
  });

  it("makes a plain note when the chip was taken off, so the request names no opening", () => {
    expect(
      typed(doc, { text, type: "compose" }, opening(doc)).item?.context
    ).toBeNull();
  });

  it("still makes a section from “# Name” under the chip", () => {
    const after = typed(
      doc,
      { here: 4, text: "# Review", type: "compose" },
      opening(doc)
    );

    expect(after.item).toBeUndefined();
    expect(after.doc.sections.map((section) => section.name)).toContain(
      "Review"
    );
  });

  it("is found from that window again, by recall and by the shelf's here", () => {
    const after = typed(doc, { here: 4, text, type: "compose" }, opening(doc));
    const id = after.item?.id;

    expect(id).toBeDefined();
    expect(itemsFrom(after.doc, PR)).toContain(id);
    expect(hereOf(after.doc, PR)?.ids).toContain(id);
  });
});

describe(hereWith, () => {
  it("keeps the opening's items, checked ones too, and adds each open item from the window since", () => {
    const doc = shelf();
    const open = opening(doc);
    const [first] = open.here.ids;

    expect(first).toBeDefined();

    const checked =
      first === undefined
        ? doc
        : applyOp(doc, { id: first, type: "toggleDone" }, env(), []).doc;

    const after = typed(
      checked,
      { here: 4, text: "Ask about the flaky test", type: "compose" },
      open
    );

    expect(hereWith(open, after.doc)).toStrictEqual({
      ...open.here,
      ids: [...open.here.ids, after.item?.id],
    });
  });

  it("is the opening as it was while nothing new came from the window", () => {
    const doc = shelf();

    expect(hereWith(opening(doc), doc)).toStrictEqual(opening(doc).here);
  });

  it("keeps a note typed under the chip once it is checked off, as it keeps the opening's own items", () => {
    const doc = shelf();
    const open = opening(doc);

    const after = typed(
      doc,
      { here: 4, text: "Ask about the flaky test", type: "compose" },
      open
    );

    const id = after.item?.id;

    const checked =
      id === undefined
        ? after.doc
        : applyOp(after.doc, { id, type: "toggleDone" }, env(70), []).doc;

    expect(hereWith(open, checked).ids).toStrictEqual([...open.here.ids, id]);
  });

  it("keeps a note typed beside a site's home page, which no address rule matches again", () => {
    const home = {
      app: "Safari",
      appLink: null,
      title: "Example Domain",
      url: "https://example.com/",
    };

    const { doc } = applyOp(
      shelf(),
      addText("copied before the address was read", { ...home, url: null }),
      env(50),
      []
    );

    const open: Opening = {
      ...opening(doc),
      context: home,
      here: { ...opening(doc).here, ids: itemsFrom(doc, home) },
    };

    expect(open.here.ids).toHaveLength(1);

    const after = typed(
      doc,
      { here: 4, text: "Ask about the flaky test", type: "compose" },
      open
    );

    expect(hereWith(open, after.doc).ids).toStrictEqual([
      ...open.here.ids,
      after.item?.id,
    ]);
  });
});

describe(hasPlaces, () => {
  it("is false for a shelf whose open items came from nowhere", () => {
    const empty = emptyShelf(SectionIdSchema.parse(uuid(1)));

    expect(hasPlaces(empty)).toBeFalsy();
    expect(hasPlaces(shelf())).toBeTruthy();
  });
});

describe(onlyItems, () => {
  it("keeps only the named items and the sections that still hold one", () => {
    const doc = shelf();

    const ids = itemsFrom(
      doc,
      source({ url: "https://github.com/acme/app/pull/12" })
    );

    const groups = onlyItems(groupItems(doc, ""), new Set(ids.slice(0, 1)));

    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((item) => item.id)).toStrictEqual(
      ids.slice(0, 1)
    );
  });
});

const MINUTE = 60_000;

const place = (name: string): PlaceKey => {
  const key = placeOf(source({ app: "Notes", title: name }));

  if (key === null) {
    throw new Error(`no place for ${name}`);
  }

  return key;
};

const PR_PAGE = place("Pull request 12");
const EDITOR = place("Editor window");
const OTHER = place("Other window");
const ONE = [ItemIdSchema.parse(uuid(40))];
const TWO = [...ONE, ItemIdSchema.parse(uuid(41))];

type Step =
  | readonly ["at", number, PlaceKey | null, (readonly (typeof ONE)[number][])?]
  | readonly ["ended", PlaceKey, "opened" | "dismissed" | "ignored"];

/** The minutes at which a pill showed, for front windows read at those minutes. */
const shown = (steps: readonly Step[], from: RecallState = INITIAL_RECALL) => {
  let state = from;
  const at: number[] = [];

  for (const step of steps) {
    const event: RecallEvent =
      step[0] === "at"
        ? {
            at: step[1] * MINUTE,
            ids: step[3] ?? ONE,
            place: step[2],
            type: "arrived",
          }
        : { how: step[2], place: step[1], type: "ended" };

    const next = stepRecall(state, event);

    ({ state } = next);

    if (next.show && event.type === "arrived") {
      at.push(event.at / MINUTE);
    }
  }

  return at;
};

describe(stepRecall, () => {
  it("shows once per visit, however often the window is read", () => {
    expect(
      shown([
        ["at", 0, PR_PAGE],
        ["at", 1, PR_PAGE],
        ["at", 30, PR_PAGE],
      ])
    ).toStrictEqual([0]);
  });

  it("shows nothing for a place no open item came from", () => {
    expect(shown([["at", 0, PR_PAGE, []]])).toStrictEqual([]);
  });

  it("stays quiet on a return within 10 minutes and shows after", () => {
    expect(
      shown([
        ["at", 0, PR_PAGE],
        ["at", 1, EDITOR, []],
        ["at", 5, PR_PAGE],
        ["at", 6, EDITOR, []],
        ["at", 17, PR_PAGE],
      ])
    ).toStrictEqual([0, 17]);
  });

  it("counts away from when the place was left, not when it came", () => {
    expect(
      shown([
        ["at", 0, PR_PAGE],
        ["at", 30, EDITOR, []],
        ["at", 35, PR_PAGE],
      ])
    ).toStrictEqual([0]);
  });

  it("waits an hour after one ignored pill and four after two", () => {
    expect(
      shown([
        ["at", 0, PR_PAGE],
        ["ended", PR_PAGE, "ignored"],
        ["at", 1, EDITOR, []],
        ["at", 30, PR_PAGE],
        ["at", 31, EDITOR, []],
        ["at", 92, PR_PAGE],
        ["ended", PR_PAGE, "ignored"],
        ["at", 93, EDITOR, []],
        ["at", 200, PR_PAGE],
        ["at", 201, EDITOR, []],
        ["at", 442, PR_PAGE],
      ])
    ).toStrictEqual([0, 92, 442]);
    expect(AWAY_MS).toStrictEqual([10 * MINUTE, 60 * MINUTE, 240 * MINUTE]);
  });

  it("mutes a place after three ignored pills", () => {
    const visits: Step[] = [0, 1000, 2000, 3000, 4000].flatMap((minute) => [
      ["at", minute, PR_PAGE] as const,
      ["ended", PR_PAGE, "ignored"] as const,
      ["at", minute + 1, EDITOR, []] as const,
    ]);

    expect(shown(visits)).toStrictEqual([0, 1000, 2000]);
  });

  it("mutes a place at once with the close button", () => {
    expect(
      shown([
        ["at", 0, PR_PAGE],
        ["ended", PR_PAGE, "dismissed"],
        ["at", 1, EDITOR, []],
        ["at", 500, PR_PAGE],
      ])
    ).toStrictEqual([0]);
  });

  it("unmutes a place when its items change, still only after it was away", () => {
    expect(
      shown([
        ["at", 0, PR_PAGE],
        ["ended", PR_PAGE, "dismissed"],
        ["at", 1, EDITOR, []],
        ["at", 5, PR_PAGE, TWO],
        ["at", 6, EDITOR, []],
        ["at", 20, PR_PAGE, TWO],
      ])
    ).toStrictEqual([0, 20]);
  });

  it("keeps two pills at least 2 minutes apart, wherever they are", () => {
    expect(
      shown([
        ["at", 0, PR_PAGE],
        ["at", 1, EDITOR],
        ["at", 1.5, OTHER],
        ["at", 2, PR_PAGE, []],
        ["at", 2.5, OTHER],
      ])
    ).toStrictEqual([0]);
    expect(GAP_MS).toBe(2 * MINUTE);
  });

  it("forgets ignored pills when one is clicked", () => {
    expect(
      shown([
        ["at", 0, PR_PAGE],
        ["ended", PR_PAGE, "ignored"],
        ["at", 1, EDITOR, []],
        ["at", 62, PR_PAGE],
        ["ended", PR_PAGE, "opened"],
        ["at", 63, EDITOR, []],
        ["at", 74, PR_PAGE],
      ])
    ).toStrictEqual([0, 62, 74]);
  });

  it("treats a window that is no place as leaving the last one", () => {
    expect(
      shown([
        ["at", 0, PR_PAGE],
        ["at", 1, null],
        ["at", 20, PR_PAGE],
      ])
    ).toStrictEqual([0, 20]);
  });
});

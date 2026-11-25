import { describe, expect, it } from "vitest";

import { itemsFrom, onlyItems, pageKey, placeOf, samePlace } from "./recall";
import type { PlaceSource } from "./recall";
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

const env = (): OpEnv => {
  let next = 10;

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

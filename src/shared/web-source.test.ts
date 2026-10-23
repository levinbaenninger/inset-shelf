import { describe, expect, it } from "vitest";

import {
  desktopApp,
  desktopLink,
  isAppLink,
  linksInHtml,
  sourceLabel,
  t3Thread,
  webUrl,
} from "./web-source";

describe(linksInHtml, () => {
  it("reads web links in order, once each, with the words they were on", () => {
    const html = `<html><body><p>See <a href="https://github.com/a/b/pull/1" class="x">the <b>PR</b></a>,
      <a href='https://example.com/?a=1&amp;b=2'>docs</a> and
      <a href="https://github.com/a/b/pull/1">again</a>.</p></body></html>`;

    expect(linksInHtml(html)).toStrictEqual([
      { text: "the PR", url: "https://github.com/a/b/pull/1" },
      { text: "docs", url: "https://example.com/?a=1&b=2" },
    ]);
  });

  it("skips relative, mail and script links, and names a bare link by its address", () => {
    const html = `<a href="/relative">no</a><a href="mailto:a@b.c">no</a>
      <a href="javascript:alert(1)">no</a><a href="https://example.com"><img src="x"></a>`;

    expect(linksInHtml(html)).toStrictEqual([
      { text: "https://example.com/", url: "https://example.com/" },
    ]);
  });

  it("finds nothing in plain HTML", () => {
    expect(
      linksInHtml("<html><body>The third Inset prototype</body></html>")
    ).toStrictEqual([]);
  });
});

describe(webUrl, () => {
  it("keeps only absolute http and https addresses", () => {
    expect(webUrl("https://claude.ai/chat/1")).toBe("https://claude.ai/chat/1");
    expect(webUrl("file:///etc/hosts")).toBeNull();
    expect(webUrl("not a url")).toBeNull();
  });
});

const page = (url: string | null, title: string | null, app = "Zen") =>
  sourceLabel({ app, title, url });

describe(sourceLabel, () => {
  it("names a GitHub pull request or issue by repository and number", () => {
    expect(
      page(
        "https://github.com/levinbaenninger/inset-shelf/pull/1",
        "feat: Inset Shelf prototype by levinbaenninger · Pull Request #1 · levinbaenninger/inset-shelf"
      )
    ).toStrictEqual({
      label: "GitHub · levinbaenninger/inset-shelf #1",
      service: "github",
    });
    expect(
      page("https://github.com/levinbaenninger/inset-shelf/tree/main", "x")
    ).toMatchObject({ label: "GitHub · levinbaenninger/inset-shelf" });
  });

  it("knows a GitHub pull request by its title when the address is missing", () => {
    expect(
      page(
        null,
        "feat: Inset Shelf prototype by levinbaenninger · Pull Request #1 · levinbaenninger/inset-shelf"
      )
    ).toStrictEqual({
      label: "GitHub · levinbaenninger/inset-shelf #1",
      service: "github",
    });
  });

  it("names chats by their title without the site's suffix", () => {
    expect(
      page("https://chatgpt.com/c/123", "Plakat mit PDF-Daten - ChatGPT")
    ).toStrictEqual({
      label: "ChatGPT · Plakat mit PDF-Daten",
      service: "chatgpt",
    });
    expect(
      page("https://claude.ai/chat/1", "Trip plan - Claude")
    ).toStrictEqual({ label: "Claude · Trip plan", service: "claude" });
    expect(page(null, "Plakat mit PDF-Daten", "ChatGPT")).toStrictEqual({
      label: "ChatGPT · Plakat mit PDF-Daten",
      service: "chatgpt",
    });
  });

  it("names a post on X by its author", () => {
    expect(
      page("https://x.com/shadcn/status/123", 'shadcn on X: "Copper" / X')
    ).toStrictEqual({ label: "X · @shadcn", service: "x" });
  });

  it("knows workspace tools by their sites and desktop apps", () => {
    expect(
      page(
        "https://acme.slack.com/archives/C1",
        "launch (Channel) - Acme - Slack"
      )
    ).toMatchObject({ service: "slack" });
    expect(page("https://www.notion.so/Plan-123", "Plan")).toStrictEqual({
      label: "Notion · Plan",
      service: "notion",
    });
    expect(page(null, "Roadmap – Figma", "Figma")).toMatchObject({
      service: "figma",
    });
  });

  it("names other pages by their site and title", () => {
    expect(
      page("https://www.example.com/docs", "Getting started")
    ).toStrictEqual({ label: "example.com · Getting started", service: null });
    expect(page(null, "Notes", "TextEdit")).toStrictEqual({
      label: "TextEdit · Notes",
      service: null,
    });
  });
});

describe(desktopApp, () => {
  it("names the desktop apps an item can be opened in again, and not browsers", () => {
    expect(desktopApp("ChatGPT")).toBe("ChatGPT");
    expect(desktopApp("Claude")).toBe("Claude");
    expect(desktopApp("Zen")).toBeNull();
    expect(desktopApp(null)).toBeNull();
  });
});

describe(desktopLink, () => {
  it("opens a Claude chat or project in the Claude app", () => {
    expect(
      desktopLink(
        "Claude",
        "https://claude.ai/chat/23fc82e8-8474-4242-8278-d1302d17fc50"
      )
    ).toBe("claude://claude.ai/chat/23fc82e8-8474-4242-8278-d1302d17fc50");
    expect(desktopLink("Claude", "https://claude.ai/recents")).toBeNull();
  });

  it("opens a Notion page in the Notion app", () => {
    expect(desktopLink("Notion", "https://www.notion.so/Plan-123?pvs=4")).toBe(
      "notion://www.notion.so/Plan-123?pvs=4"
    );
  });

  it("leaves pages from a browser, or without an address, to the browser", () => {
    expect(
      desktopLink(
        "Zen",
        "https://claude.ai/chat/23fc82e8-8474-4242-8278-d1302d17fc50"
      )
    ).toBeNull();
    expect(desktopLink("Claude", null)).toBeNull();
  });
});

describe(t3Thread, () => {
  it("turns the address a T3 Code window shows into a link to its thread", () => {
    expect(
      t3Thread(
        "t3code://app/#/f16b4dfa-2599-4042-bd15-192bfa68de3d/456a9b1f-6468-4248-924b-95d637df7ff6"
      )
    ).toStrictEqual({
      link: "t3code://threads/f16b4dfa-2599-4042-bd15-192bfa68de3d/456a9b1f-6468-4248-924b-95d637df7ff6",
      thread: "456a9b1f-6468-4248-924b-95d637df7ff6",
    });
    expect(t3Thread("t3code://app/#/")).toBeNull();
  });
});

describe(isAppLink, () => {
  it("allows only the desktop apps' own links", () => {
    expect(
      isAppLink("codex://threads/01a0a981-8186-7a92-af7d-c414d6adda1a")
    ).toBeTruthy();
    expect(isAppLink("t3code://threads/a/b")).toBeTruthy();
    expect(isAppLink("file:///etc/passwd")).toBeFalsy();
    expect(isAppLink("https://example.com")).toBeFalsy();
  });
});

describe("labels for desktop apps", () => {
  it("leaves out a title that only names the app", () => {
    expect(
      sourceLabel({ app: "Claude", title: "Claude", url: null })
    ).toStrictEqual({
      label: "Claude",
      service: "claude",
    });
    expect(
      sourceLabel({
        app: "T3 Code (Nightly)",
        title: "T3 Code (Nightly)",
        url: null,
      })
    ).toStrictEqual({ label: "T3 Code", service: "t3code" });
  });

  it("names a T3 Code thread and a Claude chat by their titles", () => {
    expect(
      sourceLabel({
        app: "T3 Code (Nightly)",
        title: "Run Project Locally for Testing",
        url: null,
      })
    ).toStrictEqual({
      label: "T3 Code · Run Project Locally for Testing",
      service: "t3code",
    });
    expect(
      sourceLabel({
        app: "Claude",
        title: "Computing signals from DOM queries - Claude",
        url: "https://claude.ai/chat/23fc82e8-8474-4242-8278-d1302d17fc50",
      })
    ).toStrictEqual({
      label: "Claude · Computing signals from DOM queries",
      service: "claude",
    });
  });
});

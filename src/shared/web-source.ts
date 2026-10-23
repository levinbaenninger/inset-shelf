/** A link inside copied text: the words it was on and where it points. */
export interface PageLink {
  readonly text: string;
  readonly url: string;
}

export const LINKS_MAX = 50;
export const LINK_TEXT_MAX = 300;
export const LINK_URL_MAX = 2000;

const ANCHOR =
  /<a\b[^>]*?\bhref\s*=\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)'|(?<bare>[^\s>]+))[^>]*>(?<inner>[\s\S]*?)<\/a\s*>/giu;

const TAG = /<[^>]*>/gu;
const SPACE = /\s+/gu;
const ENTITY = /&(?:#(?<decimal>\d+)|#x(?<hex>[\da-f]+)|(?<name>[a-z]+));/giu;

const NAMED = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
} as const;

const isNamed = (name: string): name is keyof typeof NAMED =>
  Object.hasOwn(NAMED, name);

interface EntityGroups {
  readonly decimal?: string;
  readonly hex?: string;
  readonly name?: string;
}

const codePointOf = (groups: EntityGroups): number | null => {
  if (groups.decimal !== undefined) {
    return Math.trunc(Number(groups.decimal));
  }

  return groups.hex === undefined ? null : Number(`0x${groups.hex}`);
};

const entityText = (whole: string, groups: EntityGroups): string => {
  const code = codePointOf(groups);

  if (code !== null) {
    return code > 0 && code <= 0x10_ff_ff ? String.fromCodePoint(code) : whole;
  }

  const name = groups.name?.toLowerCase() ?? "";

  return isNamed(name) ? NAMED[name] : whole;
};

const decode = (text: string): string => {
  let decoded = "";
  let last = 0;

  for (const match of text.matchAll(ENTITY)) {
    decoded +=
      text.slice(last, match.index) + entityText(match[0], match.groups ?? {});
    last = match.index + match[0].length;
  }

  return decoded + text.slice(last);
};

/** An absolute http or https address, or null. */
export const webUrl = (raw: string): string | null => {
  try {
    const url = new URL(raw.trim());

    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
};

/**
 * The web links in copied HTML, in order, each once. Only absolute http and
 * https addresses count; the HTML itself is never shown, only read here.
 */
export const linksInHtml = (html: string): readonly PageLink[] => {
  const links = new Map<string, PageLink>();

  for (const match of html.matchAll(ANCHOR)) {
    const { bare, double, inner, single } = match.groups ?? {};
    const url = webUrl(decode(double ?? single ?? bare ?? ""));

    if (url !== null && url.length <= LINK_URL_MAX && !links.has(url)) {
      const text = decode((inner ?? "").replaceAll(TAG, " "))
        .replaceAll(SPACE, " ")
        .trim()
        .slice(0, LINK_TEXT_MAX);

      links.set(url, { text: text === "" ? url : text, url });
    }

    if (links.size === LINKS_MAX) {
      break;
    }
  }

  return [...links.values()];
};

const SERVICES = [
  "chatgpt",
  "claude",
  "figma",
  "github",
  "linear",
  "notion",
  "slack",
  "t3code",
  "x",
  "youtube",
] as const;

export type Service = (typeof SERVICES)[number];

/**
 * Desktop apps that are one of the services. An item from one of them opens
 * that app again, not a browser.
 */
const APP_SERVICE = {
  ChatGPT: "chatgpt",
  Claude: "claude",
  Figma: "figma",
  Linear: "linear",
  Notion: "notion",
  Slack: "slack",
  "T3 Code": "t3code",
  "T3 Code (Nightly)": "t3code",
} as const;

const isServiceApp = (app: string): app is keyof typeof APP_SERVICE =>
  Object.hasOwn(APP_SERVICE, app);

/** The desktop app an item came from, when the shelf knows it, so it can be brought back. */
export const desktopApp = (app: string | null): string | null =>
  app !== null && isServiceApp(app) ? app : null;

/** Links that open something inside a desktop app; the only ones the shelf opens besides web pages. */
const APP_LINK = /^(?:claude|codex|notion|t3code|t3code-dev):\/\/\S+$/u;

export const isAppLink = (link: string): boolean =>
  link.length <= 2000 && APP_LINK.test(link);

const T3_PAGE =
  /^(?<scheme>t3code(?:-dev)?):\/\/app\/#\/(?<environment>[\w-]+)\/(?<thread>[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})$/u;

/** The thread a T3 Code window shows (its web area's address), or null. */
export const t3Thread = (
  address: string
): { readonly link: string; readonly thread: string } | null => {
  const { environment, scheme, thread } = T3_PAGE.exec(address)?.groups ?? {};

  return environment === undefined ||
    scheme === undefined ||
    thread === undefined
    ? null
    : { link: `${scheme}://threads/${environment}/${thread}`, thread };
};

const CLAUDE_PAGE =
  /^https:\/\/claude\.ai\/(?<kind>chat|project)\/(?<id>[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})$/u;

const NOTION_PAGE = /^https:\/\/(?:www\.)?notion\.so\/(?<rest>.*)$/u;

/**
 * The link that opens an item's page inside the desktop app it came from:
 * Claude's chats and projects, Notion's pages. Null when the app has no such
 * link, or the page is not one it opens; the app is then only brought forward.
 * ChatGPT's threads are looked up by title instead (src/main/codex-threads.ts).
 */
export const desktopLink = (
  app: string | null,
  url: string | null
): string | null => {
  if (url === null) {
    return null;
  }

  const claude = app === "Claude" ? CLAUDE_PAGE.exec(url)?.groups : undefined;

  if (claude !== undefined) {
    return `claude://claude.ai/${claude.kind}/${claude.id}`;
  }

  const notion = app === "Notion" ? NOTION_PAGE.exec(url)?.groups : undefined;

  return notion === undefined ? null : `notion://www.notion.so/${notion.rest}`;
};

export interface SourceLabel {
  /** A site the shelf knows, shown with its mark. */
  readonly service: Service | null;
  readonly label: string;
}

interface SourceParts {
  readonly app: string | null;
  readonly title: string | null;
  readonly url: string | null;
}

const SERVICE_NAME: Readonly<Record<Service, string>> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  figma: "Figma",
  github: "GitHub",
  linear: "Linear",
  notion: "Notion",
  slack: "Slack",
  t3code: "T3 Code",
  x: "X",
  youtube: "YouTube",
};

/** Suffixes sites add to their page titles, which repeat the site's name. */
const TITLE_SUFFIX: Readonly<Partial<Record<Service, RegExp>>> = {
  chatgpt: /\s+[-–—|]\s+ChatGPT$/u,
  claude: /\s+[-–—|]\s+Claude$/u,
  figma: /\s+[-–—]\s+Figma$/u,
  github: /\s+·\s+GitHub$/u,
  linear: /\s+[-–—|]\s+Linear$/u,
  notion: /\s+[-–—|]\s+Notion$/u,
  slack: /\s+[-–—]\s+Slack$/u,
  x: /\s+\/\s+X$/u,
  youtube: /\s+[-–—]\s+YouTube$/u,
};

const GITHUB_TITLE =
  /·\s+(?:Pull Request|Issue|Discussion) #(?<number>\d+)\s+·\s+(?<repo>[\w.-]+\/[\w.-]+)$/u;

const join = (...parts: readonly (string | null | undefined)[]): string =>
  parts
    .filter((part) => part !== null && part !== undefined && part !== "")
    .join(" · ");

/** Sites known by the end of their host name, which covers their workspaces' subdomains. */
const HOST_SUFFIX: readonly (readonly [string, Service])[] = [
  ["notion.so", "notion"],
  ["notion.site", "notion"],
  ["slack.com", "slack"],
  ["figma.com", "figma"],
  ["linear.app", "linear"],
];

const serviceOfHost = (host: string): Service | null => {
  const bare = host.replace(/^www\./u, "");

  if (bare === "github.com") {
    return "github";
  }

  const suffixed = HOST_SUFFIX.find(
    ([suffix]) => bare === suffix || bare.endsWith(`.${suffix}`)
  );

  if (suffixed !== undefined) {
    return suffixed[1];
  }

  if (bare === "chatgpt.com" || bare === "chat.openai.com") {
    return "chatgpt";
  }

  if (bare === "claude.ai") {
    return "claude";
  }

  if (bare === "x.com" || bare === "twitter.com") {
    return "x";
  }

  return bare === "youtube.com" ||
    bare === "youtu.be" ||
    bare === "m.youtube.com"
    ? "youtube"
    : null;
};

const cleanTitle = (title: string | null, service: Service): string | null => {
  const suffix = TITLE_SUFFIX[service];

  const clean =
    (suffix === undefined ? title : title?.replace(suffix, ""))?.trim() ?? "";

  // A title that only names the site or app says nothing more.
  return clean === "" || clean === SERVICE_NAME[service] ? null : clean;
};

/** "owner/repo #12" for a pull request or issue, "owner/repo" for the rest of a repository. */
const githubLabel = (url: URL, title: string | null): string => {
  const [owner, repo, kind, number] = url.pathname.split("/").filter(Boolean);

  if (owner === undefined || repo === undefined) {
    return join(SERVICE_NAME.github, cleanTitle(title, "github"));
  }

  const numbered =
    (kind === "pull" || kind === "issues" || kind === "discussions") &&
    number !== undefined &&
    /^\d+$/u.test(number);

  return join(
    SERVICE_NAME.github,
    numbered ? `${owner}/${repo} #${number}` : `${owner}/${repo}`
  );
};

const fromUrl = (raw: string, title: string | null): SourceLabel => {
  const url = new URL(raw);
  const service = serviceOfHost(url.hostname);

  if (service === "github") {
    return { label: githubLabel(url, title), service };
  }

  if (service === "x") {
    const [user, kind] = url.pathname.split("/").filter(Boolean);

    return {
      label: join(
        SERVICE_NAME.x,
        user !== undefined && kind === "status"
          ? `@${user}`
          : cleanTitle(title, "x")
      ),
      service,
    };
  }

  if (service !== null) {
    return {
      label: join(SERVICE_NAME[service], cleanTitle(title, service)),
      service,
    };
  }

  return {
    label: join(url.hostname.replace(/^www\./u, ""), title),
    service: null,
  };
};

/** Without an address, a few sites still tell themselves apart by their titles. */
const fromTitle = (app: string | null, title: string | null): SourceLabel => {
  const github = title === null ? null : GITHUB_TITLE.exec(title);

  if (github?.groups !== undefined) {
    return {
      label: join(
        SERVICE_NAME.github,
        `${github.groups.repo} #${github.groups.number}`
      ),
      service: "github",
    };
  }

  for (const service of SERVICES) {
    if (title !== null && TITLE_SUFFIX[service]?.test(title) === true) {
      return {
        label: join(SERVICE_NAME[service], cleanTitle(title, service)),
        service,
      };
    }
  }

  const service = app !== null && isServiceApp(app) ? APP_SERVICE[app] : null;

  if (service !== null) {
    return {
      label: join(
        SERVICE_NAME[service],
        title === app ? null : cleanTitle(title, service)
      ),
      service,
    };
  }

  // A window named after its app (or nothing) leaves just the app.
  return { label: join(app, title === app ? null : title), service: null };
};

/**
 * Where an item came from, in a few words: the site and what on it for pages
 * the shelf knows (GitHub, ChatGPT, Claude, X, YouTube), else the site or app
 * and the window's title.
 */
export const sourceLabel = (source: SourceParts): SourceLabel =>
  source.url === null || webUrl(source.url) === null
    ? fromTitle(source.app, source.title)
    : fromUrl(source.url, source.title);

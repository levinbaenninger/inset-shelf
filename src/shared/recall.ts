import { z } from "zod";

import type { ItemGroup, ItemId, ShelfDoc, ShelfItem } from "./shelf";
import { serviceOfHost } from "./web-source";
import { withoutAppName } from "./window-title";

/**
 * Context recall: which open items came from the window in front. All of it
 * is pure; src/main/front-watch.ts reads the front window and
 * src/main/index.ts shows the pill.
 */

/** What an item came from, reduced to a comparable key. */
const PlaceKeySchema = z.string().brand<"PlaceKey">();

export type PlaceKey = z.output<typeof PlaceKeySchema>;

/** How two sources were found to be the same place. */
export type PlaceRule = "page" | "link" | "project" | "title";

/** The parts of an item's context or a linked window the rule reads. */
export interface PlaceSource {
  readonly app: string | null;
  readonly appLink?: string | null;
  readonly title: string | null;
  readonly url: string | null;
}

/** Which end of an editor's window title names its project. */
export type TitleEnd = "first" | "last";

/**
 * Open decision 2: code editors whose windows match every file of the same
 * project, and which end of the window's title names it. Code's macOS title
 * reads "file — folder" (read from a running Code 2026-11-25:
 * ".claude.json — levin"). Cursor's is inferred from Code, which it forks;
 * not read from a running Cursor. An empty table makes editors match by
 * exact title only.
 */
export const PROJECT_PART: ReadonlyMap<string, TitleEnd> = new Map([
  ["Code", "last"],
  ["Cursor", "last"],
]);

/** Names an editor's title may hold where it names no project. */
const PRODUCT_NAMES: ReadonlySet<string> = new Set([
  "Code",
  "Cursor",
  "Visual Studio Code",
]);

const TRACKING = /^(?:utm_.*|fbclid|gclid|ref)$/u;

const NUMBERED = new Set(["pull", "issues", "discussions"]);

/** Every PlaceKey is made here, from a prefix naming its rule and the parts that identify it. */
const asKey = (key: string): PlaceKey => PlaceKeySchema.parse(key);

const githubKey = (url: URL): string => {
  const [owner, repo, kind, number] = url.pathname.split("/").filter(Boolean);

  if (owner === undefined || repo === undefined) {
    return `github.com${url.pathname.replace(/\/$/u, "")}`;
  }

  return kind !== undefined &&
    NUMBERED.has(kind) &&
    number !== undefined &&
    /^\d+$/u.test(number)
    ? `github.com/${owner}/${repo}/${kind}/${number}`
    : `github.com/${owner}/${repo}`;
};

const webKey = (url: URL): string => {
  const host = url.host.replace(/^www\./u, "").toLowerCase();
  const path = url.pathname.replace(/\/+$/u, "");
  const service = serviceOfHost(url.hostname);

  if (service === "chatgpt" || service === "claude") {
    return `${host}${path}`;
  }

  const query = [...url.searchParams]
    .flatMap(([name, value]) =>
      TRACKING.test(name) ? [] : [`${name}=${value}`]
    )
    .toSorted();

  // A fragment names a page only in an app that routes by it (#/inbox, #!/inbox), not a heading.
  const route =
    url.hash.startsWith("#/") || url.hash.startsWith("#!") ? url.hash : "";

  return `${host}${path}${query.length > 0 ? `?${query.join("&")}` : ""}${route}`;
};

/** A web or file address reduced to what identifies the page, or null for an address that names a whole site or can't be read. */
export const pageKey = (raw: string): PlaceKey | null => {
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol === "file:") {
    return asKey(`page:file://${url.pathname}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }

  const key =
    serviceOfHost(url.hostname) === "github" ? githubKey(url) : webKey(url);

  // Only the host is left: a whole site never matches.
  return key.includes("/") || key.includes("?") || key.includes("#")
    ? asKey(`page:${key}`)
    : null;
};

const UNREAD = /^\(\d+\)\s+/u;
const DIRTY = /^[●•]\s*/u;

/** A window's title as it names what it shows: without the app's name, an unread count or an unsaved mark; null when that says nothing. */
const cleanTitle = (
  title: string | null,
  app: string | null
): string | null => {
  if (title === null) {
    return null;
  }

  const clean = withoutAppName(title, app)
    .trim()
    .replace(UNREAD, "")
    .replace(DIRTY, "")
    .trim();

  return clean.length < 3 || clean === app ? null : clean;
};

const TITLE_PARTS = /\s[—–-]\s/u;

/** The project an editor's window shows, or null when its title names none. */
const projectOf = (source: PlaceSource): string | null => {
  const part = source.app === null ? undefined : PROJECT_PART.get(source.app);

  const title = cleanTitle(source.title, source.app);

  if (part === undefined || title === null) {
    return null;
  }

  const parts = title.split(TITLE_PARTS).map((each) => each.trim());
  const project = part === "first" ? parts.at(0) : parts.at(-1);

  return parts.length < 2 ||
    project === undefined ||
    project === "" ||
    PRODUCT_NAMES.has(project)
    ? null
    : project;
};

const linkOf = (source: PlaceSource): string | null => source.appLink ?? null;

/**
 * The rule by which two sources are the same place, or null. The first rule
 * both can answer decides: a page by its address, an app's own link, an
 * editor's project, then the same app with the same title. An app alone
 * never matches.
 */
export const samePlace = (
  item: PlaceSource,
  front: PlaceSource
): PlaceRule | null => {
  if (item.url !== null && front.url !== null) {
    const key = pageKey(item.url);

    return key !== null && key === pageKey(front.url) ? "page" : null;
  }

  const link = linkOf(item);

  if (link !== null && linkOf(front) !== null) {
    return link === linkOf(front) ? "link" : null;
  }

  if (item.app === null || item.app !== front.app) {
    return null;
  }

  const project = projectOf(item);

  if (project !== null && projectOf(front) !== null) {
    return project === projectOf(front) ? "project" : null;
  }

  const title = cleanTitle(item.title, item.app);

  return title !== null && title === cleanTitle(front.title, front.app)
    ? "title"
    : null;
};

/** The front window as one key, by the strongest rule it can answer, for remembering when it was last in front. */
export const placeOf = (front: PlaceSource): PlaceKey | null => {
  const page = front.url === null ? null : pageKey(front.url);

  if (page !== null) {
    return page;
  }

  const link = linkOf(front);

  if (link !== null) {
    return asKey(`link:${link}`);
  }

  const project = projectOf(front);

  if (project !== null) {
    return asKey(`project:${front.app ?? ""}\n${project}`);
  }

  const title = cleanTitle(front.title, front.app);

  return title === null ? null : asKey(`title:${front.app ?? ""}\n${title}`);
};

const fromHere = (item: ShelfItem, front: PlaceSource): boolean =>
  (item.context !== null && samePlace(item.context, front) !== null) ||
  item.windows.some((window) => samePlace(window, front) !== null);

/** The open items from the front window, in shelf order. Done items and attachments, which hold no source, add nothing. */
export const itemsFrom = (
  doc: ShelfDoc,
  front: PlaceSource
): readonly ItemId[] =>
  doc.sections.flatMap((section) =>
    doc.items
      .filter(
        (item) =>
          item.sectionId === section.id && !item.done && fromHere(item, front)
      )
      .map((item) => item.id)
  );

/** Only these items, and only the sections that still hold one. */
export const onlyItems = (
  groups: readonly ItemGroup[],
  ids: ReadonlySet<ItemId>
): readonly ItemGroup[] =>
  groups.flatMap((group) => {
    const items = group.items.filter((item) => ids.has(item.id));

    return items.length > 0 ? [{ ...group, items }] : [];
  });

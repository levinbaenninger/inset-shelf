import { z } from "zod";

import { codeEditor, titleParts } from "./code-editors";
import type { ItemGroup, ItemId, ShelfDoc, ShelfItem } from "./shelf";
import { serviceOfHost, sourceLabel } from "./web-source";
import { cleanTitle } from "./window-title";

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

/** The project an editor's window shows, or null when its title names none. */
const projectOf = (source: PlaceSource): string | null => {
  const editor = codeEditor(source.app);

  return editor === undefined
    ? null
    : titleParts(editor, source.title, source.app).project;
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

/** The open items from the window the shelf opens beside, and its place in a few words; null when none came from it. */
export const hereOf = (
  doc: ShelfDoc,
  front: PlaceSource | null
): { readonly ids: readonly ItemId[]; readonly label: string } | null => {
  const ids = front === null ? [] : itemsFrom(doc, front);

  return front === null || ids.length === 0
    ? null
    : { ids, label: sourceLabel(front).label };
};

/** Some open item has a source to match, so the front window is worth reading at all. An empty shelf costs nothing. */
export const hasPlaces = (doc: ShelfDoc): boolean =>
  doc.items.some(
    (item) => !item.done && (item.context !== null || item.windows.length > 0)
  );

/**
 * Some open item came from a page or an app link in this app: only then is
 * the window's address asked for, which costs an Apple Event, and which can
 * prompt only for a browser the user already let Inset read during a capture.
 */
export const holdsPagesFrom = (doc: ShelfDoc, app: string | null): boolean =>
  app !== null &&
  doc.items.some(
    (item) =>
      !item.done &&
      ((item.context?.app === app &&
        (item.context.url !== null || item.context.appLink !== null)) ||
        item.windows.some(
          (window) => window.app === app && window.url !== null
        ))
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

// When the pill shows. Everything here lives in memory and is gone when the app quits.

const MINUTE = 60_000;

/** How long a place must have been away before it is recalled again: after 0, 1 and 2 ignored pills. */
export const AWAY_MS: readonly [number, number, number] = [
  10 * MINUTE,
  60 * MINUTE,
  240 * MINUTE,
];

/** No two recall pills closer than this, wherever they are: a walk through five matching tabs shows one. */
export const GAP_MS = 2 * MINUTE;

/** Ignored pills that mute a place, until its items change. */
export const MUTE_AFTER = 3;

/** The most places remembered; the longest unseen go first. */
const PLACES_MAX = 500;

export interface PlaceMemory {
  /** When the place was last in front: when it was left, or is still in front. */
  readonly lastSeenAt: number;
  /** Pills for this place that hid unused since the last click or change of items. */
  readonly ignored: number;
  /** The matching item ids, joined. A change unmutes the place and forgets its ignored pills. */
  readonly itemsKey: string;
  readonly muted: boolean;
}

export interface RecallState {
  /** The place in front now. */
  readonly here: PlaceKey | null;
  readonly places: ReadonlyMap<PlaceKey, PlaceMemory>;
  readonly lastShownAt: number | null;
}

export const INITIAL_RECALL: RecallState = {
  here: null,
  lastShownAt: null,
  places: new Map(),
};

export type RecallEvent =
  /** A front window was read: the place it is, or null when it is none, with the open items from it. */
  | {
      readonly type: "arrived";
      readonly place: PlaceKey | null;
      readonly ids: readonly ItemId[];
      readonly at: number;
    }
  /** The pill for `place` went: clicked, closed with its button, or left alone. */
  | {
      readonly type: "ended";
      readonly place: PlaceKey;
      readonly how: "opened" | "dismissed" | "ignored";
    };

const awayFor = (memory: PlaceMemory): number =>
  AWAY_MS[Math.min(memory.ignored, AWAY_MS.length - 1)] ?? AWAY_MS[2];

/** The map with one place changed, at most PLACES_MAX long. */
const remember = (
  places: ReadonlyMap<PlaceKey, PlaceMemory>,
  place: PlaceKey,
  memory: PlaceMemory
): ReadonlyMap<PlaceKey, PlaceMemory> => {
  const next = new Map(places);

  next.delete(place);
  next.set(place, memory);

  for (const oldest of next.keys()) {
    if (next.size <= PLACES_MAX) {
      break;
    }

    next.delete(oldest);
  }

  return next;
};

/** The next state, and whether the pill shows now. */
export interface RecallStep {
  readonly state: RecallState;
  readonly show: boolean;
}

const arrive = (
  state: RecallState,
  event: Extract<RecallEvent, { readonly type: "arrived" }>
): RecallStep => {
  const { at, ids, place } = event;
  const left = state.here === null ? undefined : state.places.get(state.here);

  // The place just left was in front until now.
  const places =
    state.here !== null && left !== undefined && state.here !== place
      ? remember(state.places, state.here, { ...left, lastSeenAt: at })
      : state.places;

  if (place === null) {
    return { show: false, state: { ...state, here: null, places } };
  }

  const before = places.get(place);
  const itemsKey = ids.join(",");
  const changed = before !== undefined && before.itemsKey !== itemsKey;

  const memory: PlaceMemory =
    before === undefined || changed
      ? { ignored: 0, itemsKey, lastSeenAt: at, muted: false }
      : { ...before, lastSeenAt: at };

  const show =
    place !== state.here &&
    ids.length > 0 &&
    !memory.muted &&
    (before === undefined || at - before.lastSeenAt > awayFor(memory)) &&
    (state.lastShownAt === null || at - state.lastShownAt >= GAP_MS);

  return {
    show,
    state: {
      here: place,
      lastShownAt: show ? at : state.lastShownAt,
      places: remember(places, place, memory),
    },
  };
};

const end = (
  state: RecallState,
  event: Extract<RecallEvent, { readonly type: "ended" }>
): RecallState => {
  const memory = state.places.get(event.place);

  if (memory === undefined) {
    return state;
  }

  const ignored = event.how === "ignored" ? memory.ignored + 1 : memory.ignored;

  const next: PlaceMemory = {
    ...memory,
    ignored: event.how === "opened" ? 0 : ignored,
    muted: memory.muted || event.how === "dismissed" || ignored >= MUTE_AFTER,
  };

  return { ...state, places: remember(state.places, event.place, next) };
};

/**
 * Whether the recall pill shows. Only once per visit, for a place with open
 * items from it, away long enough (longer after each ignored pill), not
 * muted, and not within GAP_MS of the last pill anywhere.
 */
export const stepRecall = (
  state: RecallState,
  event: RecallEvent
): RecallStep =>
  event.type === "arrived"
    ? arrive(state, event)
    : { show: false, state: end(state, event) };

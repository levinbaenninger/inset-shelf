import { lstat, readlink, realpath } from "node:fs/promises";

import { FsErrorSchema } from "./save-error";

/**
 * The folder Inset may look in for a code file: the user's home, which it
 * lives in already. Only the home folder: another, the temp folder say, can
 * be set to a place macOS asks about, and finding where it is would touch it.
 */
export interface QuietRoots {
  readonly home: string;
}

/** What is at a path, as `lstat` says it: a link is not followed. */
export interface Entry {
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly isFile: () => boolean;
  readonly isDirectory: () => boolean;
  readonly isSymbolicLink: () => boolean;
}

/** The disk calls the policy makes: Node's, or a test's that notes each path asked about. */
export interface QuietFs {
  readonly lstat: (at: string) => Promise<Entry>;
  readonly readlink: (at: string) => Promise<string>;
  /** Only for the roots themselves. */
  readonly realpath: (at: string) => Promise<string>;
}

export type Looked =
  /** Something is there: `path` is where it really is, with no link left in it. */
  | { readonly kind: "there"; readonly path: string; readonly entry: Entry }
  /** Nothing is there, at a place Inset may look. */
  | { readonly kind: "gone" }
  /** Inset may not look there, or the disk would not say. */
  | { readonly kind: "unsure" };

export interface QuietDisk {
  /** What is at `file`, found without touching any place macOS could ask the user about. */
  readonly find: (file: string) => Promise<Looked>;
}

const UNSURE: Looked = { kind: "unsure" };
const GONE: Looked = { kind: "gone" };

/** Where macOS asks the user before an app reads a file (Files and Folders), by the home folder's own names. */
const ASKED_IN_HOME = ["Desktop", "Documents", "Downloads", "Library"];

/** Where disks other than the Mac's own are mounted. */
const VOLUMES = "/volumes";

/** More links than any real path holds: a path that leads to itself ends here. */
const LINKS_MAX = 32;

/** The errors that mean nothing is at a path, as against one the system won't say about. */
const NOTHING_THERE = new Set(["ENOENT", "ENOTDIR", "ENAMETOOLONG"]);

/** A path as a Mac's disk compares names: composed, and with no capitals told apart. */
const fold = (at: string): string => at.normalize("NFC").toLowerCase();

/** Whether `folder` is `at` or holds it, by whole names. */
const holds = (folder: string, at: string): boolean =>
  at === folder || at.startsWith(`${folder}/`);

/** A folder Inset may look in, as the disk spells it, and the disk it is on. */
interface Root {
  readonly path: string;
  readonly dev: number;
}

interface Policy {
  readonly roots: readonly Root[];
  /** Places never touched, whatever holds them. */
  readonly shut: readonly string[];
}

/** The root that holds `at`, when no shut place does. */
const rootOf = (at: string, { roots, shut }: Policy): Root | undefined =>
  shut.some((each) => holds(each, at))
    ? undefined
    : roots.find((root) => holds(root.path, at));

/**
 * Whether Inset may ask the disk about `at`: the one place this is decided,
 * before every call. A place in a root may be touched; so may a folder on
 * the way down to a root, and a name at the top of the disk, where the
 * system keeps links of its own (/var, /tmp). Nothing shut may, and nothing
 * else: a place not known to be safe is not touched.
 */
const mayTouch = (at: string, policy: Policy): boolean => {
  const place = fold(at);

  if (policy.shut.some((each) => holds(each, place))) {
    return false;
  }

  return (
    place.lastIndexOf("/") === 0 ||
    policy.roots.some(
      (root) => holds(place, root.path) || holds(root.path, place)
    )
  );
};

type Touched<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly looked: Looked };

/** One call to the disk, made only where the policy allows it. */
const touch = async <T>(
  at: string,
  policy: Policy,
  call: (at: string) => Promise<T>
): Promise<Touched<T>> => {
  if (!mayTouch(at, policy)) {
    return { looked: UNSURE, ok: false };
  }

  try {
    return { ok: true, value: await call(at) };
  } catch (error) {
    const code = FsErrorSchema.safeParse(error).data?.code ?? "";

    return { looked: NOTHING_THERE.has(code) ? GONE : UNSURE, ok: false };
  }
};

/** The disk itself. */
const NODE_FS: QuietFs = { lstat, readlink, realpath };

/**
 * The policy over `fs`: `find` resolves a path one link at a time, and asks
 * the policy before each step, so a link is never followed into a place
 * Inset may not look. A folder on another disk than its root's is a mounted
 * volume, and ends the walk there.
 */
export const quietDisk = (
  { home }: QuietRoots,
  fs: QuietFs = NODE_FS
): QuietDisk => {
  /** The root as the disk spells it; none when it is not there. */
  const rootAt = async (folder: string): Promise<readonly Root[]> => {
    try {
      const real = await fs.realpath(folder);
      const entry = await fs.lstat(real);

      return [{ dev: entry.dev, path: fold(real) }];
    } catch {
      return [];
    }
  };

  const policyNow = async (): Promise<Policy> => {
    const homes = await rootAt(home);

    return {
      roots: homes,
      shut: [
        VOLUMES,
        ...homes.flatMap((root) =>
          ASKED_IN_HOME.map((name) => `${root.path}/${fold(name)}`)
        ),
      ],
    };
  };

  /** Walks `left` down from the folder `above`, whose own names hold no link. */
  const walk = async (
    policy: Policy,
    above: readonly string[],
    left: readonly string[],
    links: number,
    last: Entry | null
  ): Promise<Looked> => {
    const [step, ...rest] = left;

    if (step === undefined) {
      const path = `/${above.join("/")}`;

      return last === null || rootOf(fold(path), policy) === undefined
        ? UNSURE
        : { entry: last, kind: "there", path };
    }

    if (step === "" || step === ".") {
      return await walk(policy, above, rest, links, last);
    }

    if (step === "..") {
      return await walk(policy, above.slice(0, -1), rest, links, null);
    }

    const at = `/${[...above, step].join("/")}`;
    const found = await touch(at, policy, fs.lstat);

    if (!found.ok) {
      return found.looked;
    }

    const entry = found.value;
    const root = rootOf(fold(at), policy);

    if (root !== undefined && entry.dev !== root.dev) {
      return UNSURE;
    }

    if (entry.isSymbolicLink()) {
      const target =
        links < LINKS_MAX ? await touch(at, policy, fs.readlink) : null;

      if (target === null || !target.ok) {
        return target?.looked ?? UNSURE;
      }

      const leads = target.value.split("/");

      return await walk(
        policy,
        target.value.startsWith("/") ? [] : above,
        [...leads, ...rest],
        links + 1,
        null
      );
    }

    // More names follow, or a slash that says folder: only a folder holds them.
    return rest.length > 0 && !entry.isDirectory()
      ? GONE
      : await walk(policy, [...above, step], rest, links, entry);
  };

  return {
    find: async (file) =>
      file.startsWith("/")
        ? await walk(await policyNow(), [], file.split("/"), 0, null)
        : UNSURE,
  };
};

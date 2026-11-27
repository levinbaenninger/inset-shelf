import { execFileSync } from "node:child_process";
import {
  constants,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { lstat, open, readlink, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { quietDisk } from "./quiet-disk";
import type { QuietFs } from "./quiet-disk";

/** As the test was handed it: on macOS it begins at /var, a link. */
const given = mkdtempSync(path.join(tmpdir(), "quiet-disk-"));
const base = realpathSync(given);
const home = path.join(base, "home");
const temp = path.join(base, "temp");
const dev = path.join(home, "dev");

const PROTECTED = ["Desktop", "Documents", "Downloads", "Library"] as const;

const file = (at: string): string => {
  mkdirSync(path.dirname(at), { recursive: true });
  writeFileSync(at, "export {};\n");

  return at;
};

const source = file(path.join(dev, "proj", "a.ts"));
const scratch = file(path.join(temp, "work", "a.ts"));
const elsewhere = file(path.join(base, "elsewhere", "a.ts"));

for (const name of PROTECTED) {
  file(path.join(home, name, "proj", "a.ts"));
}

// Links a developer could keep among their projects.
symlinkSync("proj", path.join(dev, "near"));

symlinkSync("near", path.join(dev, "chain"));

symlinkSync(path.join(home, "Documents", "proj"), path.join(dev, "docs"));

symlinkSync(
  path.join(home, "Documents", "proj", "a.ts"),
  path.join(dev, "doc.ts")
);

symlinkSync("../documents/proj", path.join(dev, "lower"));

symlinkSync(path.join(base, "elsewhere"), path.join(dev, "out"));

symlinkSync("loop", path.join(dev, "loop"));

symlinkSync(path.join(dev, "proj", "a.ts"), path.join(dev, "same.ts"));

/** As the policy opens a file: for reading, never through a link, never waiting. */
const NODE_OPEN: QuietFs["open"] = async (at) =>
  await open(
    at,
    // oxlint-disable-next-line no-bitwise -- open(2) takes its flags as one number.
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  );

interface Watched {
  readonly fs: QuietFs;
  readonly touched: string[];
}

/** The real disk, and every path it was asked about. */
const watched = (other: Partial<QuietFs> = {}): Watched => {
  const touched: string[] = [];

  return {
    fs: {
      lstat: async (at) => {
        touched.push(at);

        return await (other.lstat ?? lstat)(at);
      },
      readlink: async (at) => {
        touched.push(at);

        return await (other.readlink ?? readlink)(at);
      },
      open: async (at) => {
        touched.push(at);

        return await (other.open ?? NODE_OPEN)(at);
      },
      realpath: async (at) => {
        touched.push(at);

        return await (other.realpath ?? realpath)(at);
      },
    },
    touched,
  };
};

const disk = quietDisk({ home });

/** Whether any path asked about is in one of the home folder's protected folders, however it is spelled. */
const inProtected = (touched: readonly string[]): boolean =>
  touched.some((at) =>
    PROTECTED.some((name) =>
      `${at.toLowerCase()}/`.startsWith(
        `${path.join(home, name).toLowerCase()}/`
      )
    )
  );

describe(quietDisk, () => {
  it("finds a file in the home folder", async () => {
    const found = await disk.find(source);

    expect(found).toMatchObject({ kind: "there", path: source });
    expect(found.kind === "there" && found.entry.isFile()).toBeTruthy();
  });

  it("does not look in the temp folder, which can be set anywhere", async () => {
    const { fs, touched } = watched();

    await expect(quietDisk({ home }, fs).find(scratch)).resolves.toStrictEqual({
      kind: "unsure",
    });
    expect(touched.filter((at) => at.startsWith(temp))).toStrictEqual([]);
  });

  it("asks about no folder but the home folder and the file's own way there", async () => {
    const { fs, touched } = watched();

    await quietDisk({ home }, fs).find(source);

    expect(touched.filter((at) => !source.startsWith(at))).toStrictEqual([]);
  });

  it("follows the system's own links on the way to a place it may look", async () => {
    // /var/folders/… on macOS, where /var is a link to /private/var.
    await expect(
      disk.find(path.join(given, "home", "dev", "proj", "a.ts"))
    ).resolves.toMatchObject({ kind: "there", path: source });
  });

  it.each([
    ["a link to a folder", path.join(dev, "near", "a.ts")],
    ["a link to a link", path.join(dev, "chain", "a.ts")],
    ["a link to the file", path.join(dev, "same.ts")],
  ])("follows %s to where the file really is", async (_, linked) => {
    await expect(disk.find(linked)).resolves.toMatchObject({
      kind: "there",
      path: source,
    });
  });

  it.each(PROTECTED)("does not look in the home folder's %s", async (name) => {
    const { fs, touched } = watched();

    await expect(
      quietDisk({ home }, fs).find(path.join(home, name, "proj", "a.ts"))
    ).resolves.toStrictEqual({ kind: "unsure" });
    expect(inProtected(touched)).toBeFalsy();
  });

  it.each([
    ["a folder link into Documents", path.join(dev, "docs", "a.ts")],
    ["a file link into Documents", path.join(dev, "doc.ts")],
    [
      "a link that steps back and spells it documents",
      path.join(dev, "lower", "a.ts"),
    ],
    [
      "another spelling of Documents",
      path.join(home, "DOCUMENTS", "proj", "a.ts"),
    ],
  ])("does not follow %s", async (_, linked) => {
    const { fs, touched } = watched();

    await expect(quietDisk({ home }, fs).find(linked)).resolves.toStrictEqual({
      kind: "unsure",
    });
    expect(inProtected(touched)).toBeFalsy();
  });

  it.each([
    ["a file outside the home folder", elsewhere],
    ["a link out of the home folder", path.join(dev, "out", "a.ts")],
  ])("does not look at %s", async (_, outside) => {
    const { fs, touched } = watched();

    await expect(quietDisk({ home }, fs).find(outside)).resolves.toStrictEqual({
      kind: "unsure",
    });
    expect(
      touched.filter((at) => at.startsWith(path.join(base, "elsewhere")))
    ).toStrictEqual([]);
  });

  it("looks at nothing on a mounted volume", async () => {
    const { fs, touched } = watched();

    await expect(
      quietDisk({ home }, fs).find("/Volumes/Disk/proj/a.ts")
    ).resolves.toStrictEqual({ kind: "unsure" });
    // The home folder itself is looked at, to know where it is.
    expect(touched.filter((at) => !at.startsWith(base))).toStrictEqual([]);
  });

  it("stops at a folder on another disk, a volume mounted in the home folder", async () => {
    const mount = path.join(dev, "proj");

    const { fs, touched } = watched({
      lstat: async (at) => {
        const entry = await lstat(at);

        return at === mount
          ? Object.assign(entry, { dev: entry.dev + 1 })
          : entry;
      },
    });

    await expect(quietDisk({ home }, fs).find(source)).resolves.toStrictEqual({
      kind: "unsure",
    });
    expect(touched).not.toContain(source);
  });

  it("gives up on links that lead to themselves", async () => {
    await expect(
      disk.find(path.join(dev, "loop", "a.ts"))
    ).resolves.toStrictEqual({ kind: "unsure" });
  });

  it.each([
    ["nothing is", path.join(dev, "proj", "b.ts")],
    ["a file is on the way", path.join(source, "c.ts")],
    ["a file is named as a folder", `${source}/`],
    ["the name is longer than a disk keeps", path.join(dev, "a".repeat(300))],
  ])("says a file is gone where %s", async (_, gone) => {
    await expect(disk.find(gone)).resolves.toStrictEqual({ kind: "gone" });
  });

  it("does not call a file gone when the system only refuses to say", async () => {
    const refused = Object.assign(new Error("not permitted"), {
      code: "EPERM",
    });

    const { fs } = watched({
      lstat: async (at) =>
        at === source ? await Promise.reject(refused) : await lstat(at),
    });

    await expect(quietDisk({ home }, fs).find(source)).resolves.toStrictEqual({
      kind: "unsure",
    });
  });

  it("does not look in a folder spelled like the home folder with other capitals", async () => {
    // On a disk that tells capitals apart, it is another folder.
    const sibling = path.join(base, "HOME");
    const { fs, touched } = watched();

    await expect(
      quietDisk({ home }, fs).find(path.join(sibling, "dev", "proj", "a.ts"))
    ).resolves.toStrictEqual({ kind: "unsure" });
    expect(touched.filter((at) => at.startsWith(sibling))).toStrictEqual([]);
  });

  it.each(["/Volumes/Disk/home", "/volumes/Disk/home"])(
    "touches nothing, not even to find it, for a home folder at %s",
    async (mounted) => {
      const touched: string[] = [];

      const refuse = async (at: string): Promise<never> => {
        touched.push(at);

        return await Promise.reject(
          Object.assign(new Error("not here"), { code: "ENOENT" })
        );
      };

      await expect(
        quietDisk(
          { home: mounted },
          { lstat: refuse, open: refuse, readlink: refuse, realpath: refuse }
        ).find(path.join(mounted, "dev", "a.ts"))
      ).resolves.toStrictEqual({ kind: "unsure" });
      expect(touched).toStrictEqual([]);
    }
  );

  it("is sure of nothing without a home folder it can find", async () => {
    await expect(
      quietDisk({ home: path.join(base, "no-home") }).find(source)
    ).resolves.toStrictEqual({ kind: "unsure" });
  });
});

const text = (bytes: Uint8Array | null): string | null =>
  bytes === null ? null : new TextDecoder().decode(bytes);

/** A disk on which `at` looked like the source file a moment ago. */
const lookedLikeSource = (at: string): QuietFs =>
  watched({
    lstat: async (asked) => await lstat(asked === at ? source : asked),
  }).fs;

describe("reading a file through the policy", () => {
  const words = "export {};\n";

  it("reads a file's bytes, from one opening of it", async () => {
    const { fs, touched } = watched();
    const opened: string[] = [];

    const counted: QuietFs = {
      ...fs,
      open: async (at) => {
        opened.push(at);

        return await fs.open(at);
      },
    };

    await expect(
      quietDisk({ home }, counted).read(source, 1024).then(text)
    ).resolves.toBe(words);
    expect(opened).toStrictEqual([source]);
    expect(touched.filter((at) => at === source)).toHaveLength(2);
  });

  it("reads through a link, at the place the file really is", async () => {
    await expect(
      disk.read(path.join(dev, "chain", "a.ts"), 1024).then(text)
    ).resolves.toBe(words);
  });

  it.each([
    ["exactly as large as the cap", words.length, words],
    ["one byte larger than the cap", words.length - 1, null],
  ])("reads a file %s, or nothing", async (_, max, read) => {
    await expect(disk.read(source, max).then(text)).resolves.toBe(read);
  });

  it.each([
    ["in Documents", path.join(home, "Documents", "proj", "a.ts")],
    ["linked into Documents", path.join(dev, "docs", "a.ts")],
    ["outside the home folder", elsewhere],
    ["that is gone", path.join(dev, "proj", "b.ts")],
    ["that is a folder", path.join(dev, "proj")],
  ])("reads nothing %s, and opens nothing", async (_, unread) => {
    const { fs } = watched();
    const opened: string[] = [];

    await expect(
      quietDisk(
        { home },
        {
          ...fs,
          open: async (at) => {
            opened.push(at);

            return await fs.open(at);
          },
        }
      ).read(unread, 1024)
    ).resolves.toBeNull();
    expect(opened).toStrictEqual([]);
  });

  it.skipIf(process.platform === "win32")(
    "does not wait on a pipe that took the file's place after the look",
    async () => {
      const pipe = path.join(dev, "pipe.ts");

      execFileSync("mkfifo", [pipe]);

      await expect(
        quietDisk({ home }, lookedLikeSource(pipe)).read(pipe, 1024)
      ).resolves.toBeNull();
    }
  );

  it("does not follow a link that took the file's place after the look", async () => {
    const link = path.join(dev, "same.ts");

    await expect(
      quietDisk({ home }, lookedLikeSource(link)).read(link, 1024)
    ).resolves.toBeNull();
  });

  it("reads nothing from another file that took the path after the look", async () => {
    const other = file(path.join(dev, "proj", "other.ts"));

    await expect(
      quietDisk({ home }, lookedLikeSource(other)).read(other, 1024)
    ).resolves.toBeNull();
  });

  it("abandons a file that grew past the cap after it was opened, and closes it", async () => {
    const grown = file(path.join(dev, "proj", "grown.ts"));
    const closed: string[] = [];
    const { fs } = watched();

    const growing: QuietFs = {
      ...fs,
      open: async (at) => {
        const handle = await fs.open(at);
        const small = await handle.stat();

        // Grows once it is open and looked at: the read then meets more than the look saw.
        writeFileSync(grown, "x".repeat(64));

        return {
          close: async () => {
            closed.push(at);
            await handle.close();
          },
          read: async (...args) => await handle.read(...args),
          stat: async () => await Promise.resolve(small),
        };
      },
    };

    await expect(
      quietDisk({ home }, growing).read(grown, 16)
    ).resolves.toBeNull();
    expect(closed).toStrictEqual([grown]);
  });
});

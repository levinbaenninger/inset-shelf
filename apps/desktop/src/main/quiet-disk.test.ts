import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { lstat, readlink, realpath } from "node:fs/promises";
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
      realpath,
    },
    touched,
  };
};

const disk = quietDisk({ home, temp });

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

  it("finds a file in the temp folder", async () => {
    await expect(disk.find(scratch)).resolves.toMatchObject({
      kind: "there",
      path: scratch,
    });
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
      quietDisk({ home, temp }, fs).find(path.join(home, name, "proj", "a.ts"))
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

    await expect(
      quietDisk({ home, temp }, fs).find(linked)
    ).resolves.toStrictEqual({ kind: "unsure" });
    expect(inProtected(touched)).toBeFalsy();
  });

  it.each([
    ["a file outside the home and temp folders", elsewhere],
    ["a link out of the home folder", path.join(dev, "out", "a.ts")],
  ])("does not look at %s", async (_, outside) => {
    const { fs, touched } = watched();

    await expect(
      quietDisk({ home, temp }, fs).find(outside)
    ).resolves.toStrictEqual({ kind: "unsure" });
    expect(
      touched.filter((at) => at.startsWith(path.join(base, "elsewhere")))
    ).toStrictEqual([]);
  });

  it("looks at nothing on a mounted volume", async () => {
    const { fs, touched } = watched();

    await expect(
      quietDisk({ home, temp }, fs).find("/Volumes/Disk/proj/a.ts")
    ).resolves.toStrictEqual({ kind: "unsure" });
    // The home and temp folders themselves are looked at, to know where they are.
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

    await expect(
      quietDisk({ home, temp }, fs).find(source)
    ).resolves.toStrictEqual({ kind: "unsure" });
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

    await expect(
      quietDisk({ home, temp }, fs).find(source)
    ).resolves.toStrictEqual({ kind: "unsure" });
  });

  it("is sure of nothing without a home folder it can find", async () => {
    await expect(
      quietDisk({
        home: path.join(base, "no-home"),
        temp: path.join(base, "no-temp"),
      }).find(source)
    ).resolves.toStrictEqual({ kind: "unsure" });
  });
});

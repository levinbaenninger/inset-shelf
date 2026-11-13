import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import { followFolder } from "./follow-folder";
import type { FolderFollower } from "./follow-folder";

describe(followFolder, () => {
  const followers: FolderFollower[] = [];
  const dirs: string[] = [];

  const tempDir = async (): Promise<string> => {
    const dir = await mkdtemp(path.join(tmpdir(), "inset-follow-"));

    dirs.push(dir);

    return dir;
  };

  /** The names reported for `dir`, as they come. */
  const follow = (dir: string, waitForFolder = true) => {
    const names: string[] = [];

    followers.push(
      followFolder(
        dir,
        (name) => {
          names.push(name);
        },
        { retryMs: 50, waitForFolder }
      )
    );

    return names;
  };

  afterEach(async () => {
    for (const follower of followers.splice(0)) {
      follower.stop();
    }

    await Promise.all(
      dirs.splice(0).map(async (dir) => {
        await rm(dir, { force: true, recursive: true });
      })
    );
  });

  it("reports a file saved to a folder that is there", async () => {
    const dir = await tempDir();
    const names = follow(dir);

    await writeFile(path.join(dir, "Screenshot 1.png"), "png");

    await vi.waitFor(() => {
      expect(names).toContain("Screenshot 1.png");
    });
  });

  it("reports the file that made a missing folder, once the folder appears", async () => {
    const parent = await tempDir();
    const dir = path.join(parent, "Screenshots");
    const names = follow(dir);

    // As Windows does with the first screenshot: the folder and its file at once.
    await mkdir(dir);
    await writeFile(path.join(dir, "Screenshot 1.png"), "png");

    await vi.waitFor(() => {
      expect(names).toContain("Screenshot 1.png");
    });
  });

  it("doesn't wait for a missing folder when told not to", async () => {
    const parent = await tempDir();
    const dir = path.join(parent, "Screenshots");
    const names = follow(dir, false);

    await mkdir(dir);
    await writeFile(path.join(dir, "Screenshot 1.png"), "png");
    await sleep(300);

    expect(names).toStrictEqual([]);
  });

  it("reports nothing once stopped", async () => {
    const parent = await tempDir();
    const dir = path.join(parent, "Screenshots");
    const names = follow(dir);

    followers.at(-1)?.stop();
    await mkdir(dir);
    await writeFile(path.join(dir, "Screenshot 1.png"), "png");
    await sleep(300);

    expect(names).toStrictEqual([]);
  });
});

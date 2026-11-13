import { watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

export interface FollowFolderOptions {
  /** Waits for a folder that isn't there yet, instead of giving up on it. */
  readonly waitForFolder: boolean;
  /** How often to look again when even its parent can't be watched. */
  readonly retryMs: number;
}

export interface FolderFollower {
  readonly stop: () => void;
}

/**
 * Reports the names of files that appear in a folder. Windows makes its
 * Screenshots folder with the first screenshot saved, so a missing folder is
 * waited for: its parent is watched until it appears, and the files it holds
 * by then are reported too, so the screenshot that made it isn't missed.
 * Names are reported as the system gives them; the caller decides what they are.
 */
export const followFolder = (
  dir: string,
  onName: (name: string) => void,
  options: FollowFolderOptions
): FolderFollower => {
  let folder: FSWatcher | null = null;
  let parent: FSWatcher | null = null;
  let retry: NodeJS.Timeout | undefined;
  let stopped = false;

  const reportPresent = async (): Promise<void> => {
    try {
      const names = await readdir(dir);

      for (const name of names) {
        if (!stopped) {
          onName(name);
        }
      }
    } catch {
      // Gone again, or unreadable: the watch reports what comes next.
    }
  };

  /** Watches the folder itself; false when it isn't there (or can't be watched). */
  const attach = (appeared: boolean): boolean => {
    if (stopped || folder !== null) {
      return true;
    }

    try {
      folder = watch(dir, (_event, name) => {
        if (name !== null && !stopped) {
          onName(name);
        }
      });
      folder.on("error", () => {
        folder?.close();
        folder = null;
      });
    } catch {
      return false;
    }

    if (appeared) {
      void reportPresent();
    }

    return true;
  };

  const lookAgainLater = (): void => {
    retry = setTimeout(() => {
      if (!attach(true)) {
        lookAgainLater();
      }
    }, options.retryMs);
  };

  const waitForIt = (): void => {
    const name = path.basename(dir).toLowerCase();

    try {
      parent = watch(path.dirname(dir), (_event, changed) => {
        if (changed?.toLowerCase() === name && attach(true)) {
          parent?.close();
          parent = null;
        }
      });
      parent.on("error", () => {
        parent?.close();
        parent = null;
        lookAgainLater();
      });
    } catch {
      lookAgainLater();

      return;
    }

    // Made between the first look and the parent's watch.
    if (attach(true)) {
      parent.close();
      parent = null;
    }
  };

  if (!attach(false) && options.waitForFolder) {
    waitForIt();
  }

  return {
    stop: () => {
      stopped = true;
      clearTimeout(retry);
      folder?.close();
      folder = null;
      parent?.close();
      parent = null;
    },
  };
};

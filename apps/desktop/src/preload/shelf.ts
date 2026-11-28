import { shelfContract } from "@shared/contracts";
import { methodChannel } from "@shared/ipc";
import { isLocalAbsolutePath } from "@shared/local-path";
import { contextBridge, ipcRenderer, webUtils } from "electron";

import { exposeContract } from "./expose";

/** Methods main serves that the page must not be able to call by name. */
const HIDDEN_METHODS = ["addFiles"] as const;

exposeContract(shelfContract, HIDDEN_METHODS);

/**
 * Files dropped or pasted into the shelf. The page hands over File objects,
 * never path strings: only the preload can turn a File into its path
 * (webUtils.getPathForFile, which answers only for a file that exists on
 * disk, such as one the user dropped), and only here is that path sent to
 * main. The renderer is sandboxed and sees nothing but this bridge, so a
 * compromised page cannot name an arbitrary path; the best it can do is
 * re-submit File objects it was given. Main still checks each path.
 *
 * Resolves to null when none of the files has a path (an image copied from a
 * page), so the page can fall back to the image's bytes.
 */
contextBridge.exposeInMainWorld("insetFiles", {
  add: async (
    files: readonly File[]
  ): Promise<{ readonly count: number; readonly ok: boolean } | null> => {
    const paths = [...files]
      .slice(0, 50)
      .flatMap((file) => {
        try {
          return [webUtils.getPathForFile(file)];
        } catch {
          return [];
        }
      })
      .filter((found) => found !== "" && isLocalAbsolutePath(found));

    if (paths.length === 0) {
      return null;
    }

    const result: unknown = await ipcRenderer.invoke(
      methodChannel(shelfContract, "addFiles"),
      paths
    );

    return {
      count: paths.length,
      ok: result instanceof Object && "ok" in result && result.ok === true,
    };
  },
});

/**
 * Whether this is a development run, so the page treats T3 Code's dev links
 * (t3code-dev://) as app links like main does (allowDevAppLinks).
 */
contextBridge.exposeInMainWorld(
  "insetDev",
  process.argv.includes("--inset-dev")
);

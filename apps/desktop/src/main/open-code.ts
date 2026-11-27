import { stat } from "node:fs/promises";

import { openAddress } from "@shared/code-editors";
import type { CodeEditor } from "@shared/code-editors";
import { goneMessage } from "@shared/code-place";
import type { CodePlace } from "@shared/code-place";

import { FsErrorSchema } from "./save-error";

/** What opening a code place asks of the system; main passes Electron's. */
export interface CodeSystem {
  /** Whether the file is still at its path. */
  readonly fileIsThere: (file: string) => Promise<boolean>;
  /** Whether an app on this computer takes the address's scheme. */
  readonly registered: (address: string) => boolean;
  /** Opens an address `openAddress` built, in the app that registered its scheme. */
  readonly open: (address: string) => Promise<void>;
  /** Brings forward the app that registered the address's scheme, opening nothing in it. */
  readonly bringForward: (address: string) => Promise<void>;
  /** Shows the file in its folder: never opens or runs it. */
  readonly reveal: (file: string) => void;
  readonly notify: (message: string) => void;
}

/**
 * Opens a code item's file in its editor, at its line when one is stored.
 * Only an address the editor's row builds opens, and only when its scheme is
 * registered here; else, or when the open fails, the file is shown in its
 * folder. A file that is gone opens nothing: the shelf says so and the editor
 * comes forward. It never rejects.
 */
export const openCode = async (
  editor: CodeEditor | undefined,
  place: CodePlace,
  system: CodeSystem
): Promise<void> => {
  const built =
    editor === undefined ? null : openAddress(editor, place, place.line);

  const address = built !== null && system.registered(built) ? built : null;

  if (!(await system.fileIsThere(place.file))) {
    system.notify(goneMessage(place));

    if (address !== null) {
      try {
        await system.bringForward(address);
      } catch {
        // The shelf has said the file is gone; an editor that won't come forward changes nothing.
      }
    }

    return;
  }

  if (address === null) {
    system.reveal(place.file);

    return;
  }

  try {
    await system.open(address);
  } catch {
    // The system refused, or the editor went between the look and the open: the file is still shown.
    system.reveal(place.file);
  }
};

/** The errors that mean nothing is at a path, as against one the system won't say about. */
const GONE = new Set(["ENOENT", "ENOTDIR"]);

/**
 * Whether a file is at `file`. Only a path that holds nothing, or something
 * other than a file, is gone: a refused look leaves the editor to try.
 */
export const fileIsThere = async (
  file: string,
  look: (path: string) => Promise<{ isFile: () => boolean }> = stat
): Promise<boolean> => {
  try {
    const found = await look(file);

    return found.isFile();
  } catch (error) {
    return !GONE.has(FsErrorSchema.safeParse(error).data?.code ?? "");
  }
};

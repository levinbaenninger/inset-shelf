import { codeEditor, openAddress } from "@shared/code-editors";
import type { CodeEditor } from "@shared/code-editors";
import { fellBackMessage, goneMessage } from "@shared/code-place";
import type { CodePlace } from "@shared/code-place";

import type { QuietDisk } from "./quiet-disk";

/** What opening a code place asks of the system; main passes Electron's. */
export interface CodeSystem {
  /** Whether the file is still at its path, as far as Inset may look. */
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
 * Opens a code item's file in its editor, at its line when one is given.
 * Only an item whose app has a row among `editors` starts anything: for any
 * other app nothing is looked at, opened or shown. Only an address the row
 * builds opens, and only when its scheme is registered here. A file no
 * address opens as itself is shown in its folder, as its tooltip says. When
 * the editor was to open it and can't, the file is shown in its folder and
 * the shelf says so. A file that is gone opens nothing: the shelf says so
 * and the editor comes forward.
 */
export const openCode = async (
  app: string | null,
  place: CodePlace,
  editors: readonly CodeEditor[],
  system: CodeSystem
): Promise<void> => {
  const editor = codeEditor(app, editors);

  if (app === null || editor === undefined) {
    return;
  }

  const built = openAddress(editor, place, place.line);
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

  if (address !== null) {
    try {
      await system.open(address);

      return;
    } catch {
      // The system refused, or the editor went between the look and the open: the file is still shown.
    }
  }

  if (built !== null) {
    system.notify(fellBackMessage(place, app));
  }

  system.reveal(place.file);
};

/**
 * Whether a file is at `file`. Only a path that holds nothing, or something
 * other than a file, is gone. Where Inset may not look (src/main/quiet-disk.ts),
 * or the disk won't say, the editor is left to try.
 */
export const fileIsThere = async (
  file: string,
  disk: QuietDisk
): Promise<boolean> => {
  const looked = await disk.find(file);

  return (
    looked.kind === "unsure" ||
    (looked.kind === "there" && looked.entry.isFile())
  );
};

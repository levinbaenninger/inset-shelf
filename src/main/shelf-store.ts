import { randomUUID } from "node:crypto";
import { renameSync } from "node:fs";
import {
  copyFile,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";

import {
  attachmentsOf,
  AttachmentFileSchema,
  emptyShelf,
  parseShelfDocument,
} from "@shared/shelf";
import type { SectionId, ShelfDoc } from "@shared/shelf";

import { FsErrorSchema, saveErrorText } from "./save-error";

const DOC_FILE = "shelf.json";

/** The shelf as it was before the last write: Discard changes renames it back (Round 8). */
const PREV_FILE = `${DOC_FILE}.prev`;
const ATTACHMENTS = "attachments";

export type WriteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/** A write a Discard made stale before it took the file's place: the file is as it was (Round 8). */
export interface DroppedWrite {
  readonly ok: false;
  readonly dropped: true;
}

export type SaveResult = WriteResult | DroppedWrite;

export interface StoreFs {
  readonly mkdir: (dir: string) => Promise<void>;
  readonly readFile: (file: string) => Promise<string>;
  /** Writes to a new temporary sibling of `file` and syncs it; resolves with its path. */
  readonly writeTemp: (
    file: string,
    data: string | Uint8Array
  ) => Promise<string>;
  /** Writes to a temporary sibling, syncs it, and renames it over the target. */
  readonly writeAtomic: (
    file: string,
    data: string | Uint8Array
  ) => Promise<void>;
  /** Copies to a temporary sibling and renames it into place. */
  readonly copyAtomic: (from: string, to: string) => Promise<void>;
  readonly rename: (from: string, to: string) => Promise<void>;
  /** Renames before anything else runs: nothing can come between a save's last check and its new file taking the shelf's place (Round 8). */
  readonly renameSync: (from: string, to: string) => void;
  readonly list: (dir: string) => Promise<readonly string[]>;
  readonly remove: (file: string) => Promise<void>;
}

const writeTemp = async (
  file: string,
  data: string | Uint8Array
): Promise<string> => {
  const temp = `${file}.${randomUUID()}.tmp`;

  try {
    const handle = await open(temp, "w");

    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }

    return temp;
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
};

const writeAtomic = async (
  file: string,
  data: string | Uint8Array
): Promise<void> => {
  const temp = await writeTemp(file, data);

  try {
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
};

const copyAtomic = async (from: string, to: string): Promise<void> => {
  const temp = `${to}.${randomUUID()}.tmp`;

  try {
    await copyFile(from, temp);
    await rename(temp, to);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
};

export const nodeStoreFs: StoreFs = {
  copyAtomic,
  list: async (dir) => await readdir(dir),
  mkdir: async (dir) => {
    await mkdir(dir, { recursive: true });
  },
  readFile: async (file) => await readFile(file, "utf-8"),
  remove: async (file) => {
    await rm(file, { force: true });
  },
  rename,
  renameSync,
  writeAtomic,
  writeTemp,
};

/** Fails the next document write once; set by INSET_FAIL_NEXT_WRITE for the desktop test. */
export const failNextWrite = (fs: StoreFs): StoreFs => {
  let armed = true;

  return {
    ...fs,
    writeTemp: async (file, data) => {
      if (armed && file.endsWith(DOC_FILE)) {
        armed = false;
        throw Object.assign(new Error("Simulated write failure."), {
          code: "ENOSPC",
        });
      }

      return await fs.writeTemp(file, data);
    },
  };
};

export interface ShelfStore {
  readonly initial: ShelfDoc;
  /** Set when shelf.json could not be read: it was set aside, or it is left alone and nothing is saved. */
  readonly recovered: string | null;
  /** The shelf file could not be read or set aside, so nothing is saved this session and it stays as it was. */
  readonly readOnly: boolean;
  /**
   * Writes the shelf: a temporary file first, then the current file moves
   * aside as the previous version and the new one takes its place. `current`
   * is asked just before that: false drops the write (Round 8). One write at
   * a time; the controller waits for each.
   */
  readonly save: (
    doc: ShelfDoc,
    current?: () => boolean
  ) => Promise<SaveResult>;
  /**
   * Puts the shelf from before the last write back, by renaming, so a full
   * disk can't stop it; false when it couldn't (Round 8).
   */
  readonly restorePrevious: () => Promise<boolean>;
  readonly writeAttachment: (png: Uint8Array) => Promise<string>;
  /** Copies a file the user added; returns its stored name with the given extension. */
  readonly copyAttachment: (from: string, extension: string) => Promise<string>;
  readonly deleteAttachment: (file: string) => Promise<void>;
  readonly attachmentPath: (file: string) => string | null;
}

/**
 * What opening found. Only a shelf that was read (or never existed) may have
 * its attachments tidied; one that could not be read or moved aside is never
 * written over, so its file stays exactly as it was.
 */
type Loaded =
  | { readonly kind: "read"; readonly doc: ShelfDoc }
  | { readonly kind: "setAside"; readonly doc: ShelfDoc; readonly note: string }
  | { readonly kind: "blocked"; readonly doc: ShelfDoc; readonly note: string };

const BLOCKED_SAVE =
  "Nothing is saved this session, so the shelf file that could not be opened stays as it was.";

const load = async (
  fs: StoreFs,
  dir: string,
  newSectionId: () => SectionId,
  now: () => Date
): Promise<Loaded> => {
  const empty = emptyShelf(newSectionId());

  // A write stopped between its two renames leaves only the previous version.
  for (const name of [DOC_FILE, PREV_FILE]) {
    const file = path.join(dir, name);
    let raw: string;

    try {
      // oxlint-disable-next-line no-await-in-loop -- the previous version only when the shelf is missing.
      raw = await fs.readFile(file);
    } catch (error) {
      const code = FsErrorSchema.safeParse(error).data?.code ?? "unknown";

      if (code === "ENOENT") {
        continue;
      }

      return {
        doc: empty,
        kind: "blocked",
        note: `The saved shelf could not be opened (${code}). ${BLOCKED_SAVE}`,
      };
    }

    const doc = parseShelfDocument(raw);

    if (doc !== null) {
      return { doc, kind: "read" };
    }

    const aside = `shelf.unreadable-${now().toISOString().replaceAll(":", "-")}.json`;

    try {
      // oxlint-disable-next-line no-await-in-loop -- this file is the one being read.
      await fs.rename(file, path.join(dir, aside));
    } catch {
      return {
        doc: empty,
        kind: "blocked",
        note: `The saved shelf could not be read or set aside. ${BLOCKED_SAVE}`,
      };
    }

    return {
      doc: empty,
      kind: "setAside",
      note: `The saved shelf could not be read, so a new one was started. The old file was kept as ${aside}, with its pictures and files.`,
    };
  }

  return { doc: empty, kind: "read" };
};

const SET_ASIDE = /^shelf\.unreadable-.*\.json$/u;

const ignore = (): void => undefined;

const failed = (code: string | null): WriteResult => ({
  message: saveErrorText(code),
  ok: false,
});

const ATTACHMENT_NAMES =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}/gu;

/**
 * The attachments that shelf files set aside as unreadable, and the
 * previous version, still name, so they are never tidied away; null when
 * one of those files can't be read.
 */
const namedBySetAside = async (
  fs: StoreFs,
  dir: string
): Promise<readonly string[] | null> => {
  try {
    const names = await fs.list(dir);

    const files = names.filter(
      (name) => SET_ASIDE.test(name) || name === PREV_FILE
    );

    const texts = await Promise.all(
      files.map(async (name) => await fs.readFile(path.join(dir, name)))
    );

    return texts.flatMap((text) => text.match(ATTACHMENT_NAMES) ?? []);
  } catch {
    return null;
  }
};

/** Deletes attachment files no shelf file names, such as a removal that was not undone before quitting. */
const collectGarbage = async (
  fs: StoreFs,
  dir: string,
  attachments: string,
  doc: ShelfDoc
): Promise<void> => {
  const kept = await namedBySetAside(fs, dir);

  if (kept === null) {
    return;
  }

  const used = new Set([...doc.items.flatMap(attachmentsOf), ...kept]);

  const names = await fs.list(attachments);

  await Promise.all(
    names
      .filter(
        (name) =>
          AttachmentFileSchema.safeParse(name).success && !used.has(name)
      )
      // One that can't be deleted now is tried again on the next launch.
      .map(async (name) => {
        await fs.remove(path.join(attachments, name)).catch(ignore);
      })
  );
};

export interface StoreOptions {
  readonly fs: StoreFs;
  readonly newSectionId: () => SectionId;
  readonly now: () => Date;
}

export const openShelfStore = async (
  dir: string,
  options: StoreOptions
): Promise<ShelfStore> => {
  const { fs } = options;
  const attachments = path.join(dir, ATTACHMENTS);

  await fs.mkdir(attachments);

  const loaded = await load(fs, dir, options.newSectionId, options.now);

  if (loaded.kind === "read") {
    await collectGarbage(fs, dir, attachments, loaded.doc);
  }

  const docFile = path.join(dir, DOC_FILE);
  const prevFile = path.join(dir, PREV_FILE);

  /** A temporary file left behind harms nothing, so failing to delete one never changes how a save ended. */
  const removeTemp = async (temp: string): Promise<void> => {
    await fs.remove(temp).catch(ignore);
  };

  /** Renames the shelf from before the last write back into place. */
  const restore = async (): Promise<boolean> => {
    try {
      await fs.rename(prevFile, docFile);

      return true;
    } catch {
      return false;
    }
  };

  const save = async (
    next: ShelfDoc,
    current: () => boolean = () => true
  ): Promise<SaveResult> => {
    if (loaded.kind === "blocked") {
      return { message: BLOCKED_SAVE, ok: false };
    }

    const text = `${JSON.stringify(next, null, 2)}\n`;

    // The store never writes a file it could not read back on the next launch.
    if (parseShelfDocument(text) === null) {
      return {
        message:
          "The shelf could not be saved: an entry holds something the saved file can’t keep. The last saved copy is unchanged.",
        ok: false,
      };
    }

    let temp: string;

    try {
      temp = await fs.writeTemp(docFile, text);
    } catch (error) {
      return failed(FsErrorSchema.safeParse(error).data?.code ?? null);
    }

    if (!current()) {
      await removeTemp(temp);

      return { dropped: true, ok: false };
    }

    // From the check to the new file in the shelf's place nothing waits, so a Discard can't land between them and leave its words on disk.
    let movedAside = true;

    try {
      fs.renameSync(docFile, prevFile);
    } catch (error) {
      const code = FsErrorSchema.safeParse(error).data?.code ?? null;

      // No shelf yet: there is nothing to keep.
      if (code !== "ENOENT") {
        await removeTemp(temp);

        return failed(code);
      }

      movedAside = false;
    }

    try {
      fs.renameSync(temp, docFile);
    } catch (error) {
      if (movedAside) {
        await restore();
      }

      await removeTemp(temp);

      return failed(FsErrorSchema.safeParse(error).data?.code ?? null);
    }

    return { ok: true };
  };

  return {
    attachmentPath: (file) =>
      AttachmentFileSchema.safeParse(file).success
        ? path.join(attachments, file)
        : null,
    deleteAttachment: async (file) => {
      // One that can't be deleted now goes when the shelf next opens.
      if (AttachmentFileSchema.safeParse(file).success) {
        await fs.remove(path.join(attachments, file)).catch(ignore);
      }
    },
    initial: loaded.doc,
    readOnly: loaded.kind === "blocked",
    recovered: loaded.kind === "read" ? null : loaded.note,
    restorePrevious: restore,
    save,
    copyAttachment: async (from, extension) => {
      const file = `${randomUUID()}.${extension}`;

      await fs.copyAtomic(from, path.join(attachments, file));

      return file;
    },
    writeAttachment: async (png) => {
      const file = `${randomUUID()}.png`;

      await fs.writeAtomic(path.join(attachments, file), png);

      return file;
    },
  };
};

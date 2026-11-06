import { randomUUID } from "node:crypto";
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
import { z } from "zod";

const DOC_FILE = "shelf.json";
const ATTACHMENTS = "attachments";

export type WriteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export interface StoreFs {
  readonly mkdir: (dir: string) => Promise<void>;
  readonly readFile: (file: string) => Promise<string>;
  /** Writes to a temporary sibling, syncs it, and renames it over the target. */
  readonly writeAtomic: (
    file: string,
    data: string | Uint8Array
  ) => Promise<void>;
  /** Copies to a temporary sibling and renames it into place. */
  readonly copyAtomic: (from: string, to: string) => Promise<void>;
  readonly rename: (from: string, to: string) => Promise<void>;
  readonly list: (dir: string) => Promise<readonly string[]>;
  readonly remove: (file: string) => Promise<void>;
}

const writeAtomic = async (
  file: string,
  data: string | Uint8Array
): Promise<void> => {
  const temp = `${file}.${randomUUID()}.tmp`;

  try {
    const handle = await open(temp, "w");

    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }

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
  writeAtomic,
};

/** Fails the next document write once; set by INSET_FAIL_NEXT_WRITE for the desktop test. */
export const failNextWrite = (fs: StoreFs): StoreFs => {
  let armed = true;

  return {
    ...fs,
    writeAtomic: async (file, data) => {
      if (armed && file.endsWith(DOC_FILE)) {
        armed = false;
        throw new Error("Simulated write failure.");
      }

      await fs.writeAtomic(file, data);
    },
  };
};

export interface ShelfStore {
  readonly initial: ShelfDoc;
  /** Set when shelf.json could not be read: it was set aside, or it is left alone and nothing is saved. */
  readonly recovered: string | null;
  /** The shelf file could not be read or set aside, so nothing is saved this session and it stays as it was. */
  readonly readOnly: boolean;
  /** Coalesces: while one write runs, only the newest pending document is written next. */
  readonly save: (doc: ShelfDoc) => Promise<WriteResult>;
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

/** The system's code for a failed file operation, such as ENOENT. */
const FsErrorSchema = z.object({ code: z.string() });

const BLOCKED_SAVE =
  "Nothing is saved this session, so the shelf file that could not be opened stays as it was.";

const load = async (
  fs: StoreFs,
  dir: string,
  newSectionId: () => SectionId,
  now: () => Date
): Promise<Loaded> => {
  const file = path.join(dir, DOC_FILE);
  const empty = emptyShelf(newSectionId());
  let raw: string;

  try {
    raw = await fs.readFile(file);
  } catch (error) {
    const code = FsErrorSchema.safeParse(error).data?.code ?? "unknown";

    return code === "ENOENT"
      ? { doc: empty, kind: "read" }
      : {
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
};

const SET_ASIDE = /^shelf\.unreadable-.*\.json$/u;

const ATTACHMENT_NAMES =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}/gu;

/**
 * The attachments that shelf files set aside as unreadable still name, so
 * they are never tidied away; null when one of those files can't be read.
 */
const namedBySetAside = async (
  fs: StoreFs,
  dir: string
): Promise<readonly string[] | null> => {
  try {
    const names = await fs.list(dir);
    const files = names.filter((name) => SET_ASIDE.test(name));

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
      .map(async (name) => {
        await fs.remove(path.join(attachments, name));
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

  const write = async (next: ShelfDoc): Promise<WriteResult> => {
    if (loaded.kind === "blocked") {
      return { message: BLOCKED_SAVE, ok: false };
    }

    const text = `${JSON.stringify(next, null, 2)}\n`;

    // The store never writes a file it could not read back on the next launch.
    if (parseShelfDocument(text) === null) {
      return {
        message:
          "The shelf could not be saved: an entry holds something the saved file can't keep. The last saved copy is unchanged.",
        ok: false,
      };
    }

    try {
      await fs.writeAtomic(path.join(dir, DOC_FILE), text);

      return { ok: true };
    } catch (error) {
      return {
        message: `The shelf could not be saved: ${error instanceof Error ? error.message : "unknown error"}`,
        ok: false,
      };
    }
  };

  // Each save waits for the one before; whichever runs first writes the newest document, the rest share its result.
  let queue: Promise<WriteResult> = Promise.resolve({ ok: true });
  let newest: ShelfDoc | null = null;
  let lastResult: WriteResult = { ok: true };

  const save = async (next: ShelfDoc): Promise<WriteResult> => {
    newest = next;

    const previous = queue;

    queue = (async () => {
      await previous;

      if (newest === null) {
        return lastResult;
      }

      const latest = newest;

      newest = null;
      lastResult = await write(latest);

      return lastResult;
    })();

    return await queue;
  };

  return {
    attachmentPath: (file) =>
      AttachmentFileSchema.safeParse(file).success
        ? path.join(attachments, file)
        : null,
    deleteAttachment: async (file) => {
      if (AttachmentFileSchema.safeParse(file).success) {
        await fs.remove(path.join(attachments, file));
      }
    },
    initial: loaded.doc,
    readOnly: loaded.kind === "blocked",
    recovered: loaded.kind === "read" ? null : loaded.note,
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

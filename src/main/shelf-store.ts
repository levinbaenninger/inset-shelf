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
  attachmentOf,
  AttachmentFileSchema,
  emptyShelf,
  parseShelfDocument,
} from "@shared/shelf";
import type { SectionId, ShelfDoc } from "@shared/shelf";

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
  /** Set when shelf.json could not be read and was set aside. */
  readonly recovered: string | null;
  /** Coalesces: while one write runs, only the newest pending document is written next. */
  readonly save: (doc: ShelfDoc) => Promise<WriteResult>;
  readonly writeAttachment: (png: Uint8Array) => Promise<string>;
  /** Copies a file the user added; returns its stored name with the given extension. */
  readonly copyAttachment: (from: string, extension: string) => Promise<string>;
  readonly deleteAttachment: (file: string) => Promise<void>;
  readonly attachmentPath: (file: string) => string | null;
}

interface Loaded {
  readonly doc: ShelfDoc;
  readonly recovered: string | null;
}

const load = async (
  fs: StoreFs,
  dir: string,
  newSectionId: () => SectionId,
  now: () => Date
): Promise<Loaded> => {
  const file = path.join(dir, DOC_FILE);
  let raw: string;

  try {
    raw = await fs.readFile(file);
  } catch {
    return { doc: emptyShelf(newSectionId()), recovered: null };
  }

  const doc = parseShelfDocument(raw);

  if (doc !== null) {
    return { doc, recovered: null };
  }

  const aside = `shelf.unreadable-${now().toISOString().replaceAll(":", "-")}.json`;

  await fs.rename(file, path.join(dir, aside));

  return {
    doc: emptyShelf(newSectionId()),
    recovered: `The saved shelf could not be read, so a new one was started. The old file was kept as ${aside}.`,
  };
};

/** Deletes attachment files the document no longer names, such as a removal that was not undone before quitting. */
const collectGarbage = async (
  fs: StoreFs,
  attachments: string,
  doc: ShelfDoc
): Promise<void> => {
  const used = new Set(
    doc.items.flatMap((item) => {
      const file = attachmentOf(item);

      return file === null ? [] : [file];
    })
  );

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

  const { doc, recovered } = await load(
    fs,
    dir,
    options.newSectionId,
    options.now
  );

  await collectGarbage(fs, attachments, doc);

  const write = async (next: ShelfDoc): Promise<WriteResult> => {
    try {
      await fs.writeAtomic(
        path.join(dir, DOC_FILE),
        `${JSON.stringify(next, null, 2)}\n`
      );

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
    initial: doc,
    recovered,
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

import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  emptyShelf,
  ItemIdSchema,
  SectionIdSchema,
  ShelfDocSchema,
} from "@shared/shelf";
import type { ShelfDoc } from "@shared/shelf";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { failNextWrite, nodeStoreFs, openShelfStore } from "./shelf-store";

const SECTION = SectionIdSchema.parse("3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1b01");

const options = {
  fs: nodeStoreFs,
  newSectionId: () => SECTION,
  now: () => new Date("2026-10-22T10:00:00.000Z"),
};

const withNote = (doc: ShelfDoc, text: string): ShelfDoc => ({
  ...doc,
  items: [
    ...doc.items,
    {
      color: null,
      context: null,
      createdAt: "2026-10-22T10:00:00.000Z",
      done: false,
      id: ItemIdSchema.parse(
        `3f1c2b9e-4a7d-4e21-9b0c-5d8e6f7a1b${String(doc.items.length + 10)}`
      ),
      kind: "text",
      sectionId: SECTION,
      text,
      via: "typed",
    },
  ],
});

describe(openShelfStore, () => {
  let dir = "";

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "shelf-store-"));
  });

  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  it("starts empty and reads back what it saved", async () => {
    const store = await openShelfStore(dir, options);

    expect(store.initial).toStrictEqual(emptyShelf(SECTION));
    await expect(
      store.save(withNote(store.initial, "keep"))
    ).resolves.toStrictEqual({ ok: true });

    const again = await openShelfStore(dir, options);

    expect(
      again.initial.items.map((item) => item.kind === "text" && item.text)
    ).toStrictEqual(["keep"]);
  });

  it("writes only the newest of several queued documents", async () => {
    const store = await openShelfStore(dir, options);
    const a = withNote(store.initial, "a");
    const b = withNote(a, "b");
    const c = withNote(b, "c");

    await Promise.all([store.save(a), store.save(b), store.save(c)]);

    const saved = ShelfDocSchema.parse(
      JSON.parse(await readFile(path.join(dir, "shelf.json"), "utf-8"))
    );

    const names = await readdir(dir);

    expect(saved.items).toHaveLength(3);
    expect(names.filter((name) => name.endsWith(".tmp"))).toStrictEqual([]);
  });

  it("sets an unreadable file aside and says so", async () => {
    await writeFile(path.join(dir, "shelf.json"), "{ not json");

    const store = await openShelfStore(dir, options);

    expect(store.initial.items).toStrictEqual([]);
    expect(store.recovered).toContain(
      "shelf.unreadable-2026-10-22T10-00-00.000Z.json"
    );
    await expect(readdir(dir)).resolves.toContain(
      "shelf.unreadable-2026-10-22T10-00-00.000Z.json"
    );
  });

  it("reports a failed write and keeps the previous file", async () => {
    const first = await openShelfStore(dir, options);

    await first.save(withNote(first.initial, "kept"));

    const store = await openShelfStore(dir, {
      ...options,
      fs: failNextWrite(nodeStoreFs),
    });

    const result = await store.save(withNote(store.initial, "lost"));

    const reopened = await openShelfStore(dir, options);

    expect(result.ok).toBeFalsy();
    expect(reopened.initial.items).toHaveLength(1);
  });

  it("deletes attachments the document no longer names, and nothing else", async () => {
    const store = await openShelfStore(dir, options);
    const file = await store.writeAttachment(new Uint8Array([1, 2, 3]));

    await mkdir(path.join(dir, "attachments"), { recursive: true });
    await writeFile(path.join(dir, "attachments", "notes.txt"), "mine");
    await openShelfStore(dir, options);

    await expect(readdir(path.join(dir, "attachments"))).resolves.toStrictEqual(
      ["notes.txt"]
    );
    expect(store.attachmentPath(file)).toBe(
      path.join(dir, "attachments", file)
    );
    expect(store.attachmentPath("../shelf.json")).toBeNull();
  });

  it("copies an added file under a generated name with its extension", async () => {
    const store = await openShelfStore(dir, options);
    const source = path.join(dir, "Quarterly report.pdf");

    await writeFile(source, "pdf bytes");

    const stored = await store.copyAttachment(source, "pdf");
    const copy = await readFile(path.join(dir, "attachments", stored), "utf-8");

    expect(stored).toMatch(/^[0-9a-f-]{36}\.pdf$/u);
    expect(copy).toBe("pdf bytes");
  });
});

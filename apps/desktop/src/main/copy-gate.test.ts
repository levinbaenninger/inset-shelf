import { emptyShelf, SectionIdSchema } from "@shared/shelf";
import { describe, expect, it, vi } from "vite-plus/test";

import { isConcealedClipboard, rawFormat } from "./clipboard-privacy";
import { createCopyGate } from "./copy-gate";
import type { ClipboardContents } from "./copy-gate";

type Item = ClipboardContents;

const gateWith = () => {
  const written: Item[][] = [];

  const clipboard = {
    clear: vi.fn<() => void>(),
    write: vi.fn<(items: Item[]) => Promise<void>>(async (items) => {
      written.push(items);
      await Promise.resolve();
    }),
  };

  const gate = createCopyGate<Item>({
    clipboard,
    copyState: () => ({ kind: "saved" }),
    discards: () => 0,
    onWrite: () => {},
    persisted: async () => await Promise.resolve({ ok: true }),
    readOnly: true,
    snapshot: () => ({
      doc: emptyShelf(
        SectionIdSchema.parse("00000000-0000-4000-8000-000000000001")
      ),
      rev: 1,
    }),
    toItem: (data) => data,
  });

  return { clipboard, gate, written };
};

describe("restore", () => {
  it("puts a private clipboard back with its marks, as one item, never as plain text", async () => {
    const { gate, written } = gateWith();

    const concealed = rawFormat("org.nspasteboard.ConcealedType");

    const saved: ClipboardContents = {
      [concealed]: new Blob([""]),
      "text/plain": new Blob(["hunter2"]),
    };

    await gate.restore([saved]);

    expect(written).toHaveLength(1);
    expect(written[0]).toHaveLength(1);

    const [restored] = written[0] ?? [];
    const types = Object.keys(restored ?? {});

    expect(types).toStrictEqual(["text/plain", concealed].toSorted());
    expect(isConcealedClipboard(types)).toBeTruthy();
  });

  it("keeps the Windows marks too", async () => {
    const { gate, written } = gateWith();

    const history = rawFormat("CanIncludeInClipboardHistory");

    await gate.restore([
      {
        [history]: new Blob([new Uint8Array(4)]),
        "text/plain": new Blob(["secret"]),
      },
    ]);

    expect(Object.keys(written[0]?.[0] ?? {})).toContain(history);
  });

  it("clears an empty clipboard instead of writing it", async () => {
    const { clipboard, gate, written } = gateWith();

    await gate.restore([{}]);

    expect(clipboard.clear).toHaveBeenCalledOnce();
    expect(written).toHaveLength(0);
  });
});

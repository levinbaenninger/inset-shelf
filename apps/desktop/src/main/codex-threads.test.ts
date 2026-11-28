import { describe, expect, it } from "vite-plus/test";

import { parseThreadIndex, threadNamed } from "./codex-threads";

const INDEX = [
  '{"id":"019d0d00-a87b-78a3-b06e-39efae806c96","thread_name":"Plan","updated_at":"2026-03-20T20:51:32Z"}',
  "not json",
  '{"id":"01a0a981-8186-7a92-af7d-c414d6adda1a","thread_name":"Plan","updated_at":"2026-09-16T09:17:54Z"}',
  '{"id":"bad","thread_name":"Other","updated_at":"2026-09-16T09:17:54Z"}',
].join("\n");

const line = (id: string) =>
  JSON.stringify({ id, thread_name: "T", updated_at: "x" });

describe(parseThreadIndex, () => {
  it("keeps only real UUID thread ids", () => {
    const threads = parseThreadIndex(
      [
        line("019d0d00-a87b-78a3-b06e-39efae806c96"),
        line("-".repeat(36)),
        line("019d0d00a87b78a3b06e39efae806c96----"),
        line("019d0d00-a87b-78a3-b06e-39efae806c9?"),
      ].join("\n")
    );

    expect(threads.map((thread) => thread.id)).toStrictEqual([
      "019d0d00-a87b-78a3-b06e-39efae806c96",
    ]);
  });
});

describe(threadNamed, () => {
  it("finds the latest thread with the window's title, skipping lines it can't read", () => {
    const threads = parseThreadIndex(INDEX);

    expect(threads).toHaveLength(2);
    expect(threadNamed(threads, "Plan")).toBe(
      "01a0a981-8186-7a92-af7d-c414d6adda1a"
    );
    expect(threadNamed(threads, "Other")).toBeNull();
  });
});

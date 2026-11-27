import { describe, expect, it } from "vite-plus/test";

import { parseThreadIndex, threadNamed, threadOfWindow } from "./codex-threads";

const INDEX = [
  '{"id":"019d0d00-a87b-78a3-b06e-39efae806c96","thread_name":"Plan","updated_at":"2026-03-20T20:51:32Z"}',
  "not json",
  '{"id":"01a0a981-8186-7a92-af7d-c414d6adda1a","thread_name":"Plan","updated_at":"2026-09-16T09:17:54Z"}',
  '{"id":"bad","thread_name":"Other","updated_at":"2026-09-16T09:17:54Z"}',
].join("\n");

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

describe(threadOfWindow, () => {
  // Windows ends a window's title with the app's name; the shelf keeps the title as read, and items kept before kept it without.
  it("finds the thread from the title as the window has it or without ChatGPT's name", () => {
    const threads = parseThreadIndex(INDEX);

    expect(threadOfWindow(threads, "Plan - ChatGPT")).toBe(
      "01a0a981-8186-7a92-af7d-c414d6adda1a"
    );
    expect(threadOfWindow(threads, "Plan")).toBe(
      "01a0a981-8186-7a92-af7d-c414d6adda1a"
    );
    expect(threadOfWindow(threads, "Other - ChatGPT")).toBeNull();
  });
});

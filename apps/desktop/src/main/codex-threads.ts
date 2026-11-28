import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { withoutAppName } from "@shared/window-title";
import { z } from "zod";

const ThreadSchema = z.object({
  id: z.string().regex(/^[\da-f-]{36}$/u),
  thread_name: z.string(),
  updated_at: z.string(),
});

type Thread = z.output<typeof ThreadSchema>;

/** The threads in the index, one JSON object per line; lines it can't read are skipped. */
export const parseThreadIndex = (text: string): readonly Thread[] =>
  text.split("\n").flatMap((line) => {
    try {
      const parsed = ThreadSchema.safeParse(JSON.parse(line));

      return parsed.success ? [parsed.data] : [];
    } catch {
      return [];
    }
  });

/** The most recently updated thread with this exact title, or null. */
export const threadNamed = (
  threads: readonly Thread[],
  title: string
): string | null =>
  threads
    .filter((thread) => thread.thread_name === title)
    .toSorted((a, b) => b.updated_at.localeCompare(a.updated_at))[0]?.id ??
  null;

/**
 * The thread a ChatGPT window shows: found by its title as read, or without
 * the app's name Windows adds to it, which items kept by an earlier build
 * also lack. Null when both name a thread: `Plan - ChatGPT` is then thread
 * Plan as Windows shows it, or the thread of that name, and nothing says which.
 */
export const threadOfWindow = (
  threads: readonly Thread[],
  title: string
): string | null => {
  const asRead = threadNamed(threads, title);
  const bare = withoutAppName(title, "ChatGPT");
  const shown = bare === title ? null : threadNamed(threads, bare);

  return asRead !== null && shown !== null ? null : (asRead ?? shown);
};

/**
 * The ChatGPT desktop app (built on Codex) names its window after the open
 * thread, and lists its threads with their titles in ~/.codex. A thread found
 * by its title opens again with a codex:// link; null when there is none.
 */
export const chatGptThreadLink = async (
  title: string | null
): Promise<string | null> => {
  if (title === null) {
    return null;
  }

  try {
    const text = await readFile(
      path.join(homedir(), ".codex", "session_index.jsonl"),
      "utf-8"
    );

    const id = threadOfWindow(parseThreadIndex(text), title);

    return id === null ? null : `codex://threads/${id}`;
  } catch {
    return null;
  }
};

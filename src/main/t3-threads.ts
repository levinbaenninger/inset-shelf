import { spawn } from "node:child_process";
import { once } from "node:events";
import { homedir } from "node:os";
import path from "node:path";

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/u;

/** T3 Code's stores, newest first, and the table each keeps its threads in. */
const STORES = [
  ["statev2.sqlite", "orchestration_v2_projection_threads"],
  ["state.sqlite", "projection_threads"],
] as const;

const TIMEOUT_MS = 1500;

/** One value from a read-only query, or "" when there is none. */
const queryOne = async (database: string, sql: string): Promise<string> => {
  try {
    const child = spawn(
      "/usr/bin/sqlite3",
      ["-readonly", `file:${database}?mode=ro`, sql],
      { stdio: ["ignore", "pipe", "ignore"], timeout: TIMEOUT_MS }
    );

    child.stdout.setEncoding("utf-8");

    let output = "";

    for await (const chunk of child.stdout) {
      output += String(chunk);
    }

    await once(child, "close");

    return child.exitCode === 0 ? output.trim() : "";
  } catch {
    return "";
  }
};

/**
 * The title of a T3 Code thread, read from T3 Code's own database on this
 * Mac, without changing it. Null when it can't be read.
 */
export const t3ThreadTitle = async (thread: string): Promise<string | null> => {
  // Only a UUID ever reaches the query.
  if (!UUID.test(thread)) {
    return null;
  }

  const folder = path.join(homedir(), ".t3", "userdata");

  for (const [file, table] of STORES) {
    // oxlint-disable-next-line no-await-in-loop -- the older store is only asked when the newer has no answer.
    const title = await queryOne(
      path.join(folder, file),
      `select title from ${table} where thread_id = '${thread}' and deleted_at is null limit 1;`
    );

    if (title !== "") {
      return title.split("\n")[0] ?? null;
    }
  }

  return null;
};

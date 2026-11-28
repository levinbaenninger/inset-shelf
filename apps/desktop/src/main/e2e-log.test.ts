import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

// Electron's native side doesn't load under Node. Only it is faked: a log line counts the visible windows, and there are none.
// oxlint-disable-next-line anti-slop/no-module-mocking, vitest/prefer-import-in-mock -- e2eLog reads BrowserWindow itself, and the fake has only what it calls.
vi.mock("electron", () => ({ BrowserWindow: { getAllWindows: () => [] } }));

describe("the trial's log", () => {
  const folder = mkdtempSync(path.join(tmpdir(), "inset-e2e-log-"));

  afterEach(() => {
    rmSync(folder, { force: true, recursive: true });
    vi.unstubAllEnvs();
  });

  it("never throws into what the app was doing when its file can't be written", async () => {
    // A folder that isn't there: the disk refuses the append.
    vi.stubEnv("INSET_E2E_LOG", path.join(folder, "gone", "events.jsonl"));

    const { e2eLog } = await import("./e2e-log");

    expect(() => {
      e2eLog("shotDropped", { to: "item" });
    }).not.toThrow();
  });
});

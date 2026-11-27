import { mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vite-plus/test";

import { createDragStaging } from "./exports";

// Staging never draws a picture.
vi.mock(import("electron"), () => ({}));

describe(createDragStaging, () => {
  it("knows its own files however a drop spells the temporary folder, so a drag back onto the shelf adds nothing", () => {
    const real = realpathSync.native(
      mkdtempSync(path.join(tmpdir(), "inset-staging-"))
    );

    // macOS keeps temporary files under /var, a link to /private/var: the app is handed one spelling, a drop can name the other.
    const link = `${real}-link`;

    symlinkSync(real, link);

    const staging = createDragStaging(link);

    const file = staging.write(
      "screenshot-drag-1",
      "Screenshot.png",
      new Uint8Array([137, 80, 78, 71])
    );

    expect({
      other: staging.contains(path.join(real, "Screenshot.png")),
      real: staging.contains(realpathSync.native(file)),
      written: staging.contains(file),
    }).toStrictEqual({ other: false, real: true, written: true });
  });
});

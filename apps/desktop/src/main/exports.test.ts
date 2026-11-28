import {
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vite-plus/test";

import { createDragStaging, createShotStaging } from "./exports";

// Staging never draws a picture.
vi.mock(import("electron"), () => ({}));

describe(createDragStaging, () => {
  it("knows its own files however a drop spells the temporary folder, so a drag back onto the shelf adds nothing", () => {
    const real = realpathSync.native(
      mkdtempSync(path.join(tmpdir(), "inset-staging-"))
    );

    // macOS keeps temporary files under /var, a link to /private/var: the app is handed one spelling, a drop can name the other.
    const link = `${real}-link`;

    // A junction on Windows, which needs no rights to make; other systems ignore the type.
    symlinkSync(real, link, "junction");

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

  it("knows its own file dropped through a link to its folder from elsewhere, and a file of its own already removed", () => {
    const staging = createDragStaging(
      mkdtempSync(path.join(tmpdir(), "inset-staging-"))
    );

    const file = staging.write(
      "item-1",
      "Offer.png",
      new Uint8Array([137, 80, 78, 71])
    );

    // A link on the Desktop to the shelf's staging folder: a drop names the file through it.
    const root = path.dirname(path.dirname(file));

    const link = path.join(
      mkdtempSync(path.join(tmpdir(), "inset-desktop-")),
      "stage-link"
    );

    symlinkSync(root, link, "junction");

    const linked = staging.contains(path.join(link, "item-1", "Offer.png"));

    rmSync(file);
    expect({ linked, removed: staging.contains(file) }).toStrictEqual({
      linked: true,
      removed: true,
    });
  });
});

const PNG = new Uint8Array([137, 80, 78, 71]);

describe(createShotStaging, () => {
  it("removes a drag's copy with its folder, and keeps a file another app saved beside the copy, folder and all", () => {
    const staging = createShotStaging(
      mkdtempSync(path.join(tmpdir(), "inset-staging-"))
    );

    const alone = staging.write("drag-1", "Screenshot.png", PNG);
    const copy = staging.write("drag-2", "Screenshot.png", PNG);
    // Preview's Save As puts the user's file beside the copy it opened.
    const theirs = path.join(path.dirname(copy), "Screenshot marked.png");

    writeFileSync(theirs, PNG);
    staging.remove(alone);
    staging.remove(copy);
    expect({
      alone: existsSync(path.dirname(alone)),
      copy: existsSync(copy),
      theirs: existsSync(theirs),
    }).toStrictEqual({ alone: false, copy: false, theirs: true });
  });

  it("keeps its copies out of the shelf's own staging, which is swept whole at startup and at quit", () => {
    const temp = mkdtempSync(path.join(tmpdir(), "inset-staging-"));
    const copy = createShotStaging(temp).write("drag-1", "Screenshot.png", PNG);
    const shelf = createDragStaging(temp);

    shelf.write("item-1", "Offer.png", PNG);
    shelf.clear();
    expect({
      copy: existsSync(copy),
      filtered: shelf.contains(copy),
    }).toStrictEqual({
      copy: true,
      filtered: false,
    });
  });
});

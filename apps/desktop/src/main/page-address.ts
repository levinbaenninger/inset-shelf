import { spawn } from "node:child_process";
import { once } from "node:events";

import { z } from "zod";

/** What every accessibility script starts with: the AX calls and a reader for one attribute. */
export const AX_PRELUDE = `
ObjC.import("AppKit");
ObjC.bindFunction("AXUIElementCreateApplication", ["id", ["int"]]);
ObjC.bindFunction("AXUIElementCopyAttributeValue", ["int", ["id", "id", "id *"]]);
function attr(element, name) {
  var out = Ref();
  return $.AXUIElementCopyAttributeValue(element, $(name), out) === 0 ? out[0] : null;
}
`;

/**
 * Reads an app's focused window from its accessibility tree: the file it
 * shows (AXDocument), and its web areas, each one's address (AXURL) and
 * title. The areas find pages that get-windows can't, such as Firefox, Zen
 * and apps built on web views (Claude, T3 Code). An app's own shell can come
 * first, with a page in a second web area, so all of them are returned, in
 * tree order. Runs as JavaScript for Automation, so it needs no helper
 * binary; it only works once Inset Shelf has Accessibility access, which
 * double Shift needs too.
 */
const SCRIPT = `${AX_PRELUDE}
function run(argv) {
  var root = $.AXUIElementCreateApplication(Number(argv[0]));
  function text(value) {
    return value ? String(ObjC.unwrap(value)) : "";
  }
  var window = attr(root, "AXFocusedWindow");
  var named = window ? attr(window, "AXDocument") : null;
  var unwrapped = named ? ObjC.unwrap(named) : "";
  var document = typeof unwrapped === "string" ? unwrapped : named ? text(named.absoluteString) : "";
  var queue = window ? [window] : [];
  var areas = [];
  for (var seen = 0; queue.length > 0 && seen < 3000 && areas.length < 5; seen++) {
    var element = queue.shift();
    if (text(attr(element, "AXRole")) === "AXWebArea") {
      var url = attr(element, "AXURL");
      areas.push({ title: text(attr(element, "AXTitle")), url: url ? text(url.absoluteString) : "" });
    }
    var children = attr(element, "AXChildren");
    var count = children ? children.count : 0;
    for (var i = 0; i < count; i++) queue.push(children.objectAtIndex(i));
  }
  return JSON.stringify({ areas: areas, document: document });
}
`;

const TIMEOUT_MS = 1500;

const WebAreasSchema = z.array(
  z.object({ title: z.string().max(500), url: z.string().max(2000) })
);

export type WebArea = z.output<typeof WebAreasSchema>[number];

/** What the focused window shows: its web areas, and its document as the system named it, a `file://` address. */
export interface FocusedWindow {
  readonly areas: readonly WebArea[];
  readonly document: string | null;
}

export const NO_WINDOW: FocusedWindow = { areas: [], document: null };

/** The script's answer. Each part is read on its own, so an odd document never costs the page. */
const AnswerSchema = z.object({
  areas: WebAreasSchema.catch([]),
  document: z.string().min(1).nullable().catch(null),
});

export const parseFocusedWindow = (output: string): FocusedWindow => {
  try {
    const parsed = AnswerSchema.safeParse(JSON.parse(output));

    return parsed.success ? parsed.data : NO_WINDOW;
  } catch {
    return NO_WINDOW;
  }
};

/** Runs a JavaScript for Automation script and gives what it printed, or null when it failed or timed out. */
export const runAutomation = async (
  script: string,
  args: readonly string[]
): Promise<string | null> => {
  try {
    const child = spawn(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", script, ...args],
      { stdio: ["ignore", "pipe", "ignore"], timeout: TIMEOUT_MS }
    );

    child.stdout.setEncoding("utf-8");

    let output = "";

    for await (const chunk of child.stdout) {
      output += String(chunk);
    }

    await once(child, "close");

    return child.exitCode === 0 ? output.trim() : null;
  } catch {
    return null;
  }
};

/** What the app's focused window shows, or nothing. macOS only. */
export const readFocusedWindow = async (
  pid: number
): Promise<FocusedWindow> => {
  const output = await runAutomation(SCRIPT, [String(pid)]);

  return output === null ? NO_WINDOW : parseFocusedWindow(output);
};

import { spawn } from "node:child_process";
import { once } from "node:events";

import { z } from "zod";

/**
 * Reads the web areas in an app's focused window from its accessibility
 * tree: each one's address (AXURL) and title. This finds pages that
 * get-windows can't, such as Firefox, Zen and apps built on web views
 * (Claude, T3 Code). An app's own shell can come first, with a page in a
 * second web area, so all of them are returned, in tree order.
 * Runs as JavaScript for Automation, so it needs no helper binary; it only
 * works once Inset Shelf has Accessibility access, which double Shift needs too.
 */
const SCRIPT = `
ObjC.import("AppKit");
ObjC.bindFunction("AXUIElementCreateApplication", ["id", ["int"]]);
ObjC.bindFunction("AXUIElementCopyAttributeValue", ["int", ["id", "id", "id *"]]);
function run(argv) {
  var root = $.AXUIElementCreateApplication(Number(argv[0]));
  function attr(element, name) {
    var out = Ref();
    return $.AXUIElementCopyAttributeValue(element, $(name), out) === 0 ? out[0] : null;
  }
  function text(value) {
    return value ? String(ObjC.unwrap(value)) : "";
  }
  var window = attr(root, "AXFocusedWindow");
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
  return JSON.stringify(areas);
}
`;

const TIMEOUT_MS = 1500;

const WebAreasSchema = z.array(
  z.object({ title: z.string().max(500), url: z.string().max(2000) })
);

export type WebArea = z.output<typeof WebAreasSchema>[number];

const parseAreas = (output: string): readonly WebArea[] => {
  try {
    const parsed = WebAreasSchema.safeParse(JSON.parse(output));

    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
};

/** The web areas in the app's focused window, or none. macOS only. */
export const readWebAreas = async (
  pid: number
): Promise<readonly WebArea[]> => {
  try {
    const child = spawn(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", SCRIPT, String(pid)],
      { stdio: ["ignore", "pipe", "ignore"], timeout: TIMEOUT_MS }
    );

    child.stdout.setEncoding("utf-8");

    let output = "";

    for await (const chunk of child.stdout) {
      output += String(chunk);
    }

    await once(child, "close");

    return child.exitCode === 0 ? parseAreas(output.trim()) : [];
  } catch {
    return [];
  }
};

import { fileURLToPath } from "node:url";

import { systemPreferences } from "electron";
import { z } from "zod";

import { AX_PRELUDE, runAutomation } from "./page-address";

/**
 * Reads the file (AXDocument) and the web page (the first AXWebArea's AXURL)
 * a window shows, from its app's accessibility tree, as Inset Window Links
 * does (src/main/capture/origin.ts there). The window is the one window with
 * the given title; when none or two match, it answers nothing. Runs as
 * JavaScript for Automation, needs Accessibility, and never asks for it.
 */
const SCRIPT = `${AX_PRELUDE}
function run(argv) {
  var root = $.AXUIElementCreateApplication(Number(argv[0]));
  var wanted = argv[1] || "";
  var matches = 0;
  function text(value) {
    if (!value) return "";
    var unwrapped = ObjC.unwrap(value);
    return typeof unwrapped === "string" ? unwrapped : String(ObjC.unwrap(value.absoluteString) || "");
  }
  var window = null;
  var windows = attr(root, "AXWindows");
  var count = windows ? windows.count : 0;
  for (var i = 0; i < count && wanted !== ""; i++) {
    if (text(attr(windows.objectAtIndex(i), "AXTitle")) === wanted) {
      window = windows.objectAtIndex(i);
      matches++;
    }
  }
  if (matches !== 1 || !window) return JSON.stringify({ document: "", url: "" });
  var document = text(attr(window, "AXDocument"));
  var url = "";
  var queue = document === "" ? [window] : [];
  for (var seen = 0; queue.length > 0 && seen < 3000 && url === ""; seen++) {
    var element = queue.shift();
    if (text(attr(element, "AXRole")) === "AXWebArea") {
      url = text(attr(element, "AXURL"));
    }
    var children = attr(element, "AXChildren");
    var n = children ? children.count : 0;
    for (var j = 0; j < n; j++) queue.push(children.objectAtIndex(j));
  }
  return JSON.stringify({ document: document, url: url });
}
`;

const MAX_URL = 2000;
const MAX_PATH = 1024;

const AnswerSchema = z.object({
  document: z.string().max(4000),
  url: z.string().max(4000),
});

/** Only http and https pages are kept, so nothing else can be opened again later. */
export const webPage = (raw: string | undefined | null): string | null => {
  if (raw === undefined || raw === null || raw.length > MAX_URL) {
    return null;
  }

  try {
    const url = new URL(raw.trim());

    // The address as kept can grow (encoding, a trailing slash); one cut short is no link.
    return (url.protocol === "http:" || url.protocol === "https:") &&
      url.href.length <= MAX_URL
      ? url.href
      : null;
  } catch {
    return null;
  }
};

/** A file URL from AXDocument, as a path. Anything else is dropped. */
export const documentPath = (raw: string): string | null => {
  if (!raw.startsWith("file://")) {
    return null;
  }

  try {
    const file = fileURLToPath(raw);

    return file.length <= MAX_PATH ? file : null;
  } catch {
    return null;
  }
};

/** The app bundle a process runs from, so a nested helper still brings its app forward. */
export const appBundle = (raw: string | undefined): string | null => {
  if (raw === undefined || raw === "" || raw.length > MAX_PATH) {
    return null;
  }

  if (process.platform !== "darwin") {
    return raw;
  }

  const end = raw.indexOf(".app");

  return end === -1 ? null : raw.slice(0, end + ".app".length);
};

const ask = async (
  pid: number,
  title: string
): Promise<z.infer<typeof AnswerSchema> | null> => {
  const output = await runAutomation(SCRIPT, [String(pid), title]);

  if (output === null) {
    return null;
  }

  try {
    const parsed = AnswerSchema.safeParse(JSON.parse(output));

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

export interface WindowOrigin {
  readonly url: string | null;
  readonly document: string | null;
}

const NONE: WindowOrigin = { document: null, url: null };

/** The page or file a window shows, on macOS with Accessibility; nothing elsewhere or without it. */
export const readWindowOrigin = async (window: {
  readonly pid: number;
  readonly title: string | null;
  readonly knownUrl: string | null;
}): Promise<WindowOrigin> => {
  const known = webPage(window.knownUrl);

  if (known !== null) {
    return { document: null, url: known };
  }

  if (
    process.platform !== "darwin" ||
    window.title === null ||
    !systemPreferences.isTrustedAccessibilityClient(false)
  ) {
    return NONE;
  }

  const answer = await ask(window.pid, window.title);

  return answer === null
    ? NONE
    : { document: documentPath(answer.document), url: webPage(answer.url) };
};

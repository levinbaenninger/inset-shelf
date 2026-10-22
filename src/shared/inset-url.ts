import { ImageFileSchema } from "./shelf";

export const INSET_SCHEME = "inset";
export const APP_ORIGIN = "inset://app";

export type PageName = "shelf" | "overlay" | "toast" | "drawing" | "settings";

export type InsetRequest =
  | { readonly kind: "app"; readonly path: string }
  | { readonly kind: "attachment"; readonly file: string }
  | { readonly kind: "frame"; readonly token: string };

const FRAME_TOKEN = /^[a-z0-9]{1,40}$/u;

// Checked on the raw string: URL parsing would resolve dot segments (including %2e) first.
const UNSAFE_RAW = /\.\.|%2e|%2f|%5c|\\|\?|#/iu;
const FILE_SEGMENT = /^[\w-][\w.-]*$/u;

export const insetUrl = {
  attachment: (file: string): string => `${INSET_SCHEME}://attachment/${file}`,
  /** The frozen screen behind the area overlay; the token changes with every capture. */
  frame: (token: string): string => `${INSET_SCHEME}://frame/${token}`,
  page: (name: PageName): string => `${APP_ORIGIN}/${name}.html`,
};

const single = (segments: readonly string[]): string | null => {
  const [only, ...rest] = segments;

  return rest.length === 0 && only !== undefined ? only : null;
};

export const parseInsetUrl = (raw: string): InsetRequest | null => {
  if (UNSAFE_RAW.test(raw)) {
    return null;
  }

  const url = URL.parse(raw);

  if (
    url === null ||
    url.protocol !== `${INSET_SCHEME}:` ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== ""
  ) {
    return null;
  }

  const segments = url.pathname.split("/").slice(1);

  if (url.host === "app") {
    return segments.length > 0 &&
      segments.every((segment) => FILE_SEGMENT.test(segment))
      ? { kind: "app", path: segments.join("/") }
      : null;
  }

  const name = single(segments);

  if (name === null) {
    return null;
  }

  if (url.host === "attachment") {
    return ImageFileSchema.safeParse(name).success
      ? { file: name, kind: "attachment" }
      : null;
  }

  return url.host === "frame" && FRAME_TOKEN.test(name)
    ? { kind: "frame", token: name }
    : null;
};

/** Built by hand because the WHATWG origin of a custom scheme is "null". */
export const originOf = (raw: string): string | null => {
  const url = URL.parse(raw);

  return url === null ? null : `${url.protocol}//${url.host}`;
};

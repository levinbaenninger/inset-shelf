import { randomUUID } from "node:crypto";

import type { WindowCandidate } from "@shared/contracts";
import { WindowIdSchema } from "@shared/shelf";
import type { WindowRef } from "@shared/shelf";
import { desktopCapturer, systemPreferences } from "electron";
import type { DesktopCapturerSource } from "electron";
import { openWindows } from "get-windows";

import { appBundle, readWindowOrigin } from "./window-origin";
import { windowRef } from "./window-ref";

/** The picker's previews: small enough to list a dozen windows quickly. */
const CANDIDATE_THUMB = { height: 200, width: 320 };

/** A linked window's picture: enough to recognise it in details. */
const LINK_THUMB = { height: 720, width: 1152 };

const isMac = process.platform === "darwin";

type Listed = Awaited<ReturnType<typeof openWindows>>[number];

/** desktopCapturer names a window "window:<id>:0"; the id is the CGWindowID or the HWND. */
const sourceWindowId = (sourceId: string): number | null => {
  const match = /^window:(?<id>\d+):/u.exec(sourceId);
  const id = Number(match?.groups?.id);

  return Number.isSafeInteger(id) ? id : null;
};

const UINT32 = 2 ** 32;

/** A window number as unsigned: get-windows reports a HWND as signed, the capturer as unsigned. */
const unsigned = (id: number): number => (id < 0 ? id + UINT32 : id);

const sameWindow = (listed: Listed, id: number): boolean =>
  unsigned(listed.id) === unsigned(id);

const orNull = (text: string | undefined): string | null =>
  text === undefined || text.trim() === "" ? null : text.trim();

const listedWindows = async (): Promise<readonly Listed[]> => {
  try {
    return await openWindows({
      accessibilityPermission:
        !isMac || systemPreferences.isTrustedAccessibilityClient(false),
      screenRecordingPermission: true,
    });
  } catch {
    return [];
  }
};

interface Candidate {
  readonly sourceId: string;
  readonly listed: Listed | undefined;
  readonly title: string | null;
}

export interface WindowLinker {
  /** The open windows, other than Inset's own, with a small picture of each. */
  readonly list: () => Promise<readonly WindowCandidate[]>;
  /** Captures the chosen windows as links, in the order chosen, writing their pictures. */
  readonly capture: (ids: readonly string[]) => Promise<readonly WindowRef[]>;
}

export const createWindowLinker = (deps: {
  /** desktopCapturer ids of Inset's own windows, never offered. */
  readonly ownSourceIds: () => ReadonlySet<string>;
  readonly writeAttachment: (png: Uint8Array) => Promise<string>;
  readonly now: () => Date;
}): WindowLinker => {
  let candidates = new Map<string, Candidate>();

  const sources = async (
    size: typeof CANDIDATE_THUMB
  ): Promise<readonly DesktopCapturerSource[]> => {
    const own = deps.ownSourceIds();

    const all = await desktopCapturer.getSources({
      fetchWindowIcons: false,
      thumbnailSize: size,
      types: ["window"],
    });

    return all.filter(
      (source) => !own.has(source.id) && !source.thumbnail.isEmpty()
    );
  };

  return {
    capture: async (ids) => {
      const chosen = ids.flatMap((id) => {
        const candidate = candidates.get(id);

        return candidate === undefined ? [] : [candidate];
      });

      if (chosen.length === 0) {
        return [];
      }

      const [large, listed] = await Promise.all([
        sources(LINK_THUMB),
        listedWindows(),
      ]);

      const links = await Promise.all(
        chosen.map(async (candidate): Promise<WindowRef> => {
          const source = large.find((found) => found.id === candidate.sourceId);
          const windowId = sourceWindowId(candidate.sourceId);

          const window =
            windowId === null
              ? candidate.listed
              : (listed.find((found) => sameWindow(found, windowId)) ??
                candidate.listed);

          // The full title: the accessibility lookup matches it exactly.
          const title = orNull(source?.name) ?? candidate.title;

          const origin =
            window === undefined
              ? { document: null, url: null }
              : await readWindowOrigin({
                  knownUrl: "url" in window ? (window.url ?? null) : null,
                  pid: window.owner.processId,
                  title,
                });

          const png = source?.thumbnail.toPNG();
          const size = source?.thumbnail.getSize();

          return windowRef(
            {
              app: orNull(window?.owner.name),
              appPath: appBundle(window?.owner.path),
              document: origin.document,
              thumb:
                png === undefined || size === undefined
                  ? null
                  : {
                      file: await deps.writeAttachment(png),
                      heightPx: Math.max(1, size.height),
                      pixelsPerDip: 1,
                      widthPx: Math.max(1, size.width),
                    },
              title,
              url: origin.url,
            },
            WindowIdSchema.parse(randomUUID()),
            deps.now()
          );
        })
      );

      return links;
    },
    list: async () => {
      const [found, listed] = await Promise.all([
        sources(CANDIDATE_THUMB),
        listedWindows(),
      ]);

      candidates = new Map(
        found.map((source) => {
          const windowId = sourceWindowId(source.id);

          return [
            randomUUID(),
            {
              listed:
                windowId === null
                  ? undefined
                  : listed.find((window) => sameWindow(window, windowId)),
              sourceId: source.id,
              title: orNull(source.name),
            },
          ];
        })
      );

      return [...candidates.entries()].map(([id, candidate]) => {
        const source = found.find((each) => each.id === candidate.sourceId);

        return {
          app: orNull(candidate.listed?.owner.name),
          id,
          thumb: source?.thumbnail.toDataURL() ?? "",
          title: candidate.title,
        };
      });
    },
  };
};

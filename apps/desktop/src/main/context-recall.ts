import type { Rect } from "@shared/geometry";
import {
  hasPlaces,
  holdsPagesFrom,
  INITIAL_RECALL,
  itemsFrom,
  placeOf,
  stepRecall,
} from "@shared/recall";
import type { PlaceKey, RecallState } from "@shared/recall";
import type { ItemId, ShelfDoc } from "@shared/shelf";
import { sourceLabel } from "@shared/web-source";

import { createFrontWatch } from "./front-watch";
import type { Activity, FrontRead } from "./front-watch";

/**
 * Context recall in main: the watcher feeds the matching rule and the
 * when-to-show reducer, and a "show" becomes the recall pill. What it
 * remembers about places lives in memory only.
 */

export interface Recalled {
  readonly place: PlaceKey;
  readonly ids: readonly ItemId[];
  readonly label: string;
  readonly window: Rect<"screen"> | null;
}

export interface ContextRecall {
  readonly activity: (kind: Activity) => void;
  /** The recall pill went, and how. */
  readonly ended: (
    place: PlaceKey,
    how: "opened" | "dismissed" | "ignored"
  ) => void;
  /** Starts or stops the watcher to match the setting. */
  readonly sync: () => void;
}

export const createContextRecall = (deps: {
  readonly doc: () => ShelfDoc;
  /** The setting is on, and the system lets the front window's title or address be read. */
  readonly enabled: () => boolean;
  /** An Inset window or the pill shows, or a capture runs: no pill now. */
  readonly busy: () => boolean;
  readonly probe: (address: boolean) => Promise<FrontRead | null>;
  readonly now: () => number;
  readonly setTimer: (run: () => void, ms: number) => () => void;
  readonly idleSeconds: () => number;
  readonly show: (recalled: Recalled) => void;
}): ContextRecall => {
  let state: RecallState = INITIAL_RECALL;

  const watch = createFrontWatch({
    allowed: () => deps.enabled() && !deps.busy() && hasPlaces(deps.doc()),
    idleSeconds: deps.idleSeconds,
    onArrived: ({ bounds, source }) => {
      const ids = itemsFrom(deps.doc(), source);
      const place = placeOf(source);

      const step = stepRecall(state, {
        at: deps.now(),
        ids,
        place,
        type: "arrived",
      });

      ({ state } = step);

      if (step.show && place !== null) {
        deps.show({
          ids,
          label: sourceLabel(source).label,
          place,
          window: bounds,
        });
      }
    },
    probe: deps.probe,
    setTimer: deps.setTimer,
    wantsAddress: (app) => holdsPagesFrom(deps.doc(), app),
  });

  return {
    activity: watch.activity,
    ended: (place, how) => {
      ({ state } = stepRecall(state, { how, place, type: "ended" }));
    },
    sync: () => {
      if (deps.enabled()) {
        watch.start();
      } else {
        watch.stop();
      }
    },
  };
};

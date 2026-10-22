import type { OverlayView } from "@shared/contracts";
import { CLICK_SLOP_DIP, dragRect, pt } from "@shared/geometry";
import type { Point, Rect } from "@shared/geometry";
import { useState } from "react";
import type { PointerEvent } from "react";

import { Kbd } from "@/components/ui/kbd";
import { overlayBridge } from "@/shared/bridge";
import { useLocalKeys } from "@/shared/keys";
import { usePushedView } from "@/shared/use-pushed-view";

const api = overlayBridge();

const load = async (): Promise<OverlayView | null> => await api.getView();

const subscribe = (listener: (view: OverlayView | null) => void) =>
  api.on("view", listener);

const pointOf = (event: PointerEvent<HTMLElement>): Point<"screen"> =>
  pt(event.clientX, event.clientY);

const moved = (from: Point<"screen">, to: Point<"screen">): boolean =>
  Math.hypot(to.x - from.x, to.y - from.y) >= CLICK_SLOP_DIP;

/** Shows the area being dragged at full brightness and dims the rest of the frozen screen. */
const Selection = ({ area }: { readonly area: Rect<"screen"> }) => (
  <div
    className="overlay-selection"
    style={{
      "--area-h": `${area.height}px`,
      "--area-w": `${area.width}px`,
      "--area-x": `${area.x}px`,
      "--area-y": `${area.y}px`,
    }}
  >
    <span className="overlay-size">
      {Math.round(area.width)} × {Math.round(area.height)}
    </span>
  </div>
);

const Hint = () => (
  <output className="overlay-hint">
    <span>Drag to keep an area</span>
    <span aria-hidden="true">·</span>
    <span>Click to pin a spot</span>
    <span aria-hidden="true">·</span>
    <span>
      <Kbd>Esc</Kbd> cancels
    </span>
  </output>
);

interface Drag {
  readonly from: Point<"screen">;
  readonly to: Point<"screen">;
}

/** One frozen frame; it is keyed by the frame, so a new capture starts without a half-finished drag. */
const Stage = ({ view }: { readonly view: OverlayView }) => {
  const [drag, setDrag] = useState<Drag | null>(null);

  useLocalKeys({
    onEscape: () => {
      setDrag(null);
      api.cancel();
    },
  });

  const onPointerDown = (event: PointerEvent<HTMLElement>): void => {
    if (event.button !== 0) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ from: pointOf(event), to: pointOf(event) });
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>): void => {
    if (drag !== null) {
      setDrag({ ...drag, to: pointOf(event) });
    }
  };

  const onPointerUp = (event: PointerEvent<HTMLElement>): void => {
    if (drag === null) {
      return;
    }

    const to = pointOf(event);

    setDrag(null);
    api.commit(
      moved(drag.from, to)
        ? { area: dragRect(drag.from, to), kind: "area" }
        : { kind: "pin", point: drag.from }
    );
  };

  const area =
    drag !== null && moved(drag.from, drag.to)
      ? dragRect(drag.from, drag.to)
      : null;

  return (
    <main
      aria-label="Drag over the screen to keep an area, or click to pin a spot"
      className="overlay-stage"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <img
        alt=""
        className="overlay-frame"
        draggable={false}
        src={view.frameUrl}
      />
      {area === null ? (
        <div className="overlay-dim" />
      ) : (
        <Selection area={area} />
      )}
      {drag === null ? <Hint /> : null}
    </main>
  );
};

export const OverlayApp = () => {
  const view = usePushedView(load, subscribe, null);

  return view === null ? null : <Stage key={view.frameUrl} view={view} />;
};

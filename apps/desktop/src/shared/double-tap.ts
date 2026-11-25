/** Key events reduced to what the detector needs: which Shift, or any other key. */
export interface TapKeyEvent {
  readonly type: "down" | "up";
  readonly key: "leftShift" | "rightShift" | "other";
  readonly at: number;
}

/** A tap is a short press of Shift alone; two taps close together make a double tap. */
export const TAP_MAX_MS = 250;
export const GAP_MAX_MS = 400;

export interface TapState {
  readonly held: readonly ("leftShift" | "rightShift")[];
  readonly pressedAt: number;
  /** Another key went down while Shift was held, as in typing a capital. */
  readonly spoiled: boolean;
  readonly lastTapAt: number | null;
}

export const INITIAL_TAP_STATE: TapState = {
  held: [],
  lastTapAt: null,
  pressedAt: 0,
  spoiled: false,
};

export interface TapStep {
  readonly state: TapState;
  readonly fired: boolean;
}

const rest = (state: TapState): TapStep => ({ fired: false, state });

/** Fires on the release of the second tap, so a synthetic copy afterwards carries no Shift. */
export const stepTap = (state: TapState, event: TapKeyEvent): TapStep => {
  if (event.key === "other") {
    return event.type === "down"
      ? rest({ ...state, lastTapAt: null, spoiled: state.held.length > 0 })
      : rest(state);
  }

  if (event.type === "down") {
    if (state.held.includes(event.key)) {
      return rest(state);
    }

    return state.held.length === 0
      ? rest({
          ...state,
          held: [event.key],
          pressedAt: event.at,
          spoiled: false,
        })
      : rest({ ...state, held: [...state.held, event.key], spoiled: true });
  }

  const held = state.held.filter((key) => key !== event.key);

  if (held.length > 0 || held.length === state.held.length) {
    return rest({ ...state, held });
  }

  const tapped = !state.spoiled && event.at - state.pressedAt <= TAP_MAX_MS;

  if (!tapped) {
    return rest({ ...state, held, lastTapAt: null });
  }

  if (state.lastTapAt !== null && event.at - state.lastTapAt <= GAP_MAX_MS) {
    return { fired: true, state: { ...INITIAL_TAP_STATE } };
  }

  return rest({ ...state, held, lastTapAt: event.at });
};

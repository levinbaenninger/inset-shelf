export type UpdateState =
  | { readonly kind: "idle" }
  | { readonly kind: "checking"; readonly manual: boolean }
  | { readonly kind: "available"; readonly version: string }
  | {
      readonly kind: "downloading";
      readonly version: string;
      readonly percent: number;
    }
  | { readonly kind: "ready"; readonly version: string }
  | { readonly kind: "upToDate" }
  | { readonly kind: "error"; readonly message: string };

export type UpdateEvent =
  | { readonly type: "check"; readonly manual: boolean }
  | { readonly type: "found"; readonly version: string }
  | { readonly type: "notFound" }
  | { readonly type: "progress"; readonly percent: number }
  | { readonly type: "downloaded" }
  | { readonly type: "failed"; readonly message: string };

export type UpdateAction = "checkForUpdates" | "restartToUpdate";

export interface UpdateMenuItem {
  readonly label: string;
  /** Null while the updater is busy: the item is shown, but disabled. */
  readonly action: UpdateAction | null;
}

export const INITIAL_UPDATE_STATE: UpdateState = { kind: "idle" };

export const updateTransition = (
  state: UpdateState,
  event: UpdateEvent
): UpdateState => {
  switch (event.type) {
    case "check": {
      return state.kind === "idle" ||
        state.kind === "upToDate" ||
        state.kind === "error"
        ? { kind: "checking", manual: event.manual }
        : state;
    }

    case "found": {
      return state.kind === "checking"
        ? { kind: "available", version: event.version }
        : state;
    }

    case "notFound": {
      return state.kind === "checking" ? { kind: "upToDate" } : state;
    }

    case "progress": {
      return state.kind === "available" || state.kind === "downloading"
        ? {
            kind: "downloading",
            percent: Math.round(event.percent),
            version: state.version,
          }
        : state;
    }

    case "downloaded": {
      return state.kind === "available" || state.kind === "downloading"
        ? { kind: "ready", version: state.version }
        : state;
    }

    case "failed": {
      return state.kind === "ready"
        ? state
        : { kind: "error", message: event.message };
    }

    default: {
      return state;
    }
  }
};

export const updateMenuItem = (state: UpdateState): UpdateMenuItem => {
  switch (state.kind) {
    case "checking": {
      return { action: null, label: "Checking for Updates…" };
    }

    case "available": {
      return { action: null, label: `Downloading v${state.version}…` };
    }

    case "downloading": {
      return {
        action: null,
        label: `Downloading v${state.version}… ${state.percent}%`,
      };
    }

    case "ready": {
      return {
        action: "restartToUpdate",
        label: `Restart to Update to v${state.version}`,
      };
    }

    case "idle":
    case "upToDate":
    case "error": {
      return { action: "checkForUpdates", label: "Check for Updates…" };
    }

    default: {
      return state satisfies never;
    }
  }
};

/** What to tell the user once, when a step changes: a finished download, or the answer to a check they asked for. */
export const updateNotice = (
  previous: UpdateState,
  next: UpdateState
): string | null => {
  if (next.kind === "ready" && previous.kind !== "ready") {
    return `Version ${next.version} is ready. Restart Inset Shelf to update.`;
  }

  if (previous.kind !== "checking" || !previous.manual) {
    return null;
  }

  switch (next.kind) {
    case "upToDate": {
      return "Inset Shelf is up to date.";
    }

    case "available": {
      return `Downloading version ${next.version}…`;
    }

    case "error": {
      return `Couldn't check for updates: ${next.message}`;
    }

    case "idle":
    case "checking":
    case "downloading":
    case "ready": {
      return null;
    }

    default: {
      return next satisfies never;
    }
  }
};

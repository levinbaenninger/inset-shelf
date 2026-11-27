export type UpdateState =
  | { readonly kind: "idle" }
  | { readonly kind: "checking" }
  | { readonly kind: "available"; readonly version: string }
  | {
      readonly kind: "downloading";
      readonly version: string;
      readonly percent: number;
    }
  | { readonly kind: "ready"; readonly version: string }
  | { readonly kind: "upToDate" }
  | { readonly kind: "error"; readonly message: string };

/** Every step is a user's choice: check, then download, then restart. */
export type UpdateEvent =
  | { readonly type: "check" }
  | { readonly type: "found"; readonly version: string }
  | { readonly type: "notFound" }
  | { readonly type: "download" }
  | { readonly type: "progress"; readonly percent: number }
  | { readonly type: "downloaded" }
  | { readonly type: "failed"; readonly message: string };

export type UpdateAction =
  | "checkForUpdates"
  | "downloadUpdate"
  | "restartToUpdate";

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
        ? { kind: "checking" }
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

    case "download": {
      return state.kind === "available"
        ? { kind: "downloading", percent: 0, version: state.version }
        : state;
    }

    case "progress": {
      return state.kind === "downloading"
        ? {
            kind: "downloading",
            percent: Math.round(event.percent),
            version: state.version,
          }
        : state;
    }

    case "downloaded": {
      return state.kind === "downloading"
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
      return {
        action: "downloadUpdate",
        label: `Download Update to v${state.version}…`,
      };
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

/** What to tell the user once, when a step changes: the answer to a check, or a finished download. */
export const updateNotice = (
  previous: UpdateState,
  next: UpdateState
): string | null => {
  if (next.kind === "ready" && previous.kind !== "ready") {
    return `Version ${next.version} is ready. Restart Inset Shelf to update.`;
  }

  if (previous.kind === "downloading" && next.kind === "error") {
    return `Couldn’t download the update: ${next.message}`;
  }

  if (previous.kind !== "checking") {
    return null;
  }

  switch (next.kind) {
    case "upToDate": {
      return "Inset Shelf is up to date.";
    }

    case "available": {
      return `Version ${next.version} is available. Choose Download Update in the menu.`;
    }

    case "error": {
      return `Couldn’t check for updates: ${next.message}`;
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

/** Waits for a request to the updater. Failures are reported through its "error" event, so here they are only consumed. */
export const settleRequest = async <Result>(
  request: () => Promise<Result>
): Promise<void> => {
  try {
    await request();
  } catch {
    // Reported through the "error" event.
  }
};

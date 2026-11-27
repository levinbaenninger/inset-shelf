// Stands in for each window's preload inside the page: its contract's methods, answered from the
// scene's data. scripts/screens.ts first sets `globalThis.__screens = { data, page }`, then loads
// this file with `page.addInitScript({ path })`, so it runs as a plain script before the renderer.
// Shelf operations the scenes use change the document and push a new view, as main would.
const { data, page } = globalThis.__screens;

// The app shows attachments from inset: URLs, which only Electron serves: here they come over http from
// the fixtures folder, rewritten as each picture appears.
const ATTACHMENT = "inset://attachment/";

const rewrite = (element) => {
  const src = element.getAttribute?.("src");

  if (src?.startsWith(ATTACHMENT)) {
    element.setAttribute("src", `/.fixtures/${src.slice(ATTACHMENT.length)}`);
  }
};

new MutationObserver((records) => {
  for (const record of records) {
    if (record.type === "attributes") {
      rewrite(record.target);
    }

    for (const node of record.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        rewrite(node);

        for (const image of node.querySelectorAll("img")) {
          rewrite(image);
        }
      }
    }
  }
}).observe(document, {
  attributeFilter: ["src"],
  attributes: true,
  childList: true,
  subtree: true,
});

const listeners = new Map();

const on = (name, listener) => {
  const set = listeners.get(name) ?? new Set();

  set.add(listener);
  listeners.set(name, set);

  return () => {
    set.delete(listener);
  };
};

/** Lets a scene push an event, such as a menu command: `__emit("command", { kind: "shortcuts" })`. */
globalThis.__emit = (name, payload) => {
  for (const listener of listeners.get(name) ?? []) {
    listener(payload);
  }
};

globalThis.__applied = [];

/** Every operation and copy the shelf asked main for, in order: `{ call: "copy", arg: id }`. */
globalThis.__calls = [];

const logged = (call, answer) => (arg) => {
  // A call without an argument logs null, so the log reads back as JSON.
  globalThis.__calls.push({ arg: arg ?? null, call });

  return answer(arg);
};

const resolved = (value) => () => Promise.resolve(value);
const ok = resolved({ ok: true });

/** `copyFails`: main refuses every copy with this message, as when the shelf can't be saved, and offers Retry. */
const copied =
  data?.copyFails === undefined
    ? ok
    : resolved({ message: data.copyFails, ok: false, retrySave: true });

/** Each count of unsent text edits the page told main, in order. */
globalThis.__drafts = [];

/** Each time the page told main a menu opened (true) or the last one closed (false). */
globalThis.__menuOpen = [];

/** Every notice the shelf page told main it put on screen, in order. */
globalThis.__noticesShown = [];

const nothing = Function.prototype;

const withFallback = (api, fallback) =>
  new Proxy(api, { get: (target, key) => target[key] ?? fallback });

const updateItem = (doc, id, change) => ({
  ...doc,
  items: doc.items.map((item) => (item.id === id ? change(item) : item)),
});

// Attachments removed in details, so ⌘Z can put each back where it was, as main remembers them.
const removedAttachments = new Map();

const attachmentKey = (op) => `${op.id}/${op.attachmentId}`;

/** An item's attachments after a removal or a restore, as src/shared/shelf.ts and the controller change them. */
const changeAttachments = (doc, op) =>
  updateItem(doc, op.id, (item) => {
    const list = item.attachments ?? [];

    if (op.type === "removeAttachment") {
      const index = list.findIndex((entry) => entry.id === op.attachmentId);

      if (index === -1) {
        return item;
      }

      removedAttachments.set(attachmentKey(op), {
        attachment: list[index],
        index,
      });

      return { ...item, attachments: list.filter((_, at) => at !== index) };
    }

    const removed = removedAttachments.get(attachmentKey(op));

    if (removed === undefined) {
      return item;
    }

    removedAttachments.delete(attachmentKey(op));

    return {
      ...item,
      attachments: list.toSpliced(
        Math.min(removed.index, list.length),
        0,
        removed.attachment
      ),
    };
  });

/** The operations scenes perform, as src/shared/shelf.ts applies them. */
const applyOp = (doc, op) => {
  switch (op.type) {
    case "removeAttachment":
    case "restoreAttachment": {
      return changeAttachments(doc, op);
    }

    case "toggleDone": {
      return updateItem(doc, op.id, (item) => ({ ...item, done: !item.done }));
    }

    case "toggleStep": {
      return updateItem(doc, op.id, (item) => ({
        ...item,
        steps: item.steps.map((step) =>
          step.id === op.stepId ? { ...step, done: !step.done } : step
        ),
      }));
    }

    case "setDue": {
      return updateItem(doc, op.id, (item) => ({ ...item, due: op.due }));
    }

    case "setSteps": {
      return updateItem(doc, op.id, (item) => ({ ...item, steps: op.steps }));
    }

    case "setPins": {
      return updateItem(doc, op.id, (item) => ({ ...item, pins: op.pins }));
    }

    case "editText": {
      return updateItem(doc, op.id, (item) => ({ ...item, text: op.text }));
    }

    case "editNote": {
      return updateItem(doc, op.id, (item) => ({ ...item, note: op.note }));
    }

    case "describeWindow": {
      return updateItem(doc, op.id, (item) => ({
        ...item,
        windows: item.windows.map((window) =>
          window.id === op.windowId
            ? { ...window, description: op.description }
            : window
        ),
      }));
    }

    case "setDescription": {
      return updateItem(doc, op.id, (item) => ({
        ...item,
        description: op.description,
      }));
    }

    case "remove": {
      return { ...doc, items: doc.items.filter((item) => item.id !== op.id) };
    }

    case "setTitle": {
      return updateItem(doc, op.id, (item) => ({
        ...item,
        title: op.title.trim() === "" ? null : op.title.trim(),
      }));
    }

    default: {
      return doc;
    }
  }
};

if (page === "shelf") {
  let view = { discarded: null, notSaved: [], ...data.view };
  // How many files were dropped on items so far, for each one's own id.
  let dropped = 0;

  // What the disk holds: Discard changes puts an item back as it is here.
  const savedDoc = data.savedDoc ?? data.view.doc;

  // A save error outside a read-only session: every change stays unsaved, as main marks it.
  const failing =
    (data.view.status?.saveError ?? null) !== null &&
    data.view.status?.readOnly !== true;

  const markNotSaved = (op) => {
    if (!failing || op.id === undefined) {
      return view.notSaved;
    }

    const others = view.notSaved.filter((entry) => entry.id !== op.id);

    if (op.type === "remove") {
      return others;
    }

    const known = savedDoc.items.some((entry) => entry.id === op.id);

    return view.notSaved.some((entry) => entry.id === op.id)
      ? view.notSaved
      : [...view.notSaved, { id: op.id, undo: known ? "discard" : "delete" }];
  };

  // `echo: "later"` sends the new view a moment after an operation, as main does over IPC; `ipc: true` sends a copy, as IPC's structured clone does.
  const echo = (shown) => {
    const next = data.ipc === true ? structuredClone(shown) : shown;

    if (data.echo === "later") {
      setTimeout(() => {
        globalThis.__emit("view", next);
      }, 250);
    } else {
      globalThis.__emit("view", next);
    }
  };

  globalThis.insetShelf = withFallback(
    {
      apply: logged("apply", (op) => {
        globalThis.__applied.push(op);
        view = {
          ...view,
          doc: applyOp(view.doc, op),
          notSaved: markNotSaved(op),
        };
        echo(view);
      }),
      discardChanges: logged("discardChanges", (id) => {
        const before = savedDoc.items.find((entry) => entry.id === id);

        view = {
          ...view,
          discarded: { id, seq: (view.discarded?.seq ?? 0) + 1 },
          doc: updateItem(view.doc, id, (current) => before ?? current),
          notSaved: view.notSaved.filter((entry) => entry.id !== id),
        };
        echo(view);
      }),
      drafts: (count) => {
        globalThis.__drafts.push(count);
      },
      settled: logged("settled", nothing),
      copy: logged("copy", copied),
      copyDetails: logged("copyDetails", copied),
      copyList: logged("copyList", copied),
      copyWithLink: logged("copyWithLink", copied),
      getView: () => Promise.resolve(view),
      // `tutorial`: the in-app tutorial's view for this page; without it the page shows none.
      getTutorial: resolved(data.tutorial),
      tutorial: logged("tutorial", nothing),
      answerQuit: logged("answerQuit", nothing),
      menuOpen: (open) => {
        globalThis.__menuOpen.push(open);
      },
      // A report for the trial log, kept apart, so scenes that compare what the page asked for stay exact.
      noticeShown: (notice) => {
        globalThis.__noticesShown.push(notice);
      },
      newWindowLink: logged("newWindowLink", nothing),
      // `retryWorks`: the disk has room again, so Retry saves every change.
      retrySave: logged("retrySave", () => {
        if (data.retryWorks !== true) {
          return Promise.resolve({
            message: data.view.status?.saveError ?? "",
            ok: false,
          });
        }

        view = {
          ...view,
          notSaved: [],
          status: { ...view.status, saveError: null },
        };
        echo(view);

        return Promise.resolve({ ok: true });
      }),
      on,
      openImage: logged("openImage", nothing),
      // `openNotice`: main answers the open with this notice, as when a code item's file is gone.
      openLink: logged("openLink", () => {
        if (data?.openNotice !== undefined) {
          globalThis.__emit("notice", data.openNotice);
        }
      }),
      // Attachments: each call logged; files dropped on an item land on it, and the answer names them, as main's does when all of it fits.
      addFilesTo: logged("addFilesTo", ({ id, paths }) => {
        const added = paths.map((file) => {
          dropped += 1;

          return {
            addedAt: "2026-11-25T14:15:00.000Z",
            file: {
              bytes: 4,
              name: file.split("/").at(-1),
              stored: `dropped-${dropped}.bin`,
            },
            id: `00000000-0000-4000-8000-${String(700_000 + dropped).padStart(12, "0")}`,
            kind: "file",
          };
        });

        view = {
          ...view,
          doc: updateItem(view.doc, id, (item) => ({
            ...item,
            attachments: [...(item.attachments ?? []), ...added],
          })),
        };
        echo(view);

        return Promise.resolve({
          attached: added.map((attachment) => attachment.id),
          message: null,
        });
      }),
      newDrawingFor: logged("newDrawingFor", nothing),
      openAttachment: logged("openAttachment", nothing),
      pasteImageTo: logged(
        "pasteImageTo",
        resolved({ attached: [], message: null })
      ),
      // A picture pasted in the list, as a new item; main's notice says how it went.
      pasteImage: logged("pasteImage", nothing),
      // Files dropped or pasted on the shelf, as new items.
      addFiles: logged("addFiles", nothing),
      pickFilesFor: logged("pickFilesFor", nothing),
      startAttachmentDrag: logged("startAttachmentDrag", nothing),
    },
    nothing
  );
  // A scene's `filePaths` gives dropped files a path, as Finder's have; otherwise they have none, as a picture copied from a page.
  globalThis.insetFiles = {
    pathFor: (file) =>
      data.filePaths === true ? `/Users/anna/Desktop/${file.name}` : "",
  };
}

if (page === "picker") {
  globalThis.insetPicker = withFallback(
    {
      choose: ok,
      getTutorial: resolved(data.tutorial),
      tutorial: logged("tutorial", nothing),
      getView: resolved(data.view),
      on,
      setUpScreenRecording: logged("setUpScreenRecording", nothing),
    },
    nothing
  );
}

if (page === "onboarding") {
  globalThis.insetOnboarding = withFallback(
    {
      allow: logged("allow", nothing),
      back: logged("back", nothing),
      finish: logged("finish", nothing),
      fitHeight: nothing,
      getView: resolved(data.view),
      next: logged("next", nothing),
      on,
      reopen: logged("reopen", nothing),
      skip: logged("skip", nothing),
      startDrag: logged("startDrag", nothing),
    },
    nothing
  );
}

if (page === "drawing") {
  globalThis.__dirty = [];
  globalThis.insetDrawing = withFallback(
    {
      // `pictureBytes`: the picture's PNG, so a save can draw the marks into it as main's would.
      getImage:
        data.pictureBytes === true
          ? async () => {
              const picture = await fetch(data.view.image.url);

              return new Uint8Array(await picture.arrayBuffer());
            }
          : resolved(null),
      getView: resolved(data.view),
      on,
      // `holdSave`: the save waits until the scene calls `__releaseSave()`, then fails as a full disk, so the page stays open.
      save: (drawing) => {
        globalThis.__calls.push({
          arg: {
            copy: drawing.copy,
            forQuit: drawing.forQuit,
            pins: drawing.pins.length,
          },
          call: "save",
        });

        // `saveFails`: main refuses every save with this message.
        if (data.saveFails !== undefined) {
          return Promise.resolve({ message: data.saveFails, ok: false });
        }

        if (data.holdSave !== true) {
          return ok();
        }

        // oxlint-disable-next-line promise/avoid-new -- a save held until the scene lets it go.
        return new Promise((resolve) => {
          globalThis.__releaseSave = () => {
            resolve({ message: "The disk is full.", ok: false });
          };
        });
      },
      // Kept apart from the calls, which the drawing scenes compare whole.
      setDirty: (dirty) => {
        globalThis.__dirty.push(dirty);
      },
    },
    nothing
  );
}

if (page === "toast") {
  globalThis.insetToast = withFallback(
    {
      getView: resolved(data.view),
      hover: nothing,
      on,
      open: logged("open", nothing),
      // Say why: main answers a ready field by showing its caret.
      cancelWhy: logged("cancelWhy", nothing),
      dismiss: logged("dismiss", nothing),
      // `whySaves`: main answers Return with the words on their way to the disk, as the pill's write state shows them.
      saveWhy: logged("saveWhy", (sent) => {
        if (data.whySaves === true) {
          globalThis.__emit("view", {
            ...data.view,
            phase: "saving",
            seq: sent.seq,
            text: sent.text.trim(),
          });
        }
      }),
      why: logged("why", nothing),
      whyInput: logged("whyInput", nothing),
      whyReady: logged("whyReady", (seq) => {
        if (data.view?.kind === "why" && data.view.phase === "taking") {
          globalThis.__emit("view", { ...data.view, phase: "typing", seq });
        }
      }),
    },
    nothing
  );
}

if (page === "screenshot") {
  /** Each time the card told main the pointer or the keyboard is on it (true) or has left (false). */
  globalThis.__hover = [];
  globalThis.insetScreenshot = withFallback(
    {
      addToItem: logged("addToItem", nothing),
      addToShelf: logged("addToShelf", nothing),
      annotate: logged("annotate", nothing),
      copy: logged("copy", nothing),
      dismiss: logged("dismiss", nothing),
      getTutorial: resolved(data.tutorial),
      getView: resolved(data.view),
      hold: logged("hold", nothing),
      hover: (held) => {
        globalThis.__hover.push(held);
      },
      on,
      saveToDownloads: logged("saveToDownloads", nothing),
      startDrag: logged("startDrag", nothing),
      tutorial: logged("tutorial", nothing),
    },
    nothing
  );
}

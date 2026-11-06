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

const nothing = Function.prototype;

const withFallback = (api, fallback) =>
  new Proxy(api, { get: (target, key) => target[key] ?? fallback });

const updateItem = (doc, id, change) => ({
  ...doc,
  items: doc.items.map((item) => (item.id === id ? change(item) : item)),
});

/** The operations scenes perform, as src/shared/shelf.ts applies them. */
const applyOp = (doc, op) => {
  switch (op.type) {
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

  // `echo: "later"` sends the new view a moment after an operation, as main does over IPC.
  const echo = (next) => {
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
      answerQuit: logged("answerQuit", nothing),
      menuOpen: (open) => {
        globalThis.__menuOpen.push(open);
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
      openLink: logged("openLink", nothing),
    },
    nothing
  );
  globalThis.insetFiles = { pathFor: () => "" };
}

if (page === "picker") {
  globalThis.insetPicker = withFallback(
    {
      choose: ok,
      getView: resolved(data.view),
      on,
    },
    nothing
  );
}

if (page === "drawing") {
  globalThis.__dirty = [];
  globalThis.insetDrawing = withFallback(
    {
      getImage: resolved(null),
      getView: resolved(data.view),
      on,
      save: (drawing) => {
        globalThis.__calls.push({
          arg: {
            copy: drawing.copy,
            forQuit: drawing.forQuit,
            pins: drawing.pins.length,
          },
          call: "save",
        });

        return ok();
      },
      // Kept apart from the calls, which the drawing scenes compare whole.
      setDirty: (dirty) => {
        globalThis.__dirty.push(dirty);
      },
    },
    nothing
  );
}

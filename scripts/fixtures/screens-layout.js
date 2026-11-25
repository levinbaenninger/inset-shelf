// What breaks at the edges, anywhere on the page, menus and notices included. scripts/screens.ts
// loads this file into the shelf, notice, screenshot card and drawing pages with
// `page.addInitScript({ path })` and calls `globalThis.__strictProblems()` after a scene's act.
// Text hidden below a line (badges wrapped out of sight, a clamp) is intended, so only the
// horizontal is checked for cut words. A field the keyboard isn't in must show its words whole,
// and no words may be squeezed into a column narrower than four characters.

const NAME_LENGTH = 30;

const LAYERS =
  "[data-radix-popper-content-wrapper], [role=dialog], [role=alertdialog], [data-sonner-toaster]";

const CONTROLS =
  "button, a[href], input, textarea, [role=checkbox], [role=menuitem], [data-badges] > *";

const nameOf = (element) => {
  const label =
    element.getAttribute("aria-label") ??
    element.textContent?.trim().slice(0, NAME_LENGTH) ??
    "";

  return `<${element.tagName.toLowerCase()}> “${label}”`;
};

const unseen = (element) =>
  element.closest(".sr-only, [hidden], [aria-hidden=true]") !== null ||
  !element.checkVisibility({ visibilityProperty: true });

const clips = (element) => getComputedStyle(element).overflowX !== "visible";

/** Cuts what runs past its top or bottom, as a clamp that clips only downwards does. */
const clipsDown = (element) =>
  getComputedStyle(element).overflowY !== "visible";

const windowWidth = () => document.documentElement.clientWidth;

/**
 * The part of a box its clipping ancestors leave in sight, or null when none
 * of it is. A window-wide ancestor clips only top and bottom: its sides are
 * the window's own edges, which are what is being checked.
 */
const inSight = (element, box) => {
  let { bottom, left, right, top } = box;

  for (
    let parent = element.parentElement;
    parent !== null && parent !== document.body;
    parent = parent.parentElement
  ) {
    const outer = parent.getBoundingClientRect();

    if (clipsDown(parent)) {
      top = Math.max(top, outer.top);
      bottom = Math.min(bottom, outer.bottom);
    }

    if (clips(parent) && outer.width < windowWidth() - 1) {
      left = Math.max(left, outer.left);
      right = Math.min(right, outer.right);
    }
  }

  return right - left > 0.5 && bottom - top > 0.5
    ? { bottom, left, right, top }
    : null;
};

const shown = () =>
  [...document.body.querySelectorAll("*")].filter(
    (element) => !unseen(element)
  );

/** A box past the window's sides. */
const pastTheWindow = (elements) =>
  elements.flatMap((element) => {
    const box = element.getBoundingClientRect();
    const seen = box.width > 0 ? inSight(element, box) : null;

    return seen !== null &&
      (seen.right > windowWidth() + 0.5 || seen.left < -0.5)
      ? [`${nameOf(element)} runs past the window`]
      : [];
  });

/** A menu's entries stay inside it. */
const outOfMenus = () =>
  [...document.querySelectorAll("[role=menu]")].flatMap((menu) => {
    const outer = menu.getBoundingClientRect();

    return [...menu.querySelectorAll("*")].flatMap((child) => {
      const box = child.getBoundingClientRect();

      return box.width > 0 &&
        !unseen(child) &&
        (box.right > outer.right + 0.5 || box.left < outer.left - 0.5)
        ? [`${nameOf(child)} sticks out of its menu`]
        : [];
    });
  });

const clipperOf = (element) => {
  let clipper = element;

  while (clipper !== null && !clips(clipper)) {
    clipper = clipper.parentElement;
  }

  return clipper;
};

/** The element between a text and its clip that draws an ellipsis, or null. */
const ellipsisOf = (owner, clipper) => {
  for (let element = owner; element !== null; element = element.parentElement) {
    if (getComputedStyle(element).textOverflow === "ellipsis") {
      return element;
    }

    if (element === clipper) {
      return null;
    }
  }

  return null;
};

/** A text node cut sideways: its owner's description, the element that ellipsizes it, or null when it shows whole. */
const cutText = (node) => {
  const owner = node.parentElement;

  if (
    owner === null ||
    (node.textContent ?? "").trim() === "" ||
    unseen(owner) ||
    owner.closest("script, style, [contenteditable=true]") !== null
  ) {
    return null;
  }

  const clipper = clipperOf(owner);
  const range = document.createRange();

  range.selectNodeContents(node);

  const rects = [...range.getClientRects()].filter((rect) => rect.width > 0);

  if (clipper === null || rects.length === 0) {
    return null;
  }

  const outer = clipper.getBoundingClientRect();

  const cut = rects.some(
    (rect) =>
      rect.bottom > outer.top + 0.5 &&
      rect.top < outer.bottom - 0.5 &&
      (rect.right > outer.right + 1 || rect.left < outer.left - 1)
  );

  if (!cut) {
    return null;
  }

  const right = Math.round(Math.max(...rects.map((rect) => rect.right)));

  return {
    ellipsis: ellipsisOf(owner, clipper),
    problem: `${nameOf(owner)} is cut off without an ellipsis (${right} > ${Math.round(outer.right)})`,
  };
};

const squash = (text) => text.replaceAll(/\s+/gu, " ").trim();

/** An ellipsis is fine when a title holds the whole text. */
const untitled = (element) => {
  const whole = squash(element.textContent ?? "");
  const titled = element.closest("[title]");

  return (
    titled === null ||
    !squash(titled.getAttribute("title") ?? "").includes(whole)
  );
};

/** Words cut sideways: without an ellipsis they are cut mid-glyph; with one, a title must hold them. */
const cutWords = () => {
  const problems = [];
  const ellipsized = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);

  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const found = cutText(node);

    if (found?.ellipsis === null) {
      problems.push(found.problem);
    } else if (found !== null) {
      ellipsized.add(found.ellipsis);
    }
  }

  for (const element of ellipsized) {
    if (untitled(element)) {
      problems.push(
        `${nameOf(element)} ends in an ellipsis, but no title holds the whole text`
      );
    }
  }

  return problems;
};

const inside = (outer, inner) =>
  inner.left >= outer.left - 0.5 &&
  inner.right <= outer.right + 0.5 &&
  inner.top >= outer.top - 0.5 &&
  inner.bottom <= outer.bottom + 0.5;

const partlyCovers = (a, b) => {
  const across =
    Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left);

  const down =
    Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top);

  return (
    a.layer === b.layer &&
    across > 1 &&
    down > 1 &&
    !a.element.contains(b.element) &&
    !b.element.contains(a.element) &&
    !inside(a.box, b.box) &&
    !inside(b.box, a.box)
  );
};

/** Two controls that partly cover each other; one inside the other (a card's corner buttons) is a layer. */
const overlaps = (elements) => {
  const controls = elements.flatMap((element) => {
    const box = element.matches(CONTROLS)
      ? inSight(element, element.getBoundingClientRect())
      : null;

    return box === null
      ? []
      : [{ box, element, layer: element.closest(LAYERS) ?? document.body }];
  });

  return controls.flatMap((a, index) =>
    controls
      .slice(index + 1)
      .filter((b) => partlyCovers(a, b))
      .map((b) => `${nameOf(a.element)} overlaps ${nameOf(b.element)}`)
  );
};

const FIELDS = "input:not([type=checkbox], [type=radio], [type=range]), textarea";

/** A field the keyboard isn't in that hides part of its words sideways: they are cut mid-glyph. */
const cutFields = (elements) =>
  elements.flatMap((element) =>
    element.matches(FIELDS) &&
    element !== document.activeElement &&
    element.value !== "" &&
    element.scrollWidth > element.clientWidth + 1
      ? [
          `${nameOf(element)} cuts “${element.value.slice(0, NAME_LENGTH)}” off without an ellipsis`,
        ]
      : []
  );

const COLUMN_CH = 4;

const measure = document.createElement("canvas").getContext("2d");

/** How wide `text` is on one line in an element's font. */
const widthIn = (element, text) => {
  measure.font = getComputedStyle(element).font;

  return measure.measureText(text).width;
};

const INLINE = new Set(["contents", "inline"]);

/** The box that lays a text out: its nearest ancestor that isn't inline. */
const columnOf = (element) => {
  let column = element;

  while (
    column.parentElement !== null &&
    INLINE.has(getComputedStyle(column).display)
  ) {
    column = column.parentElement;
  }

  return column;
};

const contentWidth = (element) => {
  const style = getComputedStyle(element);

  return (
    element.clientWidth -
    Number.parseFloat(style.paddingLeft) -
    Number.parseFloat(style.paddingRight)
  );
};

/**
 * Words squeezed into a column narrower than four characters (1ch is the
 * width of "0"): one letter per line, or a label cut to “A…”. A short word
 * that fits on one line in it (a count, “Retry”) is not squeezed.
 */
const narrowColumns = (elements) => {
  const problems = [];
  const columns = new Map();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);

  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const owner = node.parentElement;
    const text = (node.textContent ?? "").trim();

    if (
      owner !== null &&
      text.length > COLUMN_CH &&
      !unseen(owner) &&
      owner.closest("script, style, svg") === null
    ) {
      columns.set(columnOf(owner), text);
    }
  }

  for (const field of elements.filter((element) => element.matches(FIELDS))) {
    const text = field.value || field.placeholder;

    if (text.trim().length > COLUMN_CH) {
      columns.set(field, text);
    }
  }

  for (const [column, text] of columns) {
    const width = contentWidth(column);
    const box = column.getBoundingClientRect();

    if (
      box.width > 0 &&
      box.height > 0 &&
      width < COLUMN_CH * widthIn(column, "0") - 0.5 &&
      widthIn(column, text.trim()) > width + 1
    ) {
      problems.push(
        `${nameOf(column)} squeezes “${text.slice(0, NAME_LENGTH)}” into ${Math.round(width)} px, under ${COLUMN_CH}ch`
      );
    }
  }

  return problems;
};

globalThis.__strictProblems = () => {
  const elements = shown();

  return [
    ...new Set([
      ...pastTheWindow(elements),
      ...outOfMenus(),
      ...cutWords(),
      ...cutFields(elements),
      ...narrowColumns(elements),
      ...overlaps(elements),
    ]),
  ];
};

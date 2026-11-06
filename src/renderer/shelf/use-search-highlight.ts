import { parseSearch } from "@shared/due";
import { useEffect } from "react";
import type { RefObject } from "react";

const HIGHLIGHT = "shelf-search";
const GRAPHEMES = new Intl.Segmenter();

/** Ranges over every place a word appears in the element's text, case aside. */
const rangesFor = (root: Element, terms: readonly string[]): Range[] => {
  const ranges: Range[] = [];

  // Words the shelf itself writes about the search (the empty state) are not matches.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest("[data-no-highlight]") === null
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT,
  });

  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const original = node.textContent ?? "";
    const text = original.toLocaleLowerCase();
    const offsets: { start: number; end: number }[] = [];

    // Lowercasing can expand or contract text. Keep each folded unit tied to
    // its original grapheme, including combining marks and surrogate pairs.
    for (const { index, segment } of GRAPHEMES.segment(original)) {
      const offset = { end: index + segment.length, start: index };

      for (let unit = 0; unit < segment.toLocaleLowerCase().length; unit += 1) {
        offsets.push(offset);
      }
    }

    for (const term of terms) {
      for (
        let at = text.indexOf(term);
        at !== -1;
        at = text.indexOf(term, at + term.length)
      ) {
        const start = offsets[at];
        const end = offsets[at + term.length - 1];

        if (start === undefined || end === undefined) {
          continue;
        }

        const range = new Range();

        range.setStart(node, start.start);
        range.setEnd(node, end.end);
        ranges.push(range);
      }
    }
  }

  return ranges;
};

/**
 * Marks the searched words in the list with the CSS Custom Highlight API
 * (::highlight(shelf-search) in styles.css): no change to the DOM, so
 * Markdown, links and editing are untouched. It runs after every render,
 * since an opened row shows more words.
 */
export const useSearchHighlight = (
  root: RefObject<HTMLElement | null>,
  query: string
): void => {
  useEffect(() => {
    const registry = globalThis.CSS?.highlights;
    const element = root.current;

    if (registry === undefined) {
      return;
    }

    const { terms } = parseSearch(query);

    if (terms.length === 0 || element === null) {
      registry.delete(HIGHLIGHT);
    } else {
      registry.set(HIGHLIGHT, new Highlight(...rangesFor(element, terms)));
    }
  });

  useEffect(
    () => () => {
      globalThis.CSS?.highlights?.delete(HIGHLIGHT);
    },
    []
  );
};

"use client";

import { useLayoutEffect, type RefObject } from "react";

/**
 * fixes76: nudges an open dropdown panel horizontally so it never spills past
 * the screen edge — or past the edge of an ancestor that clips its overflow
 * (e.g. a table's horizontal-scroll frame). The panel is anchored under its
 * trigger with CSS (`start-0 top-full w-full`), but when its minimum width is
 * wider than the trigger and the trigger sits near an edge (in RTL, growing
 * leftward), CSS alone can't keep it visible — this measures once per open
 * (and on resize) and shifts it back inside an 8px margin.
 */
export function useKeepInViewport(ref: RefObject<HTMLElement | null>, open: boolean) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    function place() {
      if (!el) return;
      el.style.transform = "";
      const margin = 8;
      let left = margin;
      let right = document.documentElement.clientWidth - margin;
      for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
        if (getComputedStyle(n).overflowX === "visible") continue;
        const b = n.getBoundingClientRect();
        left = Math.max(left, b.left);
        right = Math.min(right, b.right);
      }
      const r = el.getBoundingClientRect();
      let dx = 0;
      if (r.right > right) dx = right - r.right;
      if (r.left + dx < left) dx = left - r.left;
      if (dx) el.style.transform = `translateX(${dx}px)`;
    }
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [ref, open]);
}

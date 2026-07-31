"use client";

import { useEffect, useRef, useState } from "react";
import Sortable from "sortablejs";

/**
 * fixes39 §3: SortableJS-backed drag-to-reorder for a flat row of chips —
 * replaces the hand-rolled Pointer-Events hook (lib/useChipReorder.ts).
 *
 * Mobile-first config, per spec: `delay`/`delayOnTouchOnly` give a real
 * long-press before a touch drag engages (so scrolling past the chips isn't
 * misread as a reorder), `fallbackTolerance` absorbs a few px of finger
 * jitter. `forceFallback: true` makes Sortable drive the drag off its own
 * pointer/touch simulation instead of the browser's native HTML5
 * drag-and-drop heuristic — this app's own trackpad testing (fixes38)
 * already proved that heuristic doesn't reliably fire `dragstart` at all on
 * some Windows trackpads, so leaving it on here would reintroduce the same
 * failure this hook exists to fix.
 *
 * `containerRef` is a callback ref, not a plain `useRef` object — both call
 * sites mount the chip row conditionally (a "Visible columns" panel that
 * starts closed), so the container is still `null` the first time a
 * `useEffect([])` would run and never gets a second chance to attach once
 * the panel opens. A callback ref re-fires (via the `container` state
 * below) every time React attaches/detaches the node, which is exactly
 * what's needed here — confirmed live: without this, Sortable.create()
 * silently never runs at all (no ghost/chosen class ever appears, no
 * error), which is easy to misdiagnose as a config problem instead of a
 * ref-timing one.
 *
 * The container element itself must also be a real laid-out box (Sortable
 * measures it with `getBoundingClientRect()` for hit-testing) — a
 * `display:contents` wrapper was tried first to let a "some children
 * aren't draggable" sub-list flow inline with its siblings, but that
 * collapses the container to an empty rect and kills drag detection the
 * same silent way. So every item — draggable or not — must be a direct
 * child of one real container; mark a non-draggable one with
 * `data-sortable-disabled` (wired to Sortable's `filter`, with
 * `preventOnFilter: false` so its own click handler still fires normally).
 *
 * `onReorder` receives the container's full child order (via each child's
 * `data-sort-key`) after every drag — including non-draggable items, since
 * SortableJS still repositions a dragged item relative to them. The caller
 * filters that list down to whatever it actually tracks (e.g. just the
 * "active" keys) rather than trusting a single from/to index pair, which
 * would need its own translation logic for a mixed draggable/non-draggable
 * list. React's next render then just confirms the DOM SortableJS already
 * arranged, which is the standard way to pair SortableJS with a
 * React-controlled list.
 */
export function useSortableList<T extends HTMLElement>(
  onReorder: (orderedKeys: string[]) => void,
) {
  const [container, setContainer] = useState<T | null>(null);
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;
  const suppressClickRef = useRef(false);

  useEffect(() => {
    if (!container) return;
    const sortable = Sortable.create(container, {
      animation: 150,
      ghostClass: "sortable-ghost",
      chosenClass: "sortable-chosen",
      dragClass: "sortable-drag",
      fallbackTolerance: 3,
      delay: 300,
      delayOnTouchOnly: true,
      forceFallback: true,
      filter: "[data-sortable-disabled]",
      preventOnFilter: false,
      onStart: () => {
        suppressClickRef.current = true;
      },
      onEnd: () => {
        // Cleared a tick late so a click the browser fires right after a
        // completed drag is swallowed by withClickGuard first.
        setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
        const keys = Array.from(container.children)
          .map((child) => (child as HTMLElement).dataset.sortKey)
          .filter((k): k is string => !!k);
        onReorderRef.current(keys);
      },
    });
    return () => sortable.destroy();
  }, [container]);

  /** Wrap a chip's plain-click handler (e.g. the show/hide toggle) so a
   *  completed drag doesn't also fire it. */
  function withClickGuard(fn: () => void) {
    return () => {
      if (suppressClickRef.current) return;
      fn();
    };
  }

  return { containerRef: setContainer, withClickGuard };
}

"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

/**
 * Pointer-events-based drag-to-reorder for a row of chips.
 *
 * Deliberately NOT native HTML5 drag-and-drop (`draggable`/`ondragstart`/...):
 * that API depends on the browser's own "is this really a drag gesture"
 * heuristic on top of the raw pointer input, and on many Windows trackpads
 * that heuristic never fires at all — the drag silently never starts, with
 * zero visual feedback, even though the underlying reorder logic is correct.
 * Pointer Events (down/move/up) are the same low-level input every input
 * device (mouse, trackpad, touch, pen) already produces reliably, so driving
 * the reorder off those instead removes the dependency on that heuristic.
 */
export function useChipReorder<T extends string>(onReorder: (from: T, to: T) => void) {
  const [draggedKey, setDraggedKey] = useState<T | null>(null);
  const [hoverKey, setHoverKey] = useState<T | null>(null);
  const draggedRef = useRef<T | null>(null);
  const startPos = useRef<{ x: number; y: number } | null>(null);
  const movedRef = useRef(false);
  const suppressClickRef = useRef(false);

  function chipTargetFromPoint(x: number, y: number): T | undefined {
    const el = document.elementFromPoint(x, y);
    const chip = el?.closest<HTMLElement>("[data-chip-key]");
    return (chip?.dataset.chipKey as T) ?? undefined;
  }

  function chipProps(key: T, active: boolean) {
    return {
      "data-chip-key": key,
      style: { touchAction: "none" as const },
      onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
        if (!active || e.button !== 0) return;
        draggedRef.current = key;
        startPos.current = { x: e.clientX, y: e.clientY };
        movedRef.current = false;
        setDraggedKey(key);
        e.currentTarget.setPointerCapture(e.pointerId);
      },
      onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
        if (!draggedRef.current || !startPos.current) return;
        const dx = e.clientX - startPos.current.x;
        const dy = e.clientY - startPos.current.y;
        // A few pixels of jitter shouldn't count as "the user dragged" —
        // otherwise a plain click/tap would get its click event suppressed.
        if (Math.hypot(dx, dy) > 4) movedRef.current = true;
        setHoverKey(chipTargetFromPoint(e.clientX, e.clientY) ?? null);
      },
      onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
        const from = draggedRef.current;
        draggedRef.current = null;
        setDraggedKey(null);
        setHoverKey(null);
        if (!from) return;
        if (movedRef.current) {
          // A real drag happened — suppress the click this pointerup would
          // otherwise still fire on the source chip, and apply the reorder.
          suppressClickRef.current = true;
          const to = chipTargetFromPoint(e.clientX, e.clientY);
          if (to && to !== from) onReorder(from, to);
        }
      },
      onPointerCancel: () => {
        draggedRef.current = null;
        setDraggedKey(null);
        setHoverKey(null);
      },
    };
  }

  /** Wrap a chip's plain-click handler (e.g. the show/hide toggle) so a
   *  completed drag doesn't also fire it. */
  function withClickGuard(fn: () => void) {
    return () => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      fn();
    };
  }

  return { draggedKey, hoverKey, chipProps, withClickGuard };
}

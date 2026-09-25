"use client";

import { useEffect, useRef, useState } from "react";

import { useLocalization } from "@/lib/localization";

export type CelebrationKind = "milestone" | "complete";

interface CelebrationProps {
  /** null = idle. Set to a kind to fire once; the parent should reset it to
   *  null (directly, or via `onDone`) before firing the same kind again. */
  fire: CelebrationKind | null;
  onDone?: () => void;
}

/** fixes68 §6.2: shared confetti burst — dynamically imports canvas-confetti
 *  so it never blocks first paint. "milestone" (25/50/75%) is one small
 *  star burst; "complete" (100%) is a staggered multi-burst in brand +
 *  status colors. Honors prefers-reduced-motion with a static card instead
 *  of animating. Built generic on purpose — the pending task-completion
 *  confetti todo reuses this same component, not a route-specific one. */
export function Celebration({ fire, onDone }: CelebrationProps) {
  const { t } = useLocalization();
  const firedFor = useRef<CelebrationKind | null>(null);
  const [showStaticCard, setShowStaticCard] = useState(false);

  useEffect(() => {
    if (!fire || firedFor.current === fire) return;
    firedFor.current = fire;

    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (reducedMotion) {
      setShowStaticCard(true);
      const timer = window.setTimeout(() => {
        setShowStaticCard(false);
        onDone?.();
      }, 1600);
      return () => window.clearTimeout(timer);
    }

    let cancelled = false;
    const timers: number[] = [];
    import("canvas-confetti").then(({ default: confetti }) => {
      if (cancelled) return;
      if (fire === "milestone") {
        confetti({ particleCount: 50, spread: 70, shapes: ["star"], origin: { y: 0.6 } });
      } else {
        const colors = ["#e91e63", "#22c55e", "#eab308", "#8b0000", "#f97316"];
        [0, 250, 500].forEach((delay) => {
          timers.push(
            window.setTimeout(
              () => confetti({ particleCount: 100, spread: 100, colors, origin: { y: 0.6 } }),
              delay,
            ),
          );
        });
      }
    });
    const doneTimer = window.setTimeout(() => onDone?.(), 2200);
    return () => {
      cancelled = true;
      timers.forEach((tm) => window.clearTimeout(tm));
      window.clearTimeout(doneTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fire]);

  useEffect(() => {
    if (fire == null) firedFor.current = null;
  }, [fire]);

  if (!showStaticCard) return null;

  return (
    <div className="fixed inset-x-4 top-1/3 z-50 rounded-xl border-2 border-primary bg-card p-6 text-center text-xl font-bold shadow-lg">
      {t("activist_route.celebration_static", "כל הכבוד!")}
    </div>
  );
}

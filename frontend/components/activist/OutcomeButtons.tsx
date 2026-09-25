"use client";

import { Button } from "@/components/ui/button";
import { useLocalization } from "@/lib/localization";
import type { DoorOutcome } from "@/lib/types";

const OUTCOMES: { value: DoorOutcome; key: string; fallback: string }[] = [
  { value: "answered", key: "activist_route.outcome.answered", fallback: "נענו" },
  { value: "not_home", key: "activist_route.outcome.not_home", fallback: "לא בבית" },
  { value: "jewish", key: "activist_route.outcome.jewish", fallback: "יהודי" },
  { value: "not_jewish", key: "activist_route.outcome.not_jewish", fallback: "לא יהודי" },
  {
    value: "come_back_later",
    key: "activist_route.outcome.come_back_later",
    fallback: "לחזור מאוחר יותר",
  },
];

interface OutcomeButtonsProps {
  onMark: (outcome: DoorOutcome) => void;
  disabled?: boolean;
}

/** fixes68 §3.1/§3.2/§2.3: five one-tap outcome buttons in a sticky bottom
 *  thumb zone (min-h-14 = 56px targets, full-width rows, safe-area padding)
 *  — one-handed use, no reaching. No confirmation dialog. Vibrates on tap:
 *  silent tactile confirmation when the phone is muted in a stairwell. */
export function OutcomeButtons({ onMark, disabled }: OutcomeButtonsProps) {
  const { t } = useLocalization();

  function handleTap(outcome: DoorOutcome) {
    if (disabled) return;
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(30);
    }
    onMark(outcome);
  }

  return (
    <div
      className="sticky bottom-0 z-10 grid grid-cols-2 gap-2 border-t border-border bg-background p-3"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      {OUTCOMES.map((o, i) => (
        <Button
          key={o.value}
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => handleTap(o.value)}
          className={`h-14 text-lg font-semibold ${
            i === OUTCOMES.length - 1 ? "col-span-2" : ""
          }`}
        >
          {t(o.key, o.fallback)}
        </Button>
      ))}
    </div>
  );
}

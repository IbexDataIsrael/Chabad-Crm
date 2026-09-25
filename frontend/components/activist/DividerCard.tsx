"use client";

import { useLocalization } from "@/lib/localization";
import { RebbeInspiration } from "./RebbeInspiration";

interface DividerCardProps {
  buildingAddress: string;
  floor: string;
  remaining: number;
  /** fixes68 §7.1: deterministic index (dividers seen this route) — which
   *  photo/quote alternates in, if any assets are configured. */
  inspirationIndex: number;
  onContinue: () => void;
}

/** fixes68 §4.3/§7: a slim divider between buildings/floors — "Building X -
 *  Floor Y - N doors left", one tap to continue. Also the slot for the
 *  Rebbe photo/quote rotation (renders nothing when no assets exist). */
export function DividerCard({
  buildingAddress,
  floor,
  remaining,
  inspirationIndex,
  onContinue,
}: DividerCardProps) {
  const { t } = useLocalization();

  const line = [
    t("activist_route.divider.building", "בניין {address}").replace("{address}", buildingAddress),
    floor && t("activist_route.divider.floor", "קומה {floor}").replace("{floor}", floor),
    t("activist_route.divider.remaining", "{n} דירות נותרו").replace("{n}", String(remaining)),
  ]
    .filter(Boolean)
    .join(" - ");

  return (
    <button
      type="button"
      onClick={onContinue}
      className="flex h-full w-full flex-col items-center justify-center gap-6 rounded-xl border border-border bg-card p-6 text-center"
    >
      <div className="text-xl font-semibold">{line}</div>
      <RebbeInspiration index={inspirationIndex} />
      <div className="text-sm font-medium text-primary">
        {t("activist_route.continue", "המשך")}
      </div>
    </button>
  );
}

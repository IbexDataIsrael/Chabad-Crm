"use client";

import { useLocalization } from "@/lib/localization";

interface RouteProgressProps {
  done: number;
  total: number;
}

/** fixes68 §6.1: sticky top bar — "{done} / {total} דלתות" + a fill bar. */
export function RouteProgress({ done, total }: RouteProgressProps) {
  const { t } = useLocalization();
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="sticky top-0 z-10 space-y-1 bg-background/95 px-4 py-2 backdrop-blur">
      <div className="text-sm font-medium">
        {t("activist_route.progress", "{done} / {total} דלתות")
          .replace("{done}", String(done))
          .replace("{total}", String(total))}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

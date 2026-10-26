"use client";

import { TaskMapView } from "@/components/TaskMapView";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";

/** fixes96: "מפת גוגל" — every building the activist works in (the same set
 *  as their apartment screens), with the polygons of those buildings' areas;
 *  task numbers on the markers when they have more than one task. */
export default function ActivistMapPage() {
  const { t } = useLocalization();
  const { loading } = useAuth();
  if (loading) return <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>;
  return (
    <div className="space-y-3">
      <h1 className="font-display text-4xl">{t("map.activist_title", "מפת הבניינים שלי")}</h1>
      <TaskMapView heightClass="h-[70vh]" />
    </div>
  );
}

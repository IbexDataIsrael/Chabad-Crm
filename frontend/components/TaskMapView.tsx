"use client";

import { useEffect, useMemo, useState } from "react";

import { BuildingsMap, type MapBuilding } from "@/components/BuildingsMap";
import { apiFetch } from "@/lib/api";
import { useLocalization } from "@/lib/localization";

/** fixes96: GET /api/tasks/map — the buildings to plot (+ the task numbers
 *  that cover each) and the polygons of their areas. */
interface TaskMapData {
  task_count: number;
  buildings: (MapBuilding & { apartment_count: number; task_ids: number[]; area_id: number | null })[];
  areas: { id: number; area_name: string; area_polygon: string | null }[];
}

/** The activist's buildings (no taskId) or one task's buildings (taskId), on
 *  a Google map with their areas' polygons. When more than one task is in
 *  play, each building is labelled with its task number(s) ("#12, #15"). */
export function TaskMapView({
  taskId,
  heightClass = "h-96",
}: {
  taskId?: number;
  heightClass?: string;
}) {
  const { t } = useLocalization();
  const [data, setData] = useState<TaskMapData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setData(null);
    setFailed(false);
    apiFetch<TaskMapData>(taskId != null ? `/api/tasks/map?task_id=${taskId}` : "/api/tasks/map")
      .then(setData)
      .catch(() => setFailed(true));
  }, [taskId]);

  const labels = useMemo(() => {
    if (!data || data.task_count <= 1) return undefined;
    return Object.fromEntries(
      data.buildings
        .filter((b) => b.task_ids.length > 0)
        .map((b) => [b.id, b.task_ids.map((id) => `#${id}`).join(", ")]),
    );
  }, [data]);

  if (failed) {
    return <p className="text-sm text-status-darkred">{t("map.load_failed", "טעינת המפה נכשלה.")}</p>;
  }
  if (!data) return <p className="text-sm text-muted-foreground">{t("action.loading", "טוען…")}</p>;

  const byId = new Map(data.buildings.map((b) => [b.id, b]));
  const unlocated = data.buildings.filter((b) => b.latitude == null || b.longitude == null).length;

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        {t("map.summary", "{b} בניינים · {a} אזורים")
          .replace("{b}", String(data.buildings.length))
          .replace("{a}", String(data.areas.length))}
        {unlocated > 0 &&
          ` · ${t("map.unlocated", "{n} בלי מיקום על המפה").replace("{n}", String(unlocated))}`}
      </p>
      <BuildingsMap
        buildings={data.buildings}
        areas={data.areas}
        labels={labels}
        showBuildingLink={false}
        heightClass={heightClass}
        infoExtra={(b) => {
          const row = byId.get(b.id);
          if (!row) return null;
          const apts = t("map.apartments", "{n} דירות").replace("{n}", String(row.apartment_count));
          return row.task_ids.length
            ? `${apts} · ${t("map.tasks", "משימות")}: ${row.task_ids.map((id) => `#${id}`).join(", ")}`
            : apts;
        }}
      />
    </div>
  );
}

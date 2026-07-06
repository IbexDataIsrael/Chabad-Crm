"use client";

import { useEffect, useMemo, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useLocalization } from "@/lib/localization";
import { buildingDisplayName, type Apartment, type Building } from "@/lib/types";

/**
 * Relate whole buildings to a shliach. Only buildings inside the shliach's
 * selected areas are offered; clicking one fetches all its apartments and adds
 * them (via onAddApartments) to the shliach's covered apartments.
 */
export function BuildingMultiSelect({
  areaIds,
  onAddApartments,
}: {
  areaIds: number[];
  onAddApartments: (apartmentIds: number[]) => void;
}) {
  const { t } = useLocalization();
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [related, setRelated] = useState<number[]>([]);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    apiFetch<Building[]>("/api/buildings").then(setBuildings).catch(() => {});
  }, []);

  const options = useMemo(
    () => buildings.filter((b) => areaIds.includes(b.area_id)),
    [buildings, areaIds],
  );

  async function relate(b: Building) {
    setBusy(b.id);
    try {
      const aps = await apiFetch<Apartment[]>(`/api/apartments?building_id=${b.id}`);
      onAddApartments(aps.map((a) => a.id));
      setRelated((prev) => (prev.includes(b.id) ? prev : [...prev, b.id]));
    } catch {
      /* ignore — caller's apartment list just won't gain these */
    } finally {
      setBusy(null);
    }
  }

  if (areaIds.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        {t("shliach.select_area_first", "יש לבחור אזור תחילה")}
      </p>
    );
  }
  if (options.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        {t("shliach.no_buildings_in_area", "אין בניינים באזורים שנבחרו.")}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((b) => {
        const on = related.includes(b.id);
        return (
          <button
            key={b.id}
            type="button"
            disabled={busy === b.id}
            onClick={() => relate(b)}
            className={`rounded-md border px-3 py-1.5 text-sm disabled:opacity-50 ${
              on
                ? "border-status-green bg-status-green/10 text-status-green"
                : "border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            {on ? "✓ " : "+ "}
            {buildingDisplayName(b)}
          </button>
        );
      })}
    </div>
  );
}

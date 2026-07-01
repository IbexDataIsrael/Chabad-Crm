"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useLocalization } from "@/lib/localization";
import type { Area } from "@/lib/types";

/**
 * Multi-select for the areas a shliach (active member) covers — a simple checkbox
 * list of the org's areas. Value is the list of selected area ids.
 */
export function AreaMultiSelect({
  value,
  onChange,
}: {
  value: number[];
  onChange: (ids: number[]) => void;
}) {
  const { t } = useLocalization();
  const [areas, setAreas] = useState<Area[]>([]);

  useEffect(() => {
    apiFetch<Area[]>("/api/areas").then(setAreas).catch(() => {});
  }, []);

  function toggle(id: number) {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  }

  if (areas.length === 0) {
    return <p className="text-sm text-gray-500">{t("page.no_areas", "אין אזורים עדיין.")}</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {areas.map((a) => {
        const on = value.includes(a.id);
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => toggle(a.id)}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              on
                ? "border-status-magenta bg-status-magenta/10 text-status-magenta"
                : "border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            {on ? "✓ " : ""}
            {a.area_name}
          </button>
        );
      })}
    </div>
  );
}

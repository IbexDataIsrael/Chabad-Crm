"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useLocalization } from "@/lib/localization";
import {
  apartmentTitle,
  buildingDisplayName,
  type Apartment,
  type Building,
} from "@/lib/types";

/**
 * Multi-select for the apartments a shliach covers. "+ הוסף דירה" opens an
 * autocomplete textbox that filters apartments (by apartment or building name);
 * picking one adds it as a chip. Value is the list of apartment ids.
 */
export function ApartmentMultiSelect({
  value,
  onChange,
  areaIds,
}: {
  value: number[];
  onChange: (ids: number[]) => void;
  /** When provided (non-empty), only apartments whose building is in these areas
   *  are offered as options. */
  areaIds?: number[];
}) {
  const { t } = useLocalization();
  const [apartments, setApartments] = useState<Apartment[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    Promise.all([
      apiFetch<Apartment[]>("/api/apartments"),
      apiFetch<Building[]>("/api/buildings"),
    ])
      .then(([aps, bs]) => {
        setApartments(aps);
        setBuildings(bs);
      })
      .catch(() => {});
  }, []);

  const buildingName = useMemo(() => {
    const map = new Map<number, string>();
    buildings.forEach((b) => map.set(b.id, buildingDisplayName(b)));
    return (id: number) => map.get(id) ?? "";
  }, [buildings]);

  // Apartment -> its building's area, to filter options by the shliach's areas.
  const buildingArea = useMemo(() => {
    const map = new Map<number, number>();
    buildings.forEach((b) => map.set(b.id, b.area_id));
    return map;
  }, [buildings]);

  const label = (a: Apartment) => {
    const bn = buildingName(a.building_id);
    const title = apartmentTitle(a);
    return bn ? `${title} — ${bn}` : title;
  };

  const inArea = (a: Apartment) =>
    !areaIds || areaIds.length === 0
      ? true
      : areaIds.includes(buildingArea.get(a.building_id) ?? -1);

  const selected = apartments.filter((a) => value.includes(a.id));
  const q = query.trim().toLowerCase();
  // Available options (not already selected, within the area). Shown even before
  // the user types — they may not know an apartment's name to start searching.
  const candidates = apartments.filter((a) => !value.includes(a.id)).filter(inArea);
  const matches = (
    q ? candidates.filter((a) => label(a).toLowerCase().includes(q)) : candidates
  ).slice(0, 12);

  function add(id: number) {
    onChange([...value, id]);
    setQuery("");
    setAdding(false);
  }

  function remove(id: number) {
    onChange(value.filter((v) => v !== id));
  }

  if (apartments.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        {t("apt.no_apartments", "אין דירות עדיין.")}{" "}
        <Link href="/dashboard/buildings" className="text-status-magenta hover:underline">
          {t("apt.add_building_apartment", "הוסף בניין ודירה")}
        </Link>{" "}
        {t("apt.to_link_shliach", "כדי לשייך לפעיל.")}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {selected.map((a) => (
            <li
              key={a.id}
              className="inline-flex items-center gap-1 rounded-full bg-status-magenta/10 text-status-magenta px-3 py-1 text-sm"
            >
              {label(a)}
              <button
                type="button"
                onClick={() => remove(a.id)}
                className="text-status-magenta/70 hover:text-status-darkred"
                aria-label={t("action.remove", "הסר")}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="relative">
          <input
            autoFocus
            className="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta"
            placeholder={t("apt.search_placeholder", "חפש דירה לפי שם דירה או בניין…")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onBlur={() => setTimeout(() => setAdding(false), 150)}
          />
          {matches.length > 0 && (
            <ul className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-56 overflow-auto text-sm">
              {matches.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => add(a.id)}
                    className="w-full text-right px-3 py-2 hover:bg-gray-50"
                  >
                    {label(a)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="text-sm text-status-magenta hover:underline"
        >
          + {t("apt.add_apartment", "הוסף דירה")}
        </button>
      )}
    </div>
  );
}

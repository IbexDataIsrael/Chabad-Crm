"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useConfirm } from "@/lib/confirm";
import { useLocalization } from "@/lib/localization";
import type { Area, ShliachSummary } from "@/lib/types";

import { MultiSelectSearchFilter } from "./ui/MultiSelectSearchFilter";

/**
 * Multi-select for the areas a shliach (active member) covers. Value is the
 * list of selected area ids. fixes43 §4.1: searchable dropdown (matching the
 * Buildings filter's MultiSelectSearchFilter), replacing the old toggle-chip
 * list so long area lists stay usable. fixes43 §4.2: adding an area already
 * covered by another shliach asks for confirmation first.
 */
export function AreaMultiSelect({
  value,
  onChange,
  excludeContactId,
}: {
  value: number[];
  onChange: (ids: number[]) => void;
  /** The shliach contact being edited — its own existing coverage never
   *  counts as a conflict with itself. */
  excludeContactId?: number;
}) {
  const { t } = useLocalization();
  const confirmDialog = useConfirm();
  const [areas, setAreas] = useState<Area[]>([]);
  const [assignments, setAssignments] = useState<Record<number, ShliachSummary[]>>({});

  useEffect(() => {
    apiFetch<Area[]>("/api/areas").then(setAreas).catch(() => {});
    apiFetch<Record<number, ShliachSummary[]>>("/api/areas/shliach-assignments")
      .then(setAssignments)
      .catch(() => {});
  }, []);

  async function handleChange(ids: number[]) {
    for (const id of ids) {
      if (value.includes(id)) continue; // not newly added
      const others = (assignments[id] ?? []).filter((s) => s.id !== excludeContactId);
      if (others.length === 0) continue;
      const ok = await confirmDialog({
        message: t(
          "contact_shliach.area_conflict_warning",
          "האזור הזה משוייך לפעיל אחר, האם ברצונך לשייך כאן פעיל נוסף?",
        ),
      });
      if (!ok) return; // leave the selection untouched
    }
    onChange(ids);
  }

  if (areas.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("page.no_areas", "אין אזורים עדיין.")}</p>;
  }

  return (
    <MultiSelectSearchFilter
      allLabel={t("contact_shliach.no_areas_selected", "לא נבחרו אזורים")}
      options={areas.map((a) => ({ id: a.id, label: a.area_name }))}
      value={value}
      onChange={handleChange}
      searchPlaceholder={t("filter.search_areas", "חיפוש אזור…")}
    />
  );
}

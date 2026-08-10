"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useConfirm } from "@/lib/confirm";
import { useLocalization } from "@/lib/localization";
import type { ReportNumber, ShliachSummary } from "@/lib/types";

import { MultiSelectSearchFilter } from "./ui/MultiSelectSearchFilter";

/**
 * Multi-select for the report numbers a shliach covers (fixes19 — replaces the
 * apartment coverage picker). Value is the list of selected ids. fixes43 §4.1:
 * searchable dropdown (matching the Buildings filter's MultiSelectSearchFilter),
 * replacing the old toggle-chip list so long report-number lists stay usable.
 * fixes43 §4.3: adding a report number already covered by another shliach
 * asks for confirmation first.
 */
export function ReportNumberMultiSelect({
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
  const [reportNumbers, setReportNumbers] = useState<ReportNumber[]>([]);
  const [assignments, setAssignments] = useState<Record<number, ShliachSummary[]>>({});

  useEffect(() => {
    apiFetch<ReportNumber[]>("/api/report-numbers")
      .then(setReportNumbers)
      .catch(() => {});
    apiFetch<Record<number, ShliachSummary[]>>("/api/report-numbers/shliach-assignments")
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
          "contact_shliach.report_number_conflict_warning",
          "מספר דוח הזה משוייך לפעיל אחר, האם ברצונך לשייך כאן פעיל נוסף?",
        ),
      });
      if (!ok) return; // leave the selection untouched
    }
    onChange(ids);
  }

  if (reportNumbers.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        {t("report.none", "אין מספרי דוח עדיין.")}
      </p>
    );
  }

  return (
    <MultiSelectSearchFilter
      allLabel={t("contact_shliach.no_report_numbers_selected", "לא נבחרו מספרי דוח")}
      options={reportNumbers.map((rn) => ({ id: rn.id, label: rn.name }))}
      value={value}
      onChange={handleChange}
      searchPlaceholder={t("filter.search_report_numbers", "חיפוש מספר דוח…")}
    />
  );
}

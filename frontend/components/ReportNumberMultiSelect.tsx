"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useLocalization } from "@/lib/localization";
import type { ReportNumber } from "@/lib/types";

/**
 * Multi-select for the report numbers a shliach covers (fixes19 — replaces the
 * apartment coverage picker). A simple checkbox list of the org's report
 * numbers; value is the list of selected ids.
 */
export function ReportNumberMultiSelect({
  value,
  onChange,
}: {
  value: number[];
  onChange: (ids: number[]) => void;
}) {
  const { t } = useLocalization();
  const [reportNumbers, setReportNumbers] = useState<ReportNumber[]>([]);

  useEffect(() => {
    apiFetch<ReportNumber[]>("/api/report-numbers")
      .then(setReportNumbers)
      .catch(() => {});
  }, []);

  function toggle(id: number) {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  }

  if (reportNumbers.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        {t("report.none", "אין מספרי דוח עדיין.")}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {reportNumbers.map((rn) => {
        const on = value.includes(rn.id);
        return (
          <button
            key={rn.id}
            type="button"
            onClick={() => toggle(rn.id)}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              on
                ? "border-status-magenta bg-status-magenta/10 text-status-magenta"
                : "border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            {on ? "✓ " : ""}
            {rn.name}
          </button>
        );
      })}
    </div>
  );
}

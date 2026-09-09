"use client";

import { useLocalization } from "@/lib/localization";
import type { ReportCompletionStatus } from "@/lib/types";

// fixes53 §9: exact hex values from spec — distinct from (and more saturated
// than) this app's own status-green/status-orange/status-darkred theme
// tokens, so they're inline styles rather than Tailwind classes. Shared with
// the Tasks page (fixes60 §1) so both surfaces render an activist's report
// status identically.
const STATUS_COLORS: Record<ReportCompletionStatus, string> = {
  completed: "#2e7d32",
  not_completed: "#d32f2f",
  partial: "#ed6c02",
};

export function ReportStatusBadge({ status }: { status: ReportCompletionStatus }) {
  const { t } = useLocalization();
  const labels: Record<ReportCompletionStatus, string> = {
    completed: t("shliach_msg.status_completed", "דוח הושלם"),
    not_completed: t("shliach_msg.status_not_completed", "דוח לא הושלם"),
    partial: t("shliach_msg.status_partial", "דוח הושלם חלקית"),
  };
  return (
    <span
      className="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium text-white"
      style={{ backgroundColor: STATUS_COLORS[status] }}
    >
      {labels[status]}
    </span>
  );
}

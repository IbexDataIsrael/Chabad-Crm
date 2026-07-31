"use client";

import { VisitSummary } from "@/components/VisitSummary";
import { useLocalization } from "@/lib/localization";

/** fixes38 §1.2: "Summary of Visits" report — a standalone page under the
 *  Contacts nav group; the per-contact version lives on the contact detail
 *  page's "Visit Summary" segment (VisitSummary with a `contactId`). */
export default function VisitSummaryPage() {
  const { t } = useLocalization();
  return (
    <div className="space-y-4 max-w-4xl">
      <h1 className="text-2xl font-bold">{t("nav.visit_summary", "סיכום ביקורים")}</h1>
      <div className="bg-white rounded-xl shadow-sm p-5">
        <VisitSummary />
      </div>
    </div>
  );
}

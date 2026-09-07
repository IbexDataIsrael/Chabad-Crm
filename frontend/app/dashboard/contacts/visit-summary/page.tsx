"use client";

import { VisitSummary } from "@/components/VisitSummary";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";

/** fixes38 §1.2: "Summary of Visits" report — a standalone page under the
 *  Contacts nav group; the per-contact version lives on the contact detail
 *  page's "Visit Summary" segment (VisitSummary with a `contactId`). */
export default function VisitSummaryPage() {
  const { t } = useLocalization();
  const { isCampaignManager } = useAuth();

  // fixes58 §3.7: same direct-URL gap fix as the Contacts pages — Visits are
  // forbidden to Campaign Manager.
  if (isCampaignManager) {
    return (
      <p className="text-status-darkred">
        {t("page.admins_only", "אין לך הרשאה לעמוד זה (מנהלים בלבד).")}
      </p>
    );
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <h1 className="text-2xl font-bold">{t("nav.visit_summary", "סיכום ביקורים")}</h1>
      <Card className="p-5">
        <VisitSummary />
      </Card>
    </div>
  );
}

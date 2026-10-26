"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import type { CampaignHistoryEntry, CampaignHistoryPage } from "@/lib/types";

const PAGE_SIZE = 50;

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
}

/** fixes72 §B: per-campaign change history — its own sub-route (mirrors
 *  tasks/[id]/paper-entry being its own sub-route off a task detail page)
 *  rather than a Card on the campaign page, since history can be long.
 *  Computed at read time on the backend (app/campaign_history.py) from the
 *  apartment version chain — nothing here does any diffing itself. */
export default function CampaignHistoryPageRoute() {
  const params = useParams<{ id: string }>();
  const campaignId = Number(params.id);
  const { t, lang } = useLocalization();
  const { isAdmin, isCampaignManager, loading } = useAuth();
  const allowed = isAdmin || isCampaignManager;

  const [page, setPage] = useState(1);
  const [data, setData] = useState<CampaignHistoryPage | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    if (loading || !allowed) return;
    setBusy(true);
    apiFetch<CampaignHistoryPage>(
      `/api/campaigns/${campaignId}/history?page=${page}&page_size=${PAGE_SIZE}`,
    )
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setBusy(false));
  }, [loading, allowed, campaignId, page]);

  if (loading) return <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>;
  if (!allowed) {
    return (
      <p className="text-destructive">
        {t("page.admins_only", "אין לך הרשאה לעמוד זה (מנהלים בלבד).")}
      </p>
    );
  }

  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function fieldLabel(c: CampaignHistoryEntry["changes"][number]) {
    return (lang === "en" ? c.english_label : c.label) || c.label || t(c.label_key, c.field_key);
  }

  function formatValue(v: string | number | boolean | null) {
    if (v === null) return "—";
    if (typeof v === "boolean") return v ? "✓" : "—";
    return String(v);
  }

  return (
    <div className="max-w-3xl space-y-5">
      <Link href={`/dashboard/campaigns/${campaignId}`} className="text-sm text-primary hover:underline">
        {t("action.back", "← חזרה")}
      </Link>

      <h1 className="font-display text-4xl font-bold">{t("campaign.history", "היסטוריית שינויים")}</h1>

      {busy ? (
        <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>
      ) : !data || data.items.length === 0 ? (
        <Card className="p-6 text-center text-muted-foreground">
          {t("campaign.no_history", "אין שינויים מתועדים לקמפיין הזה עדיין.")}
        </Card>
      ) : (
        <div className="space-y-3">
          {data.items.map((entry) => (
            <Card key={entry.apartment_id} className="p-4 space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <div className="font-medium">
                  {entry.building_label}
                  <span className="text-muted-foreground"> · #{entry.apartment_id}</span>
                  {entry.event === "created" && (
                    <span className="ms-2 text-xs text-status-green">
                      {t("campaign.history_created", "נוצר")}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {entry.editor_name || t("apt.history_unknown_editor", "עורך לא ידוע")}
                  {" — "}
                  {formatDateTime(entry.changed_at)}
                </div>
              </div>
              <div className="divide-y divide-border text-sm">
                {entry.changes.map((c) => (
                  <div key={c.field_key} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="text-muted-foreground">{fieldLabel(c)}</span>
                    <span className="text-end">
                      {c.old_value !== null && (
                        <span className="text-muted-foreground line-through me-2">
                          {formatValue(c.old_value)}
                        </span>
                      )}
                      {formatValue(c.new_value)}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {!busy && total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            <ChevronRight className="h-4 w-4" /> {t("pager.prev", "הקודם")}
          </Button>
          <span className="text-muted-foreground">
            {t("pager.range", "{from}–{to} מתוך {total}")
              .replace("{from}", String((page - 1) * PAGE_SIZE + 1))
              .replace("{to}", String(Math.min(page * PAGE_SIZE, total)))
              .replace("{total}", String(total))}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= lastPage}
            onClick={() => setPage(page + 1)}
          >
            {t("pager.next", "הבא")} <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

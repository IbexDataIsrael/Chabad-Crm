"use client";

import { History, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InlineEdit } from "@/components/ui/InlineEdit";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useConfirm } from "@/lib/confirm";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";
import type { Campaign, CampaignBuildingCompletion, CampaignFieldVisibility } from "@/lib/types";

const inputClass =
  "w-full rounded-md border border-input px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

/** fixes71 §B.5/§B.6: a single campaign's own page — every field
 *  inline-editable (PUT /api/campaigns/{id}, same autosave pattern as
 *  tasks/{id}), delete, and the new apartment field-visibility checklist
 *  (autosave PUT /api/campaigns/{id}/field-visibility per row). No separate
 *  /edit route — this page is the edit view. */
export default function CampaignDetailPage() {
  const params = useParams<{ id: string }>();
  const campaignId = Number(params.id);
  const router = useRouter();
  const { t, lang } = useLocalization();
  const confirmDialog = useConfirm();
  const { isAdmin, isCampaignManager, loading } = useAuth();
  const { success, error: toastError } = useToast();
  const allowed = isAdmin || isCampaignManager;

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [fields, setFields] = useState<CampaignFieldVisibility[]>([]);
  const [fieldsBusy, setFieldsBusy] = useState(true);
  const [completions, setCompletions] = useState<CampaignBuildingCompletion[]>([]);
  const [completionsBusy, setCompletionsBusy] = useState(true);

  useEffect(() => {
    if (loading || !allowed) return;
    apiFetch<Campaign>(`/api/campaigns/${campaignId}`).then(setCampaign).catch(() => setNotFound(true));
    apiFetch<CampaignFieldVisibility[]>(`/api/campaigns/${campaignId}/field-visibility`)
      .then(setFields)
      .catch(() => setFields([]))
      .finally(() => setFieldsBusy(false));
    apiFetch<CampaignBuildingCompletion[]>(`/api/campaigns/${campaignId}/building-completions`)
      .then(setCompletions)
      .catch(() => setCompletions([]))
      .finally(() => setCompletionsBusy(false));
  }, [loading, allowed, campaignId]);

  async function patch(data: Partial<Campaign>) {
    const updated = await apiFetch<Campaign>(`/api/campaigns/${campaignId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    setCampaign(updated);
    success(t("msg.saved", "נשמר בהצלחה"));
  }

  async function toggleActive(next: boolean) {
    if (next) {
      const ok = await confirmDialog({
        message: t(
          "campaign.activate_confirm",
          "הפעלת הקמפיין הזה תכבה כל קמפיין פעיל אחר. להמשיך?",
        ),
      });
      if (!ok) return;
    }
    await patch({ is_active: next });
  }

  async function remove() {
    if (
      !campaign ||
      !(await confirmDialog({
        message: t("msg.delete_campaign_confirm", "למחוק את הקמפיין?"),
        detail: campaign.name,
      }))
    ) {
      return;
    }
    await apiFetch(`/api/campaigns/${campaignId}`, { method: "DELETE" });
    success(t("msg.deleted", "נמחק בהצלחה"));
    router.push("/dashboard/campaigns");
  }

  async function undoCompletion(buildingId: number) {
    await apiFetch(`/api/campaigns/${campaignId}/building-completions/${buildingId}`, {
      method: "DELETE",
    });
    setCompletions((prev) => prev.filter((c) => c.building_id !== buildingId));
    success(t("msg.deleted", "נמחק בהצלחה"));
  }

  async function toggleFieldVisible(f: CampaignFieldVisibility) {
    const next = !f.is_visible;
    setFields((prev) =>
      prev.map((x) => (x.field_key === f.field_key ? { ...x, is_visible: next } : x)),
    );
    try {
      await apiFetch(`/api/campaigns/${campaignId}/field-visibility`, {
        method: "PUT",
        body: JSON.stringify({ field_key: f.field_key, is_visible: next }),
      });
    } catch (err) {
      setFields((prev) =>
        prev.map((x) => (x.field_key === f.field_key ? { ...x, is_visible: f.is_visible } : x)),
      );
      toastError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    }
  }

  if (loading) return <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>;
  if (!allowed) {
    return (
      <p className="text-status-darkred">
        {t("page.admins_only", "אין לך הרשאה לעמוד זה (מנהלים בלבד).")}
      </p>
    );
  }
  if (notFound) {
    return (
      <div className="space-y-3">
        <Link href="/dashboard/campaigns" className="text-sm text-primary hover:underline">
          {t("action.back", "← חזרה")}
        </Link>
        <p className="text-status-darkred">{t("campaign.not_found", "הקמפיין לא נמצא.")}</p>
      </div>
    );
  }
  if (!campaign) {
    return <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>;
  }

  return (
    <div className="max-w-3xl space-y-5">
      <Link href="/dashboard/campaigns" className="text-sm text-primary hover:underline">
        {t("action.back", "← חזרה")}
      </Link>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          <InlineEdit<string>
            value={campaign.name}
            display={<span>{campaign.name}</span>}
            validate={(v) => (v.trim() ? null : t("validation.name_required", "יש להזין שם פרטי"))}
            onSave={(v) => patch({ name: v.trim() })}
            editor={(draft, setDraft) => (
              <input className={inputClass} value={draft} onChange={(e) => setDraft(e.target.value)} />
            )}
          />
        </h1>
        <Button
          size="sm"
          variant="outline"
          className="border-status-darkred/40 text-status-darkred hover:bg-status-darkred/10"
          onClick={remove}
        >
          <Trash2 className="h-3.5 w-3.5" /> {t("action.delete", "מחק")}
        </Button>
      </div>

      <Card className="p-4 space-y-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={campaign.is_active}
            onChange={(e) => toggleActive(e.target.checked)}
          />
          {t("campaign.is_active", "פעיל")}
        </label>
        <p className="text-xs text-muted-foreground">
          {t(
            "campaign.is_active_hint",
            "קמפיין אחד בלבד יכול להיות פעיל. הפעלתו מכבה אוטומטית כל קמפיין אחר.",
          )}
        </p>

        <div>
          <span className="block text-xs font-medium text-muted-foreground mb-1">
            {t("campaign.custom_stats_text", "טקסט סטטיסטיקה")}
          </span>
          <InlineEdit<string>
            value={campaign.custom_stats_text ?? ""}
            display={
              <span className="text-sm text-muted-foreground">{campaign.custom_stats_text || "—"}</span>
            }
            onSave={(v) => patch({ custom_stats_text: v.trim() || null })}
            editor={(draft, setDraft) => (
              <input
                className={inputClass}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="{{count}} יהודים קיבלו חנוכייה"
              />
            )}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {t(
              "campaign.custom_stats_text_hint",
              "טקסט שיוצג בעמוד הבית של הפעיל. אפשר להשתמש בתגית {{count}}.",
            )}
          </p>
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <span className="block text-sm font-medium">
          {t("campaign.field_visibility", "שדות דירה גלויים לפעילים")}
        </span>
        <p className="text-xs text-muted-foreground">
          {t(
            "campaign.field_visibility_hint",
            "סמן שדות דירה שהפעילים יראו במסלול שלהם כשהקמפיין הזה פעיל. בטל סימון כדי להסתיר שדה.",
          )}
        </p>
        {fieldsBusy ? (
          <p className="text-sm text-muted-foreground">{t("action.loading", "טוען…")}</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {fields.map((f) => (
              <label key={f.field_key} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={f.is_visible}
                  onChange={() => toggleFieldVisible(f)}
                />
                {(lang === "en" ? f.english_label : f.label) || f.label || t(f.label_key, f.field_key)}
              </label>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4 space-y-3">
        <span className="block text-sm font-medium">
          {t("campaign.completed_buildings", "בניינים שהושלמו")}
        </span>
        <p className="text-xs text-muted-foreground">
          {t(
            "campaign.completed_buildings_hint",
            "בניינים אלה הוסתרו מהפעילים בקמפיין הזה. ביטול משחזר אותם לרשימה.",
          )}
        </p>
        {completionsBusy ? (
          <p className="text-sm text-muted-foreground">{t("action.loading", "טוען…")}</p>
        ) : completions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("campaign.no_completed_buildings", "אין בניינים שהושלמו עדיין.")}
          </p>
        ) : (
          <div className="divide-y divide-border">
            {completions.map((c) => (
              <div key={c.building_id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <div>{c.building_label}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(c.completed_at).toLocaleString("he-IL", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                    {c.completed_by_name ? ` — ${c.completed_by_name}` : ""}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-status-darkred/40 text-status-darkred hover:bg-status-darkred/10"
                  onClick={() => undoCompletion(c.building_id)}
                >
                  {t("action.delete", "מחק")}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4 flex items-center justify-between">
        <div>
          <span className="block text-sm font-medium">
            {t("campaign.history", "היסטוריית שינויים")}
          </span>
          <p className="text-xs text-muted-foreground">
            {t("campaign.history_hint", "מה השתנה בכל דירה במהלך הקמפיין הזה, ומי שינה.")}
          </p>
        </div>
        <Button size="sm" variant="outline" asChild>
          <Link href={`/dashboard/campaigns/${campaignId}/history`}>
            <History className="h-3.5 w-3.5" /> {t("action.view", "הצג")}
          </Link>
        </Button>
      </Card>
    </div>
  );
}

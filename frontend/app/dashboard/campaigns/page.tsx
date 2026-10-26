"use client";

import { Eye, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useConfirm } from "@/lib/confirm";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";
import type { Campaign } from "@/lib/types";

const inputClass =
  "w-full rounded-md border border-input px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString("he-IL", { dateStyle: "short" }) : "—";
}

/** fixes71 §B: campaigns as a real data grid (like contacts) — display,
 *  navigate and delete only; every edit (name/active/stats text/field
 *  visibility) happens on the campaign's own detail page now, not inline
 *  here (explicit requirement, unlike this page's prior InlineEdit rows). */
export default function CampaignsPage() {
  const { isAdmin, isCampaignManager, loading } = useAuth();
  const { t } = useLocalization();
  const confirmDialog = useConfirm();
  const { success, error: toastError } = useToast();

  const [items, setItems] = useState<Campaign[]>([]);
  const [busy, setBusy] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  function reload() {
    return apiFetch<Campaign[]>("/api/campaigns").then(setItems).catch(() => setItems([]));
  }

  useEffect(() => {
    reload().finally(() => setBusy(false));
  }, []);

  async function addCampaign(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await apiFetch("/api/campaigns", {
        method: "POST",
        body: JSON.stringify({ name: newName.trim() }),
      });
      setNewName("");
      setAdding(false);
      await reload();
      success(t("msg.saved", "נשמר בהצלחה"));
    } catch (err) {
      toastError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    } finally {
      setSaving(false);
    }
  }

  async function remove(c: Campaign) {
    if (
      !(await confirmDialog({
        message: t("msg.delete_campaign_confirm", "למחוק את הקמפיין?"),
        detail: c.name,
      }))
    ) {
      return;
    }
    await apiFetch(`/api/campaigns/${c.id}`, { method: "DELETE" });
    await reload();
    success(t("msg.deleted", "נמחק בהצלחה"));
  }

  if (loading) return <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>;
  if (!isAdmin && !isCampaignManager) {
    return (
      <p className="text-destructive">
        {t("page.admins_only", "אין לך הרשאה לעמוד זה (מנהלים בלבד).")}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-4xl font-bold">{t("page.campaigns_title", "קמפיינים")}</h1>
        {!adding && (
          <Button onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> {t("page.add_campaign", "קמפיין חדש")}
          </Button>
        )}
      </div>

      {adding && (
        <form onSubmit={addCampaign} className="flex items-center gap-2 max-w-md">
          <input
            className={inputClass}
            placeholder={t("campaign.name", "שם")}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
          />
          <Button type="submit" disabled={saving || !newName.trim()}>
            {saving ? t("action.saving", "שומר…") : t("action.save", "שמור")}
          </Button>
          <Button type="button" variant="outline" onClick={() => setAdding(false)}>
            {t("action.cancel", "ביטול")}
          </Button>
        </form>
      )}

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-start text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-start">{t("campaign.name", "שם")}</th>
              <th className="px-3 py-2 text-start">{t("campaign.is_active", "פעיל")}</th>
              <th className="px-3 py-2 text-start">
                {t("campaign.custom_stats_text", "טקסט סטטיסטיקה")}
              </th>
              <th className="px-3 py-2 text-start">{t("campaign.created_at", "תאריך יצירה")}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {busy ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                  {t("action.loading", "טוען…")}
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                  {t("page.no_campaigns", "אין קמפיינים להצגה.")}
                </td>
              </tr>
            ) : (
              items.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">
                    <Link href={`/dashboard/campaigns/${c.id}`} className="font-medium text-primary hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    {c.is_active ? (
                      <Badge className="bg-status-green/15 text-status-green">
                        {t("campaign.is_active", "פעיל")}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {c.custom_stats_text || "—"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{formatDate(c.created_at)}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" asChild>
                        <Link href={`/dashboard/campaigns/${c.id}`} aria-label={t("action.view", "הצג")}>
                          <Eye className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-destructive/40 text-destructive hover:bg-destructive/10"
                        aria-label={t("action.delete", "מחק")}
                        onClick={() => remove(c)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

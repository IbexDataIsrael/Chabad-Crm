"use client";

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InlineEdit } from "@/components/ui/InlineEdit";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useConfirm } from "@/lib/confirm";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";
import type { Campaign } from "@/lib/types";

const inputClass =
  "w-full rounded-md border border-input px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

/** fixes58 §3.1: Campaign CRUD — name, active toggle, and the activist-
 *  homepage stats-text template. Admin + Campaign Manager (route itself is
 *  nav-gated the same way; the backend enforces it regardless). */
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

  async function saveField(c: Campaign, data: Partial<Campaign>) {
    await apiFetch(`/api/campaigns/${c.id}`, { method: "PUT", body: JSON.stringify(data) });
    await reload();
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
      <p className="text-status-darkred">
        {t("page.admins_only", "אין לך הרשאה לעמוד זה (מנהלים בלבד).")}
      </p>
    );
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("page.campaigns_title", "קמפיינים")}</h1>
        {!adding && (
          <Button onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> {t("page.add_campaign", "קמפיין חדש")}
          </Button>
        )}
      </div>

      {adding && (
        <form onSubmit={addCampaign} className="flex items-center gap-2">
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

      <Card className="divide-y divide-border shadow-sm">
        {busy ? (
          <p className="px-4 py-6 text-center text-muted-foreground">{t("action.loading", "טוען…")}</p>
        ) : items.length === 0 ? (
          <p className="px-4 py-6 text-center text-muted-foreground">
            {t("page.no_campaigns", "אין קמפיינים להצגה.")}
          </p>
        ) : (
          items.map((c) => (
            <div key={c.id} className="px-4 py-3 space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-[10rem] font-medium">
                  <InlineEdit<string>
                    value={c.name}
                    display={<span>{c.name}</span>}
                    validate={(v) => (v.trim() ? null : t("validation.name_required", "יש להזין שם פרטי"))}
                    onSave={(v) => saveField(c, { name: v.trim() })}
                    editor={(draft, setDraft) => (
                      <input
                        className={inputClass}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                      />
                    )}
                  />
                </div>
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={c.is_active}
                    onChange={(e) => saveField(c, { is_active: e.target.checked })}
                  />
                  {t("campaign.is_active", "פעיל")}
                </label>
                <Button
                  size="sm"
                  variant="outline"
                  className="ms-auto border-status-darkred/40 text-status-darkred hover:bg-status-darkred/10"
                  onClick={() => remove(c)}
                >
                  <Trash2 className="h-3.5 w-3.5" /> {t("action.delete", "מחק")}
                </Button>
              </div>
              <div>
                <span className="block text-xs font-medium text-muted-foreground">
                  {t("campaign.custom_stats_text", "טקסט סטטיסטיקה")}
                </span>
                <InlineEdit<string>
                  value={c.custom_stats_text ?? ""}
                  display={
                    <span className="text-sm text-muted-foreground">
                      {c.custom_stats_text || "—"}
                    </span>
                  }
                  onSave={(v) => saveField(c, { custom_stats_text: v.trim() || null })}
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
            </div>
          ))
        )}
      </Card>
    </div>
  );
}

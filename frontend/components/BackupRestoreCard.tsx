"use client";

import { Download, HardDriveDownload, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiDownload, apiFetch } from "@/lib/api";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";
import type { OrgBackup } from "@/lib/types";

const inputClass =
  "w-full rounded-md border border-input px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

/**
 * Backup & restore card on the org settings page (fixes16, admin-only).
 * "צור גיבוי" snapshots the data as it is right now; each listed restore
 * point can replace the current data (behind a warning modal) or be
 * downloaded as JSON.
 */
export function BackupRestoreCard() {
  const { t } = useLocalization();
  const { success, error: toastError } = useToast();
  const [backups, setBackups] = useState<OrgBackup[] | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState<OrgBackup | null>(null);

  async function reload() {
    setBackups(await apiFetch<OrgBackup[]>("/api/backups"));
  }

  useEffect(() => {
    reload().catch(() => setBackups([]));
  }, []);

  async function create() {
    setBusy(true);
    try {
      await apiFetch<OrgBackup>("/api/backups", {
        method: "POST",
        body: JSON.stringify({ note: note.trim() || null }),
      });
      setNote("");
      await reload();
      success(t("backup.created", "הגיבוי נוצר"));
    } catch (err) {
      toastError(
        err instanceof Error ? err.message : t("backup.create_failed", "יצירת הגיבוי נכשלה"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function restore(b: OrgBackup) {
    setRestoring(null);
    setBusy(true);
    try {
      await apiFetch(`/api/backups/${b.id}/restore`, { method: "POST" });
      await reload();
      success(t("backup.restored", "השחזור הושלם"));
      // The restored data touches every screen — a full reload is the honest
      // way to drop all client-side state.
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      toastError(
        err instanceof Error
          ? err.message
          : t("backup.restore_failed", "השחזור נכשל — הנתונים לא שונו"),
      );
      setBusy(false);
    }
  }

  async function download(b: OrgBackup) {
    try {
      await apiDownload(`/api/backups/${b.id}/download`, `crm-backup-${b.id}.json`);
    } catch {
      toastError(t("msg.save_failed", "שמירה נכשלה"));
    }
  }

  const when = (iso: string) =>
    new Date(iso).toLocaleString("he-IL", {
      dateStyle: "short",
      timeStyle: "short",
    });

  return (
    <Card className="p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t("backup.title", "גיבוי ושחזור")}</h2>
        <p className="text-xs text-muted-foreground">
          {t(
            "backup.intro",
            "צור נקודת שחזור של נתוני הארגון, ושחזר אליה אם משהו השתבש. נשמרות עד 10 נקודות; חשבונות המשתמשים אינם חלק מהגיבוי.",
          )}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          className={`${inputClass} flex-1 min-w-[12rem]`}
          placeholder={t("backup.note_ph", "הערה (לא חובה) — לדוגמה: לפני ייבוא")}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={300}
        />
        <Button type="button" onClick={create} disabled={busy}>
          <HardDriveDownload className="h-4 w-4" />
          {busy ? t("action.saving", "שומר…") : t("backup.create", "צור גיבוי")}
        </Button>
      </div>

      {backups === null ? (
        <p className="text-sm text-muted-foreground">{t("action.loading", "טוען…")}</p>
      ) : backups.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("backup.none", "אין נקודות שחזור עדיין.")}</p>
      ) : (
        <div className="divide-y divide-border">
          {backups.map((b) => (
            <div key={b.id} className="py-2.5 flex flex-wrap items-center gap-2 text-sm">
              <div className="min-w-[11rem]">
                <span className="font-medium" dir="ltr">
                  {when(b.created_at)}
                </span>
                {b.kind === "auto" && (
                  <span className="ms-2 rounded bg-muted text-muted-foreground text-xs px-1.5 py-0.5">
                    {t("backup.kind_auto", "אוטומטי")}
                  </span>
                )}
                <div className="text-xs text-muted-foreground">
                  {[
                    b.note,
                    b.created_by_name,
                    t("backup.contacts_n", "{n} אנשי קשר").replace(
                      "{n}",
                      String(b.counts.contacts ?? 0),
                    ),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <span className="ms-auto flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => download(b)}
                  className="text-muted-foreground"
                >
                  <Download className="h-3.5 w-3.5" /> {t("backup.download", "הורדה")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setRestoring(b)}
                  className="border-primary text-primary hover:bg-primary/10"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> {t("backup.restore", "שחזר")}
                </Button>
              </span>
            </div>
          ))}
        </div>
      )}

      {restoring && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md bg-card rounded-xl shadow-xl p-5 space-y-4">
            <h3 className="text-lg font-bold text-destructive">
              {t("backup.restore_title", "שחזור נתונים")}
            </h3>
            <p className="text-sm font-medium" dir="ltr">
              {when(restoring.created_at)}
              {restoring.note ? ` · ${restoring.note}` : ""}
            </p>
            <p className="text-sm text-foreground">
              {t(
                "backup.restore_warning",
                "כל נתוני הארגון הנוכחיים יוחלפו בנתוני נקודת השחזור הזו. נקודת שחזור אוטומטית של המצב הנוכחי תיווצר לפני השחזור, כך שניתן לבטל.",
              )}
            </p>
            <p className="text-sm font-semibold">{t("admin.confirm_sure", "בטוח ?")}</p>
            <div className="flex items-center gap-2 pt-1">
              <Button
                type="button"
                onClick={() => restore(restoring)}
                className="bg-status-darkred hover:bg-destructive/90"
              >
                {t("backup.restore", "שחזר")}
              </Button>
              <Button type="button" variant="outline" onClick={() => setRestoring(null)}>
                {t("action.cancel", "ביטול")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

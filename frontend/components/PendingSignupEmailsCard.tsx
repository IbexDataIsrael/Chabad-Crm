"use client";

import { Plus, Save, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { apiFetch } from "@/lib/api";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";
import { isValidEmail } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/** fixes81 §3: superadmin editor for who gets the "new organization pending
 *  approval" email — one or more addresses, on top of the server's own
 *  PLATFORM_ADMIN_EMAIL / SUPERADMIN_EMAIL. */
export function PendingSignupEmailsCard() {
  const { t } = useLocalization();
  const { success, error } = useToast();

  const [emails, setEmails] = useState<string[] | null>(null);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<{ emails: string[] }>("/api/admin/pending-signup-emails")
      .then((r) => setEmails(r.emails))
      .catch((e) => {
        error(e instanceof Error ? e.message : t("msg.load_failed", "הטעינה נכשלה"));
        setEmails([]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function add(e: FormEvent) {
    e.preventDefault();
    const value = draft.trim().toLowerCase();
    if (!value) return;
    if (!isValidEmail(value)) {
      setDraftError(t("msg.invalid_email", "כתובת אימייל לא תקינה"));
      return;
    }
    setDraftError("");
    setDraft("");
    if (emails?.includes(value)) return;
    setEmails([...(emails ?? []), value]);
    setDirty(true);
  }

  function remove(value: string) {
    setEmails((emails ?? []).filter((x) => x !== value));
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    try {
      const r = await apiFetch<{ emails: string[] }>("/api/admin/pending-signup-emails", {
        method: "PUT",
        body: JSON.stringify({ emails: emails ?? [] }),
      });
      setEmails(r.emails);
      setDirty(false);
      success(t("msg.saved", "נשמר בהצלחה"));
    } catch (e) {
      error(e instanceof Error ? e.message : t("msg.save_failed", "שמירה נכשלה"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-4 space-y-3">
      <div>
        <h2 className="font-semibold">
          {t("admin.pending_signup_emails_title", "התראות על ארגון ממתין לאישור")}
        </h2>
        <p className="text-xs text-muted-foreground">
          {t(
            "admin.pending_signup_emails_intro",
            "כתובות שיקבלו מייל כשארגון חדש נרשם וממתין לאישור (בנוסף לכתובת מנהל המערכת).",
          )}
        </p>
      </div>

      {emails === null ? (
        <p className="text-sm text-muted-foreground">{t("action.loading", "טוען…")}</p>
      ) : (
        <>
          {emails.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("admin.pending_signup_emails_none", "לא הוגדרו כתובות נוספות.")}
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {emails.map((e) => (
                <li
                  key={e}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1 text-sm"
                >
                  <span dir="ltr">{e}</span>
                  <button
                    type="button"
                    onClick={() => remove(e)}
                    className="rounded-full p-0.5 text-muted-foreground hover:bg-status-darkred/10 hover:text-status-darkred"
                    aria-label={t("action.delete", "מחק")}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={add} noValidate className="flex flex-wrap items-start gap-2">
            <div className="min-w-[240px] flex-1 space-y-1">
              <Input
                dir="ltr"
                type="email"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setDraftError("");
                }}
                placeholder="name@example.com"
              />
              {draftError && <p className="text-xs text-status-darkred">{draftError}</p>}
            </div>
            <Button type="submit" variant="outline">
              <Plus className="h-4 w-4" /> {t("action.add", "הוסף")}
            </Button>
            <Button type="button" onClick={save} disabled={!dirty || saving}>
              <Save className="h-4 w-4" />
              {saving ? t("action.saving", "שומר…") : t("action.save", "שמור")}
            </Button>
          </form>
        </>
      )}
    </Card>
  );
}

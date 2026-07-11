"use client";

import { useEffect, useState } from "react";

import { RichTextEditor } from "@/components/RichTextEditor";
import {
  adminListEmailTemplates,
  adminUpdateEmailTemplate,
  type EmailTemplate,
} from "@/lib/api";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";

// Friendly bilingual labels for the (stable, technical) template keys.
const TEMPLATE_LABELS: Record<string, string> = {
  aignummail1: "מייל בקשה התקבלה (למשתמש)",
  aignummail2: "מייל אישור הארגון (למשתמש)",
  shliach_welcome: "מייל קבלת פנים (פעיל / משתמש חדש)",
};

// Which {{placeholders}} each template understands (shown as a hint).
const TEMPLATE_PLACEHOLDERS: Record<string, string> = {
  aignummail1: "{{user_name}}, {{org_name}}",
  aignummail2: "{{user_name}}, {{org_name}}, {{login_link}}",
  shliach_welcome:
    "{{first_name}}, {{last_name}}, {{url_to_system}}, {{shliach_email}}, {{org_name}}, {{logo_url}}",
};

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none";

/** Superadmin editor for the platform's bilingual email templates. Each row
 * edits subject + Hebrew body + English body; the sent mail combines both. */
export function EmailTemplatesCard() {
  const { t } = useLocalization();
  const { success, error } = useToast();

  const [templates, setTemplates] = useState<EmailTemplate[] | null>(null);
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, EmailTemplate>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  async function load() {
    try {
      const rows = await adminListEmailTemplates();
      setTemplates(rows);
      setDrafts(Object.fromEntries(rows.map((r) => [r.key, r])));
    } catch (e) {
      error(e instanceof Error ? e.message : "Failed to load email templates");
      setTemplates([]);
    }
  }

  useEffect(() => {
    if (open && templates === null) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function setField(key: string, field: keyof EmailTemplate, value: string) {
    setDrafts((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  }

  async function onSave(key: string) {
    const draft = drafts[key];
    if (!draft) return;
    setSavingKey(key);
    try {
      const saved = await adminUpdateEmailTemplate(key, {
        subject: draft.subject,
        body_hebrew: draft.body_hebrew,
        body: draft.body,
      });
      setDrafts((prev) => ({ ...prev, [key]: saved }));
      setTemplates((prev) =>
        prev ? prev.map((tpl) => (tpl.key === key ? saved : tpl)) : prev,
      );
      success(t("admin.template_saved", "התבנית נשמרה"));
    } catch (e) {
      error(e instanceof Error ? e.message : "Failed to save template");
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between p-4 text-start"
      >
        <span className="font-semibold">
          {t("admin.email_templates", "תבניות אימייל")}
        </span>
        <span className="text-gray-400 text-sm">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-gray-100 bg-gray-50/60 p-4 space-y-6">
          {templates === null ? (
            <p className="text-sm text-gray-400">{t("action.loading", "טוען…")}</p>
          ) : templates.length === 0 ? (
            <p className="text-sm text-gray-400">
              {t("admin.no_templates", "אין תבניות.")}
            </p>
          ) : (
            templates.map((tpl) => {
              const draft = drafts[tpl.key] ?? tpl;
              return (
                <div key={tpl.key} className="space-y-2">
                  <h3 className="text-sm font-medium">
                    {t(`admin.template.${tpl.key}`, TEMPLATE_LABELS[tpl.key] ?? tpl.key)}
                    <span className="text-gray-400 ms-2 text-xs" dir="ltr">
                      {tpl.key}
                    </span>
                  </h3>
                  <label className="block text-xs text-gray-500">
                    {t("admin.template_subject", "נושא")}
                  </label>
                  <input
                    className={inputClass}
                    value={draft.subject}
                    onChange={(e) => setField(tpl.key, "subject", e.target.value)}
                  />
                  <label className="block text-xs text-gray-500">
                    {t("admin.template_body_he", "תוכן (עברית)")}
                  </label>
                  {/* fixes15 §2.1: WYSIWYG editing (HTML templates included). */}
                  <RichTextEditor
                    dir="rtl"
                    value={draft.body_hebrew}
                    onChange={(html) => setField(tpl.key, "body_hebrew", html)}
                  />
                  <label className="block text-xs text-gray-500">
                    {t("admin.template_body_en", "תוכן (אנגלית)")}
                  </label>
                  <RichTextEditor
                    dir="ltr"
                    value={draft.body}
                    onChange={(html) => setField(tpl.key, "body", html)}
                  />
                  <p className="text-xs text-gray-400" dir="ltr">
                    {TEMPLATE_PLACEHOLDERS[tpl.key] ??
                      t(
                        "admin.template_placeholders",
                        "ניתן להשתמש ב-{{user_name}}, {{org_name}}, {{login_link}}",
                      )}
                  </p>
                  <button
                    disabled={savingKey === tpl.key}
                    onClick={() => onSave(tpl.key)}
                    className="rounded-md bg-status-magenta text-white px-4 py-1.5 text-sm font-medium hover:opacity-90 disabled:opacity-50"
                  >
                    {savingKey === tpl.key
                      ? t("action.saving", "שומר…")
                      : t("action.save", "שמור")}
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import { ChevronDown, ChevronUp, Save } from "lucide-react";
import { useEffect, useState } from "react";

import { RichTextEditor } from "@/components/RichTextEditor";
import {
  adminListEmailTemplates,
  adminUpdateEmailTemplate,
  type EmailTemplate,
} from "@/lib/api";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

/** Superadmin editor for the platform's bilingual email templates. Each row
 * edits subject + Hebrew body + English body; the sent mail combines both. */
export function EmailTemplatesCard({ defaultOpen = false }: { defaultOpen?: boolean } = {}) {
  const { t } = useLocalization();
  const { success, error } = useToast();

  const [templates, setTemplates] = useState<EmailTemplate[] | null>(null);
  const [open, setOpen] = useState(defaultOpen);
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
    <Card className="overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between p-4 text-start"
      >
        <span className="font-semibold">
          {t("admin.email_templates", "תבניות אימייל")}
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="border-t border-border bg-background/60 p-4 space-y-6">
          {templates === null ? (
            <p className="text-sm text-muted-foreground">{t("action.loading", "טוען…")}</p>
          ) : templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("admin.no_templates", "אין תבניות.")}
            </p>
          ) : (
            templates.map((tpl) => {
              const draft = drafts[tpl.key] ?? tpl;
              return (
                <div key={tpl.key} className="space-y-2">
                  <h3 className="text-sm font-medium">
                    {t(`admin.template.${tpl.key}`, TEMPLATE_LABELS[tpl.key] ?? tpl.key)}
                    <span className="text-muted-foreground ms-2 text-xs" dir="ltr">
                      {tpl.key}
                    </span>
                  </h3>
                  <Label className="block text-xs text-muted-foreground">
                    {t("admin.template_subject", "נושא")}
                  </Label>
                  <Input
                    value={draft.subject}
                    onChange={(e) => setField(tpl.key, "subject", e.target.value)}
                  />
                  <Label className="block text-xs text-muted-foreground">
                    {t("admin.template_body_he", "תוכן (עברית)")}
                  </Label>
                  {/* fixes15 §2.1: WYSIWYG editing (HTML templates included). */}
                  <RichTextEditor
                    dir="rtl"
                    value={draft.body_hebrew}
                    onChange={(html) => setField(tpl.key, "body_hebrew", html)}
                  />
                  <Label className="block text-xs text-muted-foreground">
                    {t("admin.template_body_en", "תוכן (אנגלית)")}
                  </Label>
                  <RichTextEditor
                    dir="ltr"
                    value={draft.body}
                    onChange={(html) => setField(tpl.key, "body", html)}
                  />
                  <p className="text-xs text-muted-foreground" dir="ltr">
                    {TEMPLATE_PLACEHOLDERS[tpl.key] ??
                      t(
                        "admin.template_placeholders",
                        "ניתן להשתמש ב-{{user_name}}, {{org_name}}, {{login_link}}",
                      )}
                  </p>
                  <Button size="sm" disabled={savingKey === tpl.key} onClick={() => onSave(tpl.key)}>
                    <Save className="h-4 w-4" />
                    {savingKey === tpl.key
                      ? t("action.saving", "שומר…")
                      : t("action.save", "שמור")}
                  </Button>
                </div>
              );
            })
          )}
        </div>
      )}
    </Card>
  );
}

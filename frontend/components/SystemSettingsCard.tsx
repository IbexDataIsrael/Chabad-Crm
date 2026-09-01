"use client";

import { ChevronDown, ChevronUp, Save } from "lucide-react";
import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface SystemConfig {
  title_template: string;
  fallback_name: string;
}

/** Superadmin editor for the platform title configuration (fixes9 §1):
 *  the <title> template and the fallback org name. */
export function SystemSettingsCard() {
  const { t } = useLocalization();
  const { success, error } = useToast();

  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || config !== null) return;
    apiFetch<SystemConfig>("/api/admin/system-settings")
      .then(setConfig)
      .catch((e) => {
        error(e instanceof Error ? e.message : "Failed to load system settings");
        setConfig({ title_template: "", fallback_name: "" });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function onSave() {
    if (!config) return;
    setSaving(true);
    try {
      setConfig(
        await apiFetch<SystemConfig>("/api/admin/system-settings", {
          method: "PUT",
          body: JSON.stringify(config),
        }),
      );
      success(t("msg.saved", "נשמר בהצלחה"));
    } catch (e) {
      error(e instanceof Error ? e.message : t("msg.save_failed", "שמירה נכשלה"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between p-4 text-start"
      >
        <span className="font-semibold">
          {t("admin.system_settings_title", "הגדרות מערכת")}
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="border-t border-border bg-background/60 p-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            {t(
              "admin.system_settings_intro",
              "תבנית כותרת הדפדפן לכל העמודים ושם ברירת מחדל כשאין שם ארגון.",
            )}
          </p>
          {config === null ? (
            <p className="text-sm text-muted-foreground">{t("action.loading", "טוען…")}</p>
          ) : (
            <>
              <Label className="block text-xs text-muted-foreground">
                {t("admin.title_template", "תבנית כותרת המערכת")}
              </Label>
              <Input
                dir="ltr"
                value={config.title_template}
                onChange={(e) =>
                  setConfig({ ...config, title_template: e.target.value })
                }
              />
              <p className="text-xs text-muted-foreground" dir="ltr">
                {t(
                  "admin.title_template_hint",
                  "{public.organizations.name} יוחלף בשם הארגון.",
                )}
              </p>
              <Label className="block text-xs text-muted-foreground">
                {t("admin.fallback_name", "שם זמני / ברירת מחדל")}
              </Label>
              <Input
                value={config.fallback_name}
                onChange={(e) =>
                  setConfig({ ...config, fallback_name: e.target.value })
                }
              />
              <Button size="sm" disabled={saving} onClick={onSave}>
                <Save className="h-4 w-4" />
                {saving ? t("action.saving", "שומר…") : t("action.save", "שמור")}
              </Button>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

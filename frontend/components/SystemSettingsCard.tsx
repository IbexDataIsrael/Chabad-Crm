"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";

interface SystemConfig {
  title_template: string;
  fallback_name: string;
}

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none";

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
    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between p-4 text-start"
      >
        <span className="font-semibold">
          {t("admin.system_settings_title", "הגדרות מערכת")}
        </span>
        <span className="text-gray-400 text-sm">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-gray-100 bg-gray-50/60 p-4 space-y-3">
          <p className="text-xs text-gray-500">
            {t(
              "admin.system_settings_intro",
              "תבנית כותרת הדפדפן לכל העמודים ושם ברירת מחדל כשאין שם ארגון.",
            )}
          </p>
          {config === null ? (
            <p className="text-sm text-gray-400">{t("action.loading", "טוען…")}</p>
          ) : (
            <>
              <label className="block text-xs text-gray-500">
                {t("admin.title_template", "תבנית כותרת המערכת")}
              </label>
              <input
                className={inputClass}
                dir="ltr"
                value={config.title_template}
                onChange={(e) =>
                  setConfig({ ...config, title_template: e.target.value })
                }
              />
              <p className="text-xs text-gray-400" dir="ltr">
                {t(
                  "admin.title_template_hint",
                  "{public.organizations.name} יוחלף בשם הארגון.",
                )}
              </p>
              <label className="block text-xs text-gray-500">
                {t("admin.fallback_name", "שם זמני / ברירת מחדל")}
              </label>
              <input
                className={inputClass}
                value={config.fallback_name}
                onChange={(e) =>
                  setConfig({ ...config, fallback_name: e.target.value })
                }
              />
              <button
                disabled={saving}
                onClick={onSave}
                className="rounded-md bg-status-magenta text-white px-4 py-1.5 text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                {saving ? t("action.saving", "שומר…") : t("action.save", "שמור")}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

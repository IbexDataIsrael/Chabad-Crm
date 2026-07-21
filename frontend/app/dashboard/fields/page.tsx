"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useFieldSettings, type FieldSetting } from "@/lib/fieldSettings";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";
import type { CustomFieldDefinition } from "@/lib/types";

// Display order + heading key for each entity group.
const ENTITY_GROUPS: { entity: string; labelKey: string; fallback: string }[] = [
  { entity: "contact", labelKey: "contacts", fallback: "אנשי קשר" },
  { entity: "contact_mekurav", labelKey: "contact_mekurav", fallback: "מקורב" },
  { entity: "contact_shliach", labelKey: "contact_shliach", fallback: "פעיל" },
  { entity: "building", labelKey: "building", fallback: "בניין" },
  { entity: "apartment", labelKey: "apartment", fallback: "דירה" },
  // fixes27 §4: built-in visit fields (Mivtzoim flags, torah thought, rebbe).
  { entity: "visit", labelKey: "page.visits", fallback: "ביקורים" },
];

export default function FieldsPage() {
  const { isAdmin, loading: authLoading } = useAuth();
  const { t } = useLocalization();
  const { settings, refresh } = useFieldSettings();
  const { success, error } = useToast();

  async function toggle(field_key: string, is_visible: boolean) {
    try {
      await apiFetch("/api/field-settings", {
        method: "PUT",
        body: JSON.stringify({ field_key, is_visible }),
      });
      await refresh();
      success(is_visible ? t("msg.shown", "השדה הוצג") : t("msg.hidden", "השדה הוסתר"));
    } catch (err) {
      error(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    }
  }

  if (authLoading) return <p className="text-gray-400">{t("action.loading", "טוען…")}</p>;
  if (!isAdmin) {
    return (
      <p className="text-status-darkred">
        {t("page.admins_only", "אין לך הרשאה לעמוד זה (מנהלים בלבד).")}
      </p>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">{t("page.fields_title", "ניהול שדות")}</h1>
        <p className="text-sm text-gray-500">
          {t(
            "page.fields_intro",
            "בחר אילו שדות יופיעו בכרטיס איש הקשר, בטופס וברשימה. שדות שיוסתרו לא יוצגו בשום מקום במערכת.",
          )}
        </p>
      </div>

      {ENTITY_GROUPS.map(({ entity, labelKey, fallback }) => {
        const group = settings.filter((s) => s.entity === entity);
        if (group.length === 0) return null;
        return (
          <section key={entity} className="bg-white rounded-xl shadow-sm">
            <h2 className="px-4 py-2 text-sm font-semibold border-b border-gray-100">
              {t(labelKey, fallback)}
            </h2>
            <ul className="divide-y divide-gray-100">
              {group.map((f) => (
                <FieldRow key={f.field_key} field={f} onToggle={toggle} />
              ))}
            </ul>
          </section>
        );
      })}

      <CustomFieldsSection />
    </div>
  );
}

function FieldRow({
  field,
  onToggle,
}: {
  field: FieldSetting;
  onToggle: (key: string, visible: boolean) => Promise<void>;
}) {
  const { t, lang } = useLocalization();
  // fixes33 §5.1: a dynamic custom-picklist row carries its own bilingual
  // name directly (no field_localization row exists for per-org custom text)
  // — everything else resolves through the usual localization table.
  const label =
    field.label != null
      ? (lang === "en" ? field.english_label || field.label : field.label)
      : t(field.label_key, field.field_key);
  return (
    <li className="px-4 py-2 flex items-center justify-between gap-3">
      <span className={`text-sm ${field.is_visible ? "" : "text-gray-400"}`}>
        {label}
      </span>
      <label className="inline-flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
        {field.is_visible ? t("fields.shown", "מוצג") : t("fields.hidden", "מוסתר")}
        <input
          type="checkbox"
          className="h-4 w-4 accent-status-magenta"
          checked={field.is_visible}
          onChange={(e) => onToggle(field.field_key, e.target.checked)}
        />
      </label>
    </li>
  );
}

/** Custom fields (from /dashboard/custom-fields) can also be shown/hidden here. */
function CustomFieldsSection() {
  const { t } = useLocalization();
  const { success, error } = useToast();
  const [defs, setDefs] = useState<CustomFieldDefinition[]>([]);

  async function reload() {
    try {
      setDefs(
        await apiFetch<CustomFieldDefinition[]>(
          "/api/custom-fields?include_inactive=true",
        ),
      );
    } catch {
      setDefs([]);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function toggle(def: CustomFieldDefinition, show: boolean) {
    try {
      if (show) {
        await apiFetch(`/api/custom-fields/${def.id}`, {
          method: "PUT",
          body: JSON.stringify({ is_active: true }),
        });
      } else {
        await apiFetch(`/api/custom-fields/${def.id}`, { method: "DELETE" });
      }
      await reload();
      success(show ? t("msg.shown", "השדה הוצג") : t("msg.hidden", "השדה הוסתר"));
    } catch (err) {
      error(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    }
  }

  return (
    <section className="bg-white rounded-xl shadow-sm">
      <div className="px-4 py-2 flex items-center justify-between border-b border-gray-100">
        <h2 className="text-sm font-semibold">{t("page.extra_fields", "שדות נוספים")}</h2>
        <Link
          href="/dashboard/custom-fields"
          className="text-xs text-status-magenta hover:underline"
        >
          {t("fields.manage_custom", "הוספה / מחיקה")} ←
        </Link>
      </div>
      {defs.length === 0 ? (
        <p className="px-4 py-4 text-sm text-gray-400">
          {t("cf.none", "אין שדות מותאמים עדיין.")}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {defs.map((d) => (
            <li key={d.id} className="px-4 py-2 flex items-center justify-between gap-3">
              <span className={`text-sm ${d.is_active ? "" : "text-gray-400"}`}>
                {d.hebrew_label}
              </span>
              <label className="inline-flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
                {d.is_active ? t("fields.shown", "מוצג") : t("fields.hidden", "מוסתר")}
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-status-magenta"
                  checked={d.is_active}
                  onChange={(e) => toggle(d, e.target.checked)}
                />
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

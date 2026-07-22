"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";
import type { CustomFieldDefinition, CustomFieldEntityType, CustomFieldType } from "@/lib/types";
import { useConfirm } from "@/lib/confirm";

// fixes35 §2: every entity a custom field can attach to, matching
// dashboard/fields's own ENTITY_GROUPS labels for consistency.
const ENTITY_TYPES: { value: CustomFieldEntityType; labelKey: string; fallback: string }[] = [
  { value: "contact_mekurav", labelKey: "contact_mekurav", fallback: "מקורב" },
  { value: "contact_shliach", labelKey: "contact_shliach", fallback: "פעיל" },
  { value: "visit", labelKey: "page.visits", fallback: "ביקורים" },
  { value: "apartment", labelKey: "apartment", fallback: "דירה" },
];

const FIELD_TYPES: { value: CustomFieldType; labelKey: string; fallback: string }[] = [
  { value: "text", labelKey: "cf.type.text", fallback: "טקסט" },
  { value: "number", labelKey: "cf.type.number", fallback: "מספר" },
  { value: "boolean", labelKey: "cf.type.boolean", fallback: "תיבת סימון" },
  { value: "date", labelKey: "cf.type.date", fallback: "תאריך" },
  { value: "select", labelKey: "cf.type.select", fallback: "רשימת בחירה" },
];

export default function CustomFieldsPage() {
  const { isAdmin, loading } = useAuth();
  const { t } = useLocalization();
  const [defs, setDefs] = useState<CustomFieldDefinition[]>([]);

  async function reload() {
    setDefs(
      await apiFetch<CustomFieldDefinition[]>("/api/custom-fields?include_inactive=true"),
    );
  }

  useEffect(() => {
    reload().catch(() => {});
  }, []);

  if (loading) return <p className="text-gray-400">{t("action.loading", "טוען…")}</p>;
  if (!isAdmin) {
    return (
      <p className="text-status-darkred">
        {t("page.admins_only", "אין לך הרשאה לעמוד זה (מנהלים בלבד).")}
      </p>
    );
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <h1 className="text-2xl font-bold">{t("cf.title", "שדות מותאמים אישית")}</h1>
      <p className="text-sm text-gray-500">
        {t(
          "cf.intro",
          "הגדירו שדה מותאם אישית עבור אנשי קשר, פעילים, ביקורים או דירות — מכל סוג: טקסט, מספר, תיבת סימון, תאריך או רשימת בחירה.",
        )}
      </p>

      <AddDef onAdded={reload} />

      {ENTITY_TYPES.map(({ value, labelKey, fallback }) => {
        const group = defs.filter((d) => d.entity_type === value);
        if (group.length === 0) return null;
        return (
          <section key={value} className="bg-white rounded-xl shadow-sm">
            <h2 className="px-4 py-2 border-b border-gray-100 text-sm font-semibold">
              {t(labelKey, fallback)}
            </h2>
            <div className="divide-y divide-gray-100">
              {group.map((d) => (
                <DefRow key={d.id} def={d} onChanged={reload} />
              ))}
            </div>
          </section>
        );
      })}
      {defs.length === 0 && (
        <p className="px-4 py-6 text-center text-gray-400 bg-white rounded-xl shadow-sm">
          {t("cf.none", "אין שדות מותאמים עדיין.")}
        </p>
      )}

      {/* fixes35 §2: visibility toggling lives entirely on Manage Fields now
          (every custom field auto-appears there) — no need to duplicate the
          toggle UI on this page too. */}
      <Link
        href="/dashboard/fields"
        className="inline-block text-sm text-status-magenta hover:underline"
      >
        {t("cf.manage_visibility", "לניהול הצגה/הסתרה של שדות →")}
      </Link>
    </div>
  );
}

function DefRow({
  def,
  onChanged,
}: {
  def: CustomFieldDefinition;
  onChanged: () => Promise<void>;
}) {
  const { t, lang } = useLocalization();
  const confirmDialog = useConfirm();
  const { success, error } = useToast();
  const [label, setLabel] = useState(def.hebrew_label);
  const [englishLabel, setEnglishLabel] = useState(def.english_label ?? "");

  async function save() {
    try {
      await apiFetch(`/api/custom-fields/${def.id}`, {
        method: "PUT",
        body: JSON.stringify({ hebrew_label: label, english_label: englishLabel || null }),
      });
      await onChanged();
      success(t("msg.saved", "נשמר בהצלחה"));
    } catch (err) {
      error(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    }
  }

  async function deactivate() {
    try {
      await apiFetch(`/api/custom-fields/${def.id}`, { method: "DELETE" });
      await onChanged();
      success(t("msg.hidden", "השדה הוסתר"));
    } catch (err) {
      error(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    }
  }

  async function reactivate() {
    try {
      await apiFetch(`/api/custom-fields/${def.id}`, {
        method: "PUT",
        body: JSON.stringify({ is_active: true }),
      });
      await onChanged();
      success(t("msg.shown", "השדה הוצג"));
    } catch (err) {
      error(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    }
  }

  async function hardDelete() {
    if (!(await confirmDialog({ message: t("cf.hard_delete_confirm", "למחוק לצמיתות את כל הערכים?"), detail: def.field_key })))
      return;
    try {
      await apiFetch(`/api/custom-fields/${def.id}?hard=true`, { method: "DELETE" });
      await onChanged();
      success(t("msg.deleted", "נמחק"));
    } catch (err) {
      error(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    }
  }

  const input = "rounded-md border border-gray-300 px-2 py-1 text-sm";
  const fieldTypeLabel =
    FIELD_TYPES.find((f) => f.value === def.field_type) &&
    t(
      FIELD_TYPES.find((f) => f.value === def.field_type)!.labelKey,
      FIELD_TYPES.find((f) => f.value === def.field_type)!.fallback,
    );

  return (
    <div
      className={`px-4 py-2 flex flex-wrap items-center gap-2 ${
        def.is_active ? "" : "opacity-60"
      }`}
    >
      <code className="text-xs text-gray-400 w-32 shrink-0" dir="ltr">
        {def.field_key}
      </code>
      <span className="rounded bg-gray-100 text-gray-500 text-xs px-2 py-0.5 shrink-0">
        {fieldTypeLabel}
      </span>
      <input
        className={`${input} flex-1 min-w-[7rem]`}
        placeholder={t("cf.label_placeholder", "תווית בעברית")}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <input
        className={`${input} flex-1 min-w-[7rem]`}
        dir="ltr"
        placeholder="English label"
        value={englishLabel}
        onChange={(e) => setEnglishLabel(e.target.value)}
      />
      {!def.is_active && (
        <span className="rounded bg-gray-200 text-gray-600 text-xs px-2 py-0.5">{t("cf.disabled", "מושבת")}</span>
      )}
      <div className="flex items-center gap-1 ms-auto">
        <button
          onClick={save}
          className="rounded-md bg-gray-800 text-white px-3 py-1 text-xs hover:opacity-90"
        >
          {t("action.save", "שמור")}
        </button>
        {def.is_active ? (
          <button
            onClick={deactivate}
            className="rounded-md border border-status-darkred/40 text-status-darkred px-2 py-1 text-xs hover:bg-red-50"
          >
            {t("action.delete", "מחק")}
          </button>
        ) : (
          <>
            <button
              onClick={reactivate}
              className="rounded-md border border-status-green/40 text-status-green px-2 py-1 text-xs hover:bg-green-50"
            >
              {t("cf.activate", "הפעל")}
            </button>
            <button
              onClick={hardDelete}
              className="text-xs text-status-darkred hover:underline"
            >
              {t("cf.hard_delete", "מחק לצמיתות")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function AddDef({ onAdded }: { onAdded: () => Promise<void> }) {
  const { t } = useLocalization();
  const { success } = useToast();
  const [entityType, setEntityType] = useState<CustomFieldEntityType>("contact_mekurav");
  const [fieldType, setFieldType] = useState<CustomFieldType>("text");
  const [fieldKey, setFieldKey] = useState("");
  const [label, setLabel] = useState("");
  const [englishLabel, setEnglishLabel] = useState("");
  const [options, setOptions] = useState<string[]>([""]);
  const [error, setError] = useState("");

  async function add(e: FormEvent) {
    e.preventDefault();
    setError("");
    const cleanOptions = options.map((o) => o.trim()).filter(Boolean);
    if (fieldType === "select" && cleanOptions.length === 0) {
      setError(t("cf.options_required", "יש להוסיף לפחות אפשרות אחת"));
      return;
    }
    try {
      await apiFetch("/api/custom-fields", {
        method: "POST",
        body: JSON.stringify({
          field_key: fieldKey,
          hebrew_label: label,
          english_label: englishLabel || null,
          entity_type: entityType,
          field_type: fieldType,
          picklist_options: fieldType === "select" ? cleanOptions : undefined,
        }),
      });
      setFieldKey("");
      setLabel("");
      setEnglishLabel("");
      setOptions([""]);
      await onAdded();
      success(t("msg.added", "נוסף בהצלחה"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("cf.add_failed", "הוספה נכשלה"));
    }
  }

  const input = "rounded-md border border-gray-300 px-2 py-1 text-sm";

  return (
    <form onSubmit={add} className="bg-white rounded-xl shadow-sm p-4 space-y-2">
      <h3 className="font-medium text-sm">{t("cf.add_field", "הוספת שדה")}</h3>
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          {t("cf.entity_type", "שייך ל")}
          <select
            className={input}
            value={entityType}
            onChange={(e) => setEntityType(e.target.value as CustomFieldEntityType)}
          >
            {ENTITY_TYPES.map(({ value, labelKey, fallback }) => (
              <option key={value} value={value}>
                {t(labelKey, fallback)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          {t("cf.field_type", "סוג שדה")}
          <select
            className={input}
            value={fieldType}
            onChange={(e) => setFieldType(e.target.value as CustomFieldType)}
          >
            {FIELD_TYPES.map(({ value, labelKey, fallback }) => (
              <option key={value} value={value}>
                {t(labelKey, fallback)}
              </option>
            ))}
          </select>
        </label>
        <input
          className={`${input} w-44 self-end`}
          placeholder={t("cf.key_placeholder", "מפתח (אנגלית) — hanuka_party")}
          value={fieldKey}
          onChange={(e) => setFieldKey(e.target.value)}
          dir="ltr"
          required
        />
        <input
          className={`${input} flex-1 min-w-[8rem] self-end`}
          placeholder={t("cf.label_placeholder", "תווית בעברית")}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          required
        />
        <input
          className={`${input} flex-1 min-w-[8rem] self-end`}
          placeholder="English label"
          dir="ltr"
          value={englishLabel}
          onChange={(e) => setEnglishLabel(e.target.value)}
        />
        <button
          type="submit"
          className="self-end rounded-md bg-status-magenta text-white px-4 py-1.5 text-sm font-medium hover:opacity-90"
        >
          {t("action.add", "הוסף")}
        </button>
      </div>

      {fieldType === "select" && (
        <div className="space-y-1 pt-1">
          <p className="text-xs text-gray-500">{t("cf.options", "אפשרויות (רשימת בחירה)")}</p>
          {options.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                className={`${input} w-56`}
                placeholder={t("cf.option_placeholder", "אפשרות…")}
                value={opt}
                onChange={(e) =>
                  setOptions((prev) => prev.map((o, j) => (j === i ? e.target.value : o)))
                }
              />
              {options.length > 1 && (
                <button
                  type="button"
                  onClick={() => setOptions((prev) => prev.filter((_, j) => j !== i))}
                  className="text-xs text-status-darkred hover:underline"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setOptions((prev) => [...prev, ""])}
            className="text-xs text-status-magenta hover:underline"
          >
            {t("cf.add_option", "+ אפשרות")}
          </button>
        </div>
      )}

      {error && <p className="text-sm text-status-darkred">{error}</p>}
    </form>
  );
}

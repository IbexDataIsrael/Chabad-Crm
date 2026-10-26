"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useConfirm } from "@/lib/confirm";
import { confirmHardDelete } from "@/lib/dependentDelete";
import { useLocalization } from "@/lib/localization";
import { usePersistentState } from "@/lib/persist";
import { useToast } from "@/lib/toast";
import type { CustomFieldDefinition, CustomFieldEntityType, CustomFieldType } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

// fixes35 §2: every entity a custom field can attach to, matching
// dashboard/fields's own ENTITY_GROUPS labels for consistency.
const ENTITY_TYPES: { value: CustomFieldEntityType; labelKey: string; fallback: string }[] = [
  { value: "contact_mekurav", labelKey: "contact_mekurav", fallback: "מקורב" },
  { value: "contact_shliach", labelKey: "contact_shliach", fallback: "פעיל" },
  { value: "visit", labelKey: "page.visits", fallback: "ביקורים" },
  { value: "apartment", labelKey: "apartment", fallback: "דירה" },
  { value: "task", labelKey: "nav.tasks", fallback: "משימות" },
];

const FIELD_TYPES: { value: CustomFieldType; labelKey: string; fallback: string }[] = [
  { value: "text", labelKey: "cf.type.text", fallback: "טקסט" },
  { value: "number", labelKey: "cf.type.number", fallback: "מספר" },
  { value: "boolean", labelKey: "cf.type.boolean", fallback: "תיבת סימון" },
  { value: "date", labelKey: "cf.type.date", fallback: "תאריך" },
  { value: "select", labelKey: "cf.type.select", fallback: "רשימת בחירה" },
];

// fixes40 §1: which of the 3 admin tabs a custom field is managed from —
// same grouping `dashboard/picklists` uses for the exact same entity_type
// vocabulary (contact_mekurav/contact_shliach group under "contacts").
// fixes60 §3: "shliach" split out of "contacts" into its own tab, mirroring
// dashboard/picklists's already-working 5-tab pattern for this exact
// entity_type vocabulary.
type CFTab = "contacts" | "visit" | "apartment" | "shliach" | "tasks";
function tabFor(entityType: CustomFieldEntityType): CFTab {
  if (entityType === "apartment") return "apartment";
  if (entityType === "visit") return "visit";
  if (entityType === "contact_shliach") return "shliach";
  // fixes58 §Phase 5.
  if (entityType === "task") return "tasks";
  return "contacts";
}

const TABS: { key: CFTab; icon: string; labelKey: string; fallback: string }[] = [
  { key: "contacts", icon: "👤", labelKey: "pl.tab_contacts", fallback: "אנשי קשר" },
  { key: "visit", icon: "📋", labelKey: "pl.tab_visit", fallback: "ביקורים" },
  { key: "apartment", icon: "🏠", labelKey: "pl.tab_apartment", fallback: "דירה" },
  { key: "shliach", icon: "🧑‍🏫", labelKey: "pl.tab_shliach", fallback: "פעילים" },
  { key: "tasks", icon: "✅", labelKey: "nav.tasks", fallback: "משימות" },
];

export default function CustomFieldsPage() {
  const { isAdmin, loading } = useAuth();
  const { t } = useLocalization();
  const [defs, setDefs] = useState<CustomFieldDefinition[]>([]);
  const [tab, setTab] = usePersistentState<CFTab>("crm.customfields.tab", "contacts");

  async function reload() {
    setDefs(
      await apiFetch<CustomFieldDefinition[]>("/api/custom-fields?include_inactive=true"),
    );
  }

  useEffect(() => {
    reload().catch(() => {});
  }, []);

  if (loading) return <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>;
  if (!isAdmin) {
    return (
      <p className="text-destructive">
        {t("page.admins_only", "אין לך הרשאה לעמוד זה (מנהלים בלבד).")}
      </p>
    );
  }

  // fixes40 §1: each tab's own entity_type subset — "contacts" spans two
  // (mekurav/shliach), "visit"/"apartment" are single-entity.
  function renderGroups(entityTypes: CustomFieldEntityType[]) {
    return entityTypes.map((value) => {
      const meta = ENTITY_TYPES.find((e) => e.value === value)!;
      const group = defs.filter((d) => d.entity_type === value);
      // A single-entity tab needs no sub-heading; "contacts" (2 entities)
      // keeps the existing per-entity grouping for clarity.
      const showHeading = entityTypes.length > 1;
      if (group.length === 0 && !showHeading) return null;
      return (
        <section key={value} className="bg-card rounded-xl shadow-sm">
          {showHeading && (
            <h2 className="px-4 py-2 border-b border-border text-sm font-semibold">
              {t(meta.labelKey, meta.fallback)}
            </h2>
          )}
          <div className="divide-y divide-border">
            {group.map((d) => (
              <DefRow key={d.id} def={d} onChanged={reload} />
            ))}
          </div>
          {group.length === 0 && (
            <p className="px-4 py-6 text-center text-muted-foreground">
              {t("cf.none", "אין שדות מותאמים עדיין.")}
            </p>
          )}
        </section>
      );
    });
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="font-display text-3xl font-bold">{t("cf.title", "שדות מותאמים אישית")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "cf.intro",
            "הגדירו שדה מותאם אישית עבור אנשי קשר, פעילים, ביקורים או דירות — מכל סוג: טקסט, מספר, תיבת סימון, תאריך או רשימת בחירה.",
          )}
        </p>
      </div>

      {/* fixes40 §1: tab bar — identical pattern to dashboard/picklists. */}
      <div className="flex flex-wrap gap-2 border-b border-border">
        {TABS.map((tb) => (
          <button
            key={tb.key}
            type="button"
            onClick={() => setTab(tb.key)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === tb.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <span aria-hidden>{tb.icon}</span>
            {t(tb.labelKey, tb.fallback)}
          </button>
        ))}
      </div>

      {tab === "contacts" && (
        <section className="space-y-6 rounded-2xl border border-border bg-card p-5">
          {renderGroups(["contact_mekurav"])}
          <AddDef
            entityOptions={ENTITY_TYPES.filter((e) => e.value === "contact_mekurav")}
            onAdded={reload}
          />
        </section>
      )}

      {tab === "shliach" && (
        <section className="space-y-6 rounded-2xl border border-border bg-card p-5">
          {renderGroups(["contact_shliach"])}
          <AddDef
            entityOptions={ENTITY_TYPES.filter((e) => e.value === "contact_shliach")}
            onAdded={reload}
          />
        </section>
      )}

      {tab === "visit" && (
        <section className="space-y-6 rounded-2xl border border-border bg-card p-5">
          {renderGroups(["visit"])}
          <AddDef
            entityOptions={ENTITY_TYPES.filter((e) => e.value === "visit")}
            onAdded={reload}
          />
        </section>
      )}

      {tab === "apartment" && (
        <section className="space-y-6 rounded-2xl border-2 border-primary/30 bg-primary/5 p-5">
          {renderGroups(["apartment"])}
          <AddDef
            entityOptions={ENTITY_TYPES.filter((e) => e.value === "apartment")}
            onAdded={reload}
          />
        </section>
      )}

      {tab === "tasks" && (
        <section className="space-y-6 rounded-2xl border border-border bg-card p-5">
          {renderGroups(["task"])}
          <AddDef
            entityOptions={ENTITY_TYPES.filter((e) => e.value === "task")}
            onAdded={reload}
          />
        </section>
      )}

      {/* fixes35 §2: visibility toggling lives entirely on Manage Fields now
          (every custom field auto-appears there) — no need to duplicate the
          toggle UI on this page too. */}
      <Link
        href="/dashboard/fields"
        className="inline-block text-sm text-primary hover:underline"
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
    const ok = await confirmHardDelete(
      confirmDialog,
      `/api/custom-fields/${def.id}/usage`,
      def.field_key,
      {
        withData: t(
          "cf.dependent_data_confirm",
          "יש נתונים הקשורים לשדה זה האם למחוק בכל זאת?",
        ),
        plain: t("cf.hard_delete_confirm", "למחוק לצמיתות את כל הערכים?"),
      },
    );
    if (!ok) return;
    try {
      await apiFetch(`/api/custom-fields/${def.id}?hard=true`, { method: "DELETE" });
      await onChanged();
      success(t("msg.deleted", "נמחק"));
    } catch (err) {
      error(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    }
  }

  const input = "rounded-md border border-input px-2 py-1 text-sm";
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
      <code className="text-xs text-muted-foreground w-32 shrink-0" dir="ltr">
        {def.field_key}
      </code>
      <Badge variant="secondary" className="shrink-0">{fieldTypeLabel}</Badge>
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
      {!def.is_active && <Badge variant="secondary">{t("cf.disabled", "מושבת")}</Badge>}
      <div className="flex items-center gap-1 ms-auto">
        <button
          onClick={save}
          className="rounded-md bg-foreground text-background px-3 py-1 text-xs hover:opacity-90"
        >
          {t("action.save", "שמור")}
        </button>
        {def.is_active ? (
          <button
            onClick={deactivate}
            className="rounded-md border border-destructive/40 text-destructive px-2 py-1 text-xs hover:bg-destructive/10"
          >
            {t("action.delete", "מחק")}
          </button>
        ) : (
          <>
            <button
              onClick={reactivate}
              className="rounded-md border border-status-green/40 text-status-green px-2 py-1 text-xs hover:bg-status-green/10"
            >
              {t("cf.activate", "הפעל")}
            </button>
            <button
              onClick={hardDelete}
              className="text-xs font-medium text-destructive underline underline-offset-2 hover:opacity-80"
            >
              {t("cf.hard_delete", "מחק לצמיתות")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function AddDef({
  entityOptions,
  onAdded,
}: {
  /** fixes40 §1: the entity choices offered within the current tab — a
   *  single-entity tab (visit/apartment) renders a fixed, non-editable
   *  value instead of a dropdown, matching picklists' AddPicklist. */
  entityOptions: { value: CustomFieldEntityType; labelKey: string; fallback: string }[];
  onAdded: () => Promise<void>;
}) {
  const { t } = useLocalization();
  const { success } = useToast();
  const [entityType, setEntityType] = useState<CustomFieldEntityType>(entityOptions[0].value);
  const [fieldType, setFieldType] = useState<CustomFieldType>("text");
  const [fieldKey, setFieldKey] = useState("");
  const [label, setLabel] = useState("");
  const [englishLabel, setEnglishLabel] = useState("");
  const [options, setOptions] = useState<string[]>([""]);
  const [error, setError] = useState("");

  // Re-anchor to this tab's own entity set when switching tabs.
  useEffect(() => {
    setEntityType(entityOptions[0].value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityOptions.map((e) => e.value).join(",")]);

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

  const input = "rounded-md border border-input px-2 py-1 text-sm";

  return (
    <form onSubmit={add} className="bg-card rounded-xl shadow-sm p-4 space-y-2">
      <h3 className="font-medium text-sm">{t("cf.add_field", "הוספת שדה")}</h3>
      <div className="flex flex-wrap gap-2">
        {entityOptions.length > 1 ? (
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("cf.entity_type", "שייך ל")}
            <select
              className={input}
              value={entityType}
              onChange={(e) => setEntityType(e.target.value as CustomFieldEntityType)}
            >
              {entityOptions.map(({ value, labelKey, fallback }) => (
                <option key={value} value={value}>
                  {t(labelKey, fallback)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <Badge variant="secondary" className="self-end py-1.5">
            {t(entityOptions[0].labelKey, entityOptions[0].fallback)}
          </Badge>
        )}
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
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
          className="self-end rounded-md bg-primary text-white px-4 py-1.5 text-sm font-medium hover:opacity-90"
        >
          {t("action.add", "הוסף")}
        </button>
      </div>

      {fieldType === "select" && (
        <div className="space-y-1 pt-1">
          <p className="text-xs text-muted-foreground">{t("cf.options", "אפשרויות (רשימת בחירה)")}</p>
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
                  className="text-xs font-medium text-destructive underline underline-offset-2 hover:opacity-80"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setOptions((prev) => [...prev, ""])}
            className="text-xs text-primary hover:underline"
          >
            {t("cf.add_option", "+ אפשרות")}
          </button>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}

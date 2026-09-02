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
import type { CustomFieldDefinition, PicklistField, PicklistValue } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

// fixes33 §4 / fixes37: which admin tab a picklist is managed from. Driven
// by the real entity_type column now, not a prefix guess.
// "contact_mekurav"/"significant_date" group under "contacts" — same
// grouping fixes33 chose deliberately for significant_date.*. fixes51 §3:
// "contact_shliach" got pulled out into its own tab (was lumped into
// "contacts" too) so an admin-only shliach field (manager_jewish_status)
// gets a dedicated home, per spec.
type PicklistTab = "contacts" | "visit" | "apartment" | "shliach";
function tabFor(entityType: string): PicklistTab {
  if (entityType === "apartment") return "apartment";
  if (entityType === "visit") return "visit";
  if (entityType === "contact_shliach") return "shliach";
  return "contacts";
}

export default function PicklistsPage() {
  const { isAdmin, loading } = useAuth();
  const { t, lang } = useLocalization();
  const [fields, setFields] = useState<PicklistField[]>([]);
  const [optionsByKey, setOptionsByKey] = useState<Record<string, PicklistValue[]>>({});
  // fixes44 §4: non-select CustomFieldDefinition rows (e.g. the Mivtzoim
  // booleans + "קשר לרבי") — a data model the picklist tables never touch.
  // Surfaced here (read+write against /api/custom-fields) so this page is
  // the one central place admins land in for every dynamic value, instead
  // of the two admin pages silently covering different data.
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDefinition[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = usePersistentState<PicklistTab>("crm.picklists.tab", "contacts");

  // Load every list + all its options, so the page shows all picklists at once.
  async function loadAll() {
    const [list, cfDefs] = await Promise.all([
      apiFetch<PicklistField[]>("/api/picklists"),
      apiFetch<CustomFieldDefinition[]>("/api/custom-fields?include_inactive=true"),
    ]);
    const entries = await Promise.all(
      list.map(
        async (f) =>
          [
            f.field_key,
            await apiFetch<PicklistValue[]>(
              `/api/picklists/${f.field_key}?include_inactive=true`,
            ),
          ] as const,
      ),
    );
    setFields(list);
    setOptionsByKey(Object.fromEntries(entries));
    setCustomFieldDefs(cfDefs);
  }

  useEffect(() => {
    loadAll()
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  // A definition's display name in the current language. fixes25 §5: system
  // lists carry Hebrew-only registry labels (e.g. "סוג איש קשר"), so English
  // mode consults the seeded picklist_def.* translations before falling back.
  const defLabel = (f: PicklistField) =>
    (lang === "en"
      ? f.english_label || t(`picklist_def.${f.field_key}`, "") || f.label
      : f.label || t(`picklist_def.${f.field_key}`, "")) || f.field_key;

  if (loading || !loaded) return <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>;
  if (!isAdmin) {
    return (
      <p className="text-status-darkred">
        {t("page.admins_only", "אין לך הרשאה לעמוד זה (מנהלים בלבד).")}
      </p>
    );
  }

  async function reorder(fieldKey: string, index: number, dir: -1 | 1) {
    const ids = (optionsByKey[fieldKey] ?? []).map((o) => o.id);
    const target = index + dir;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await apiFetch(`/api/picklists/${fieldKey}/reorder`, {
      method: "PUT",
      body: JSON.stringify({ ordered_ids: ids }),
    });
    await loadAll();
  }

  // fixes32 §7: one definition's editor + option list — shared by both
  // sections below.
  function renderDefinition(f: PicklistField) {
    const options = optionsByKey[f.field_key] ?? [];
    return (
      <section key={f.field_key} className="space-y-2">
        <h3 className="text-lg font-semibold">{defLabel(f)}</h3>
        <DefinitionEditor def={f} onChanged={loadAll} onDeleted={loadAll} />
        <div className="bg-card rounded-xl shadow-sm divide-y divide-border">
          {options.map((opt, i) => (
            <OptionRow
              key={opt.id}
              option={opt}
              onSaved={loadAll}
              onMoveUp={() => reorder(f.field_key, i, -1)}
              onMoveDown={() => reorder(f.field_key, i, 1)}
              isFirst={i === 0}
              isLast={i === options.length - 1}
            />
          ))}
          {options.length === 0 && (
            <p className="px-4 py-6 text-center text-muted-foreground">{t("pl.no_values", "אין ערכים.")}</p>
          )}
        </div>
        <AddOption fieldKey={f.field_key} onAdded={loadAll} />
      </section>
    );
  }

  // fixes33 §4: three domain tabs replace the previous two stacked sections —
  // apartment.* (unchanged rule), visit.*/checklist.*/interaction.*, and
  // everything else (contact.*, significant_date.*, bare Jewish_status/
  // affiliation/language, and any custom addition with no recognized prefix).
  const contactDefs = fields.filter((f) => tabFor(f.entity_type) === "contacts");
  const visitDefs = fields.filter((f) => tabFor(f.entity_type) === "visit");
  const apartmentDefs = fields.filter((f) => tabFor(f.entity_type) === "apartment");
  const shliachDefs = fields.filter((f) => tabFor(f.entity_type) === "shliach");

  // fixes44 §4: a select-type custom field already has a matching row in
  // `fields` above (routers/custom_fields.py auto-provisions a
  // PicklistDefinition for it) — only non-select ones (checkbox/text/number/
  // date) have no picklist counterpart and need their own section here.
  const nonSelectCustomFieldDefs = customFieldDefs.filter((d) => d.field_type !== "select");

  // fixes44 §4: one subsection per tab listing that tab's non-select custom
  // fields (e.g. the 5 Mivtzoim checkboxes + "קשר לרבי" under "visit") —
  // read+write straight against /api/custom-fields, same data the Custom
  // Fields admin page manages, so nothing that drives a dynamic value on a
  // form is invisible from this page.
  function renderCustomFieldsSection(t2: PicklistTab) {
    const defs = nonSelectCustomFieldDefs.filter((d) => tabFor(d.entity_type) === t2);
    return (
      <section className="space-y-2 border-t border-border pt-5">
        <h3 className="text-lg font-semibold">
          {t("pl.custom_fields_section", "שדות (לא רשימת בחירה)")}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t(
            "pl.custom_fields_hint",
            "שדות אלו (תיבת סימון, טקסט, מספר או תאריך — למשל \"קשר לרבי\") אינם רשימת ערכים אלא שדה בודד; מוצגים כאן לניהול מרוכז. הוספת שדה חדש מתבצעת בדף שדות מותאמים אישית.",
          )}
        </p>
        {defs.length > 0 && (
          <div className="bg-card rounded-xl shadow-sm divide-y divide-border">
            {defs.map((d) => (
              <CustomFieldRow key={d.id} def={d} onSaved={loadAll} />
            ))}
          </div>
        )}
        <Link
          href="/dashboard/custom-fields"
          className="inline-block text-sm text-primary hover:underline"
        >
          {t("pl.go_to_custom_fields", "מעבר לדף שדות מותאמים אישית ←")}
        </Link>
      </section>
    );
  }

  const TABS: { key: PicklistTab; icon: string; labelKey: string; fallback: string }[] = [
    { key: "contacts", icon: "👤", labelKey: "pl.tab_contacts", fallback: "אנשי קשר" },
    { key: "visit", icon: "📋", labelKey: "pl.tab_visit", fallback: "ביקורים" },
    { key: "apartment", icon: "🏠", labelKey: "pl.tab_apartment", fallback: "דירה" },
    { key: "shliach", icon: "🧑‍🏫", labelKey: "pl.tab_shliach", fallback: "פעילים" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("pl.editor_title", "עריכת תיבת בחירה")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("pl.editor_intro", "ערוך תוויות בעברית ובאנגלית, סדר, צבע, והוסף רשימות חדשות.")}
        </p>
      </div>

      {/* fixes33 §4: tab bar — replaces the previous always-stacked sections. */}
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
          {contactDefs.map(renderDefinition)}
          <AddPicklist
            heading={t("pl.add_list_contact", "הוספת רשימת בחירה לאיש קשר")}
            prefix=""
            entityType="contact_mekurav"
            onAdded={loadAll}
          />
          {renderCustomFieldsSection("contacts")}
        </section>
      )}

      {tab === "visit" && (
        <section className="space-y-6 rounded-2xl border border-border bg-card p-5">
          {visitDefs.map(renderDefinition)}
          <AddPicklist
            heading={t("pl.add_list_visit", "הוספת רשימת בחירה לביקור")}
            prefix="visit."
            entityType="visit"
            onAdded={loadAll}
          />
          {renderCustomFieldsSection("visit")}
        </section>
      )}

      {tab === "apartment" && (
        <section className="space-y-6 rounded-2xl border-2 border-primary/30 bg-primary/5 p-5">
          {apartmentDefs.map(renderDefinition)}
          <AddPicklist
            heading={t("pl.add_list_apartment", "הוספת רשימת בחירה לדירה")}
            prefix="apartment."
            entityType="apartment"
            onAdded={loadAll}
          />
          {renderCustomFieldsSection("apartment")}
        </section>
      )}

      {tab === "shliach" && (
        <section className="space-y-6 rounded-2xl border border-border bg-card p-5">
          {shliachDefs.map(renderDefinition)}
          <AddPicklist
            heading={t("pl.add_list_shliach", "הוספת רשימת בחירה לפעיל")}
            prefix=""
            entityType="contact_shliach"
            onAdded={loadAll}
          />
          {renderCustomFieldsSection("shliach")}
        </section>
      )}
    </div>
  );
}

/** Edit a definition's bilingual display names; delete custom (non-system) lists. */
function DefinitionEditor({
  def,
  onChanged,
  onDeleted,
}: {
  def: PicklistField;
  onChanged: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const { t } = useLocalization();
  const confirmDialog = useConfirm();
  const [he, setHe] = useState(def.label);
  const [en, setEn] = useState(def.english_label ?? "");

  // Re-sync when switching lists.
  useEffect(() => {
    setHe(def.label);
    setEn(def.english_label ?? "");
  }, [def.id, def.label, def.english_label]);

  async function save() {
    await apiFetch(`/api/picklists/definition/${def.id}`, {
      method: "PUT",
      body: JSON.stringify({ hebrew_display_name: he, english_display_name: en || null }),
    });
    await onChanged();
  }

  async function remove() {
    const ok = await confirmHardDelete(
      confirmDialog,
      `/api/picklists/definition/${def.id}/usage`,
      def.field_key,
      {
        withData: t(
          "cf.dependent_data_confirm",
          "יש נתונים הקשורים לשדה זה האם למחוק בכל זאת?",
        ),
        plain: t("pl.delete_list_confirm", "למחוק רשימה זו וכל הערכים שלה?"),
      },
    );
    if (!ok) return;
    await apiFetch(`/api/picklists/definition/${def.id}`, { method: "DELETE" });
    await onDeleted();
  }

  const input = "rounded-md border border-input px-2 py-1 text-sm";

  return (
    <div className="bg-card rounded-xl shadow-sm p-4 flex flex-wrap items-end gap-3">
      <code className="text-xs text-muted-foreground" dir="ltr">
        {def.field_key}
      </code>
      <label className="space-y-1">
        <span className="block text-xs text-muted-foreground">
          {t("common.hebrew_label", "עברית")}
        </span>
        <input dir="rtl" className={input} value={he} onChange={(e) => setHe(e.target.value)} />
      </label>
      <label className="space-y-1">
        <span className="block text-xs text-muted-foreground">
          {t("common.english_label", "English")}
        </span>
        <input dir="ltr" className={input} value={en} onChange={(e) => setEn(e.target.value)} />
      </label>
      <button
        onClick={save}
        className="rounded-md bg-foreground text-white px-3 py-1.5 text-xs hover:opacity-90"
      >
        {t("action.save", "שמור")}
      </button>
      {def.is_system ? (
        <Badge variant="secondary">{t("pl.system_list", "רשימת מערכת")}</Badge>
      ) : (
        <button
          onClick={remove}
          className="text-xs text-status-darkred hover:underline ms-auto"
        >
          {t("pl.delete_list", "מחק רשימה")}
        </button>
      )}
    </div>
  );
}

/** Create a brand-new (custom) picklist definition (fixes32 §7: one variant
 *  per section — `prefix` is silently prepended to whatever the admin types,
 *  so an apartment-section addition always lands in the apartment group and
 *  is immediately picked up by the apartments page's dynamic filter/column;
 *  fixes37: `entityType` is sent to the API as real data alongside it — the
 *  backend still auto-splits "contact" into "contact_shliach" for a typed
 *  "shliach.*" name, so the contacts tab keeps working exactly as before). */
function AddPicklist({
  heading,
  prefix,
  entityType,
  onAdded,
}: {
  heading: string;
  prefix: string;
  entityType: string;
  onAdded: (systemName: string) => Promise<void>;
}) {
  const { t } = useLocalization();
  const [systemName, setSystemName] = useState("");
  const [he, setHe] = useState("");
  const [en, setEn] = useState("");
  const [error, setError] = useState("");

  async function add(e: FormEvent) {
    e.preventDefault();
    setError("");
    const fullSystemName = `${prefix}${systemName}`;
    try {
      await apiFetch("/api/picklists/definition", {
        method: "POST",
        body: JSON.stringify({
          system_name: fullSystemName,
          hebrew_display_name: he,
          english_display_name: en || null,
          entity_type: entityType,
        }),
      });
      setSystemName("");
      setHe("");
      setEn("");
      await onAdded(fullSystemName);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("cf.add_failed", "הוספה נכשלה"));
    }
  }

  const input = "rounded-md border border-input px-2 py-1 text-sm";

  return (
    <form onSubmit={add} className="bg-card rounded-xl shadow-sm p-4 space-y-2">
      <h3 className="font-medium text-sm">{heading}</h3>
      <div className="flex flex-wrap items-center gap-2">
        {prefix && (
          <code className="text-xs text-muted-foreground" dir="ltr">
            {prefix}
          </code>
        )}
        <input
          className={`${input} w-44`}
          placeholder={t("pl.system_name_placeholder", "מזהה (אנגלית) — diet")}
          value={systemName}
          onChange={(e) => setSystemName(e.target.value)}
          dir="ltr"
          required
        />
        <input
          className={`${input} w-40`}
          placeholder={t("common.hebrew_label", "עברית")}
          value={he}
          onChange={(e) => setHe(e.target.value)}
          dir="rtl"
          required
        />
        <input
          className={`${input} w-40`}
          placeholder="English"
          value={en}
          onChange={(e) => setEn(e.target.value)}
          dir="ltr"
        />
        <button
          type="submit"
          className="rounded-md bg-primary text-white px-4 py-1.5 text-sm font-medium hover:opacity-90"
        >
          {t("action.add", "הוסף")}
        </button>
      </div>
      {error && <p className="text-sm text-status-darkred">{error}</p>}
    </form>
  );
}

function OptionRow({
  option,
  onSaved,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: {
  option: PicklistValue;
  onSaved: () => Promise<void>;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const { t } = useLocalization();
  const confirmDialog = useConfirm();
  const { error: toastError } = useToast();
  const [label, setLabel] = useState(option.hebrew_label);
  const [english, setEnglish] = useState(option.english_value ?? "");
  const [color, setColor] = useState(option.color_hint ?? "");

  async function save() {
    await apiFetch(`/api/picklists/${option.id}`, {
      method: "PUT",
      body: JSON.stringify({
        hebrew_label: label,
        english_value: english || null,
        color_hint: color || null,
      }),
    });
    await onSaved();
  }

  // Soft delete: removes the option from dropdowns; always works (keeps history).
  async function deactivate() {
    await apiFetch(`/api/picklists/${option.id}`, { method: "DELETE" });
    await onSaved();
  }

  async function reactivate() {
    await apiFetch(`/api/picklists/${option.id}`, {
      method: "PUT",
      body: JSON.stringify({ is_active: true }),
    });
    await onSaved();
  }

  // fixes48 §1: a hard delete used to 409 when the value was in use, and
  // silently fall back to soft-delete instead. It now purges every record
  // pointing at this value along with it — gated by the usage-based confirm.
  async function hardDelete() {
    const ok = await confirmHardDelete(
      confirmDialog,
      `/api/picklists/${option.id}/usage`,
      option.value,
      {
        withData: t(
          "cf.dependent_data_confirm",
          "יש נתונים הקשורים לשדה זה האם למחוק בכל זאת?",
        ),
        plain: t("pl.hard_delete_confirm", "למחוק לצמיתות?"),
      },
    );
    if (!ok) return;
    try {
      await apiFetch(`/api/picklists/${option.id}?hard=true`, { method: "DELETE" });
      await onSaved();
    } catch (err) {
      toastError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    }
  }

  const input = "rounded-md border border-input px-2 py-1 text-sm";

  return (
    <div
      className={`px-4 py-2 flex flex-wrap items-center gap-2 ${
        option.is_active ? "" : "opacity-60"
      }`}
    >
      <code className="text-xs text-muted-foreground w-28 shrink-0" dir="ltr">
        {option.value}
      </code>
      <input
        className={`${input} flex-1 min-w-[7rem]`}
        placeholder={t("common.hebrew_label", "עברית")}
        dir="rtl"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <input
        className={`${input} flex-1 min-w-[7rem]`}
        placeholder="English"
        dir="ltr"
        value={english}
        onChange={(e) => setEnglish(e.target.value)}
      />
      <input
        className={`${input} w-24`}
        placeholder="color"
        value={color}
        onChange={(e) => setColor(e.target.value)}
        dir="ltr"
      />
      {!option.is_active && <Badge variant="secondary">{t("cf.disabled", "מושבת")}</Badge>}
      <div className="flex items-center gap-1 ms-auto">
        <button
          onClick={onMoveUp}
          disabled={isFirst}
          className="px-2 text-muted-foreground disabled:opacity-30"
          title={t("pl.move_up", "הזז למעלה")}
        >
          ↑
        </button>
        <button
          onClick={onMoveDown}
          disabled={isLast}
          className="px-2 text-muted-foreground disabled:opacity-30"
          title={t("pl.move_down", "הזז למטה")}
        >
          ↓
        </button>
        <button
          onClick={save}
          className="rounded-md bg-foreground text-white px-3 py-1 text-xs hover:opacity-90"
        >
          {t("action.save", "שמור")}
        </button>
        {option.is_active ? (
          <button
            onClick={deactivate}
            className="rounded-md border border-status-darkred/40 text-status-darkred px-2 py-1 text-xs hover:bg-status-darkred/10"
            title={t("pl.deactivate_title", "הסר מהרשימה (השבתה)")}
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

function AddOption({
  fieldKey,
  onAdded,
}: {
  fieldKey: string;
  onAdded: () => Promise<void>;
}) {
  const { t } = useLocalization();
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [english, setEnglish] = useState("");
  const [color, setColor] = useState("");
  const [error, setError] = useState("");

  async function add(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await apiFetch(`/api/picklists/${fieldKey}`, {
        method: "POST",
        body: JSON.stringify({
          value,
          hebrew_label: label,
          english_value: english || null,
          color_hint: color || null,
        }),
      });
      setValue("");
      setLabel("");
      setEnglish("");
      setColor("");
      await onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("cf.add_failed", "הוספה נכשלה"));
    }
  }

  const input = "rounded-md border border-input px-2 py-1 text-sm";

  return (
    <form onSubmit={add} className="bg-card rounded-xl shadow-sm p-4 space-y-2">
      <h3 className="font-medium text-sm">{t("pl.add_value", "הוספת ערך")}</h3>
      <div className="flex flex-wrap gap-2">
        <input
          className={`${input} w-40`}
          placeholder={t("pl.value_placeholder", "value (אנגלית)")}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          dir="ltr"
          required
        />
        <input
          className={`${input} flex-1 min-w-[7rem]`}
          placeholder={t("common.hebrew_label", "עברית")}
          dir="rtl"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          required
        />
        <input
          className={`${input} flex-1 min-w-[7rem]`}
          placeholder="English"
          dir="ltr"
          value={english}
          onChange={(e) => setEnglish(e.target.value)}
        />
        <input
          className={`${input} w-24`}
          placeholder="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          dir="ltr"
        />
        <button
          type="submit"
          className="rounded-md bg-primary text-white px-4 py-1.5 text-sm font-medium hover:opacity-90"
        >
          {t("action.add", "הוסף")}
        </button>
      </div>
      {error && <p className="text-sm text-status-darkred">{error}</p>}
    </form>
  );
}

// fixes44 §4: field_type has no options to edit (unlike a picklist definition)
// — just a bilingual label + activate/deactivate/hard-delete, same actions
// the Custom Fields admin page's own DefRow offers, kept in sync with it.
const CF_TYPE_LABELS: Record<string, { labelKey: string; fallback: string }> = {
  text: { labelKey: "cf.type.text", fallback: "טקסט" },
  number: { labelKey: "cf.type.number", fallback: "מספר" },
  boolean: { labelKey: "cf.type.boolean", fallback: "תיבת סימון" },
  date: { labelKey: "cf.type.date", fallback: "תאריך" },
};

function CustomFieldRow({
  def,
  onSaved,
}: {
  def: CustomFieldDefinition;
  onSaved: () => Promise<void>;
}) {
  const { t } = useLocalization();
  const confirmDialog = useConfirm();
  const { error: toastError } = useToast();
  const [label, setLabel] = useState(def.hebrew_label);
  const [english, setEnglish] = useState(def.english_label ?? "");

  async function save() {
    await apiFetch(`/api/custom-fields/${def.id}`, {
      method: "PUT",
      body: JSON.stringify({ hebrew_label: label, english_label: english || null }),
    });
    await onSaved();
  }

  async function deactivate() {
    await apiFetch(`/api/custom-fields/${def.id}`, { method: "DELETE" });
    await onSaved();
  }

  async function reactivate() {
    await apiFetch(`/api/custom-fields/${def.id}`, {
      method: "PUT",
      body: JSON.stringify({ is_active: true }),
    });
    await onSaved();
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
      await onSaved();
    } catch (err) {
      toastError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    }
  }

  const input = "rounded-md border border-input px-2 py-1 text-sm";
  const typeMeta = CF_TYPE_LABELS[def.field_type];

  return (
    <div
      className={`px-4 py-2 flex flex-wrap items-center gap-2 ${
        def.is_active ? "" : "opacity-60"
      }`}
    >
      <code className="text-xs text-muted-foreground w-28 shrink-0" dir="ltr">
        {def.field_key}
      </code>
      {typeMeta && <Badge variant="secondary" className="shrink-0">{t(typeMeta.labelKey, typeMeta.fallback)}</Badge>}
      <input
        className={`${input} flex-1 min-w-[7rem]`}
        placeholder={t("cf.label_placeholder", "תווית בעברית")}
        dir="rtl"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <input
        className={`${input} flex-1 min-w-[7rem]`}
        placeholder="English"
        dir="ltr"
        value={english}
        onChange={(e) => setEnglish(e.target.value)}
      />
      {!def.is_active && <Badge variant="secondary">{t("cf.disabled", "מושבת")}</Badge>}
      <div className="flex items-center gap-1 ms-auto">
        <button
          onClick={save}
          className="rounded-md bg-foreground text-white px-3 py-1 text-xs hover:opacity-90"
        >
          {t("action.save", "שמור")}
        </button>
        {def.is_active ? (
          <button
            onClick={deactivate}
            className="rounded-md border border-status-darkred/40 text-status-darkred px-2 py-1 text-xs hover:bg-status-darkred/10"
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

"use client";

import { useEffect, useState, type FormEvent } from "react";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import type { PicklistField, PicklistValue } from "@/lib/types";

export default function PicklistsPage() {
  const { isAdmin, loading } = useAuth();
  const { t, lang } = useLocalization();
  const [fields, setFields] = useState<PicklistField[]>([]);
  const [optionsByKey, setOptionsByKey] = useState<Record<string, PicklistValue[]>>({});
  const [loaded, setLoaded] = useState(false);

  // Load every list + all its options, so the page shows all picklists at once.
  async function loadAll() {
    const list = await apiFetch<PicklistField[]>("/api/picklists");
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
  }

  useEffect(() => {
    loadAll()
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  // A definition's display name in the current language.
  const defLabel = (f: PicklistField) =>
    (lang === "en" ? f.english_label || f.label : f.label) || f.field_key;

  if (loading || !loaded) return <p className="text-gray-400">{t("action.loading", "טוען…")}</p>;
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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">{t("pl.editor_title", "עריכת תיבת בחירה")}</h1>
        <p className="mt-1 text-sm text-gray-500">
          {t("pl.editor_intro", "ערוך תוויות בעברית ובאנגלית, סדר, צבע, והוסף רשימות חדשות.")}
        </p>
      </div>

      {/* Apartment picklists live under their own "דירה" subsection (fixes7 §4). */}
      {[
        {
          heading: t("pl.group_general", "כללי"),
          defs: fields.filter((f) => !f.field_key.startsWith("apartment.")),
        },
        {
          heading: t("pl.group_apartment", "דירה"),
          defs: fields.filter((f) => f.field_key.startsWith("apartment.")),
        },
      ]
        .filter((group) => group.defs.length > 0)
        .map((group) => (
          <div key={group.heading} className="space-y-6">
            <h2 className="text-xl font-bold border-b border-gray-200 pb-1">{group.heading}</h2>
            {group.defs.map((f) => {
              const options = optionsByKey[f.field_key] ?? [];
              return (
                <section key={f.field_key} className="space-y-2">
                  <h3 className="text-lg font-semibold">{defLabel(f)}</h3>
                  <DefinitionEditor def={f} onChanged={loadAll} onDeleted={loadAll} />
                  <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
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
                      <p className="px-4 py-6 text-center text-gray-400">{t("pl.no_values", "אין ערכים.")}</p>
                    )}
                  </div>
                  <AddOption fieldKey={f.field_key} onAdded={loadAll} />
                </section>
              );
            })}
          </div>
        ))}

      <AddPicklist onAdded={loadAll} />
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
    if (!confirm(t("pl.delete_list_confirm", "למחוק רשימה זו וכל הערכים שלה?"))) return;
    await apiFetch(`/api/picklists/definition/${def.id}`, { method: "DELETE" });
    await onDeleted();
  }

  const input = "rounded-md border border-gray-300 px-2 py-1 text-sm";

  return (
    <div className="bg-white rounded-xl shadow-sm p-4 flex flex-wrap items-end gap-3">
      <code className="text-xs text-gray-400" dir="ltr">
        {def.field_key}
      </code>
      <label className="space-y-1">
        <span className="block text-xs text-gray-500">עברית</span>
        <input dir="rtl" className={input} value={he} onChange={(e) => setHe(e.target.value)} />
      </label>
      <label className="space-y-1">
        <span className="block text-xs text-gray-500">English</span>
        <input dir="ltr" className={input} value={en} onChange={(e) => setEn(e.target.value)} />
      </label>
      <button
        onClick={save}
        className="rounded-md bg-gray-800 text-white px-3 py-1.5 text-xs hover:opacity-90"
      >
        {t("action.save", "שמור")}
      </button>
      {def.is_system ? (
        <span className="rounded bg-gray-100 text-gray-500 text-xs px-2 py-0.5">
          {t("pl.system_list", "רשימת מערכת")}
        </span>
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

/** Create a brand-new (custom) picklist definition. */
function AddPicklist({ onAdded }: { onAdded: (systemName: string) => Promise<void> }) {
  const { t } = useLocalization();
  const [systemName, setSystemName] = useState("");
  const [he, setHe] = useState("");
  const [en, setEn] = useState("");
  const [error, setError] = useState("");

  async function add(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await apiFetch("/api/picklists/definition", {
        method: "POST",
        body: JSON.stringify({
          system_name: systemName,
          hebrew_display_name: he,
          english_display_name: en || null,
        }),
      });
      setSystemName("");
      setHe("");
      setEn("");
      await onAdded(systemName);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("cf.add_failed", "הוספה נכשלה"));
    }
  }

  const input = "rounded-md border border-gray-300 px-2 py-1 text-sm";

  return (
    <form onSubmit={add} className="bg-white rounded-xl shadow-sm p-4 space-y-2">
      <h3 className="font-medium text-sm">{t("pl.add_list", "הוספת רשימת בחירה")}</h3>
      <div className="flex flex-wrap gap-2">
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
          placeholder="עברית"
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
          className="rounded-md bg-status-magenta text-white px-4 py-1.5 text-sm font-medium hover:opacity-90"
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

  // Permanent delete: only allowed when the value is unused (backend returns 409 otherwise).
  async function hardDelete() {
    if (!confirm(`${t("pl.hard_delete_confirm", "למחוק לצמיתות?")} '${option.value}'`)) return;
    try {
      await apiFetch(`/api/picklists/${option.id}?hard=true`, { method: "DELETE" });
      await onSaved();
    } catch {
      alert(
        t(
          "pl.hard_delete_in_use",
          "לא ניתן למחוק לצמיתות — הערך בשימוש על ידי רשומות קיימות. הוא הושבת במקום.",
        ),
      );
      await deactivate();
    }
  }

  const input = "rounded-md border border-gray-300 px-2 py-1 text-sm";

  return (
    <div
      className={`px-4 py-2 flex flex-wrap items-center gap-2 ${
        option.is_active ? "" : "opacity-60"
      }`}
    >
      <code className="text-xs text-gray-400 w-28 shrink-0" dir="ltr">
        {option.value}
      </code>
      <input
        className={`${input} flex-1 min-w-[7rem]`}
        placeholder="עברית"
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
      {!option.is_active && (
        <span className="rounded bg-gray-200 text-gray-600 text-xs px-2 py-0.5">
          {t("cf.disabled", "מושבת")}
        </span>
      )}
      <div className="flex items-center gap-1 ms-auto">
        <button
          onClick={onMoveUp}
          disabled={isFirst}
          className="px-2 text-gray-500 disabled:opacity-30"
          title={t("pl.move_up", "הזז למעלה")}
        >
          ↑
        </button>
        <button
          onClick={onMoveDown}
          disabled={isLast}
          className="px-2 text-gray-500 disabled:opacity-30"
          title={t("pl.move_down", "הזז למטה")}
        >
          ↓
        </button>
        <button
          onClick={save}
          className="rounded-md bg-gray-800 text-white px-3 py-1 text-xs hover:opacity-90"
        >
          {t("action.save", "שמור")}
        </button>
        {option.is_active ? (
          <button
            onClick={deactivate}
            className="rounded-md border border-status-darkred/40 text-status-darkred px-2 py-1 text-xs hover:bg-red-50"
            title={t("pl.deactivate_title", "הסר מהרשימה (השבתה)")}
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

  const input = "rounded-md border border-gray-300 px-2 py-1 text-sm";

  return (
    <form onSubmit={add} className="bg-white rounded-xl shadow-sm p-4 space-y-2">
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
          placeholder="עברית"
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
          className="rounded-md bg-status-magenta text-white px-4 py-1.5 text-sm font-medium hover:opacity-90"
        >
          {t("action.add", "הוסף")}
        </button>
      </div>
      {error && <p className="text-sm text-status-darkred">{error}</p>}
    </form>
  );
}

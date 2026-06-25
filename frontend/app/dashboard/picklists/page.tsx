"use client";

import { useEffect, useState, type FormEvent } from "react";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { PicklistField, PicklistValue } from "@/lib/types";

export default function PicklistsPage() {
  const { isAdmin, loading } = useAuth();
  const [fields, setFields] = useState<PicklistField[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [options, setOptions] = useState<PicklistValue[]>([]);

  useEffect(() => {
    apiFetch<PicklistField[]>("/api/picklists")
      .then((list) => {
        setFields(list);
        if (list.length) setSelected((s) => s || list[0].field_key);
      })
      .catch(() => {});
  }, []);

  async function loadOptions(key: string) {
    if (!key) return;
    setOptions(
      await apiFetch<PicklistValue[]>(`/api/picklists/${key}?include_inactive=true`),
    );
  }

  useEffect(() => {
    loadOptions(selected).catch(() => {});
  }, [selected]);

  if (loading) return <p className="text-gray-400">טוען…</p>;
  if (!isAdmin) {
    return <p className="text-status-darkred">אין לך הרשאה לעמוד זה (מנהלים בלבד).</p>;
  }

  const reload = () => loadOptions(selected);

  async function reorder(index: number, dir: -1 | 1) {
    const ids = options.map((o) => o.id);
    const target = index + dir;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await apiFetch(`/api/picklists/${selected}/reorder`, {
      method: "PUT",
      body: JSON.stringify({ ordered_ids: ids }),
    });
    await reload();
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">רשימות בחירה</h1>

      <div className="flex flex-wrap gap-2">
        {fields.map((f) => (
          <button
            key={f.field_key}
            onClick={() => setSelected(f.field_key)}
            className={`rounded-md px-3 py-1.5 text-sm border ${
              selected === f.field_key
                ? "border-status-magenta bg-status-magenta/10 text-status-magenta"
                : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
        {options.map((opt, i) => (
          <OptionRow
            key={opt.id}
            option={opt}
            onSaved={reload}
            onMoveUp={() => reorder(i, -1)}
            onMoveDown={() => reorder(i, 1)}
            isFirst={i === 0}
            isLast={i === options.length - 1}
          />
        ))}
        {options.length === 0 && (
          <p className="px-4 py-6 text-center text-gray-400">אין ערכים.</p>
        )}
      </div>

      {selected && <AddOption fieldKey={selected} onAdded={reload} />}
    </div>
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
  const [label, setLabel] = useState(option.hebrew_label);
  const [color, setColor] = useState(option.color_hint ?? "");

  async function save() {
    await apiFetch(`/api/picklists/${option.id}`, {
      method: "PUT",
      body: JSON.stringify({ hebrew_label: label, color_hint: color || null }),
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
    if (!confirm(`למחוק לצמיתות את '${option.value}'?`)) return;
    try {
      await apiFetch(`/api/picklists/${option.id}?hard=true`, { method: "DELETE" });
      await onSaved();
    } catch {
      alert(
        "לא ניתן למחוק לצמיתות — הערך בשימוש על ידי רשומות קיימות. הוא הושבת במקום.",
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
        className={`${input} flex-1 min-w-[8rem]`}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
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
          מושבת
        </span>
      )}
      <div className="flex items-center gap-1 ms-auto">
        <button
          onClick={onMoveUp}
          disabled={isFirst}
          className="px-2 text-gray-500 disabled:opacity-30"
          title="הזז למעלה"
        >
          ↑
        </button>
        <button
          onClick={onMoveDown}
          disabled={isLast}
          className="px-2 text-gray-500 disabled:opacity-30"
          title="הזז למטה"
        >
          ↓
        </button>
        <button
          onClick={save}
          className="rounded-md bg-gray-800 text-white px-3 py-1 text-xs hover:opacity-90"
        >
          שמור
        </button>
        {option.is_active ? (
          <button
            onClick={deactivate}
            className="rounded-md border border-status-darkred/40 text-status-darkred px-2 py-1 text-xs hover:bg-red-50"
            title="הסר מהרשימה (השבתה)"
          >
            מחק
          </button>
        ) : (
          <>
            <button
              onClick={reactivate}
              className="rounded-md border border-status-green/40 text-status-green px-2 py-1 text-xs hover:bg-green-50"
            >
              הפעל
            </button>
            <button
              onClick={hardDelete}
              className="text-xs text-status-darkred hover:underline"
            >
              מחק לצמיתות
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
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
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
          color_hint: color || null,
        }),
      });
      setValue("");
      setLabel("");
      setColor("");
      await onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "הוספה נכשלה");
    }
  }

  const input = "rounded-md border border-gray-300 px-2 py-1 text-sm";

  return (
    <form onSubmit={add} className="bg-white rounded-xl shadow-sm p-4 space-y-2">
      <h3 className="font-medium text-sm">הוספת ערך</h3>
      <div className="flex flex-wrap gap-2">
        <input
          className={`${input} w-40`}
          placeholder="value (אנגלית)"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          dir="ltr"
          required
        />
        <input
          className={`${input} flex-1 min-w-[8rem]`}
          placeholder="תווית בעברית"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          required
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
          הוסף
        </button>
      </div>
      {error && <p className="text-sm text-status-darkred">{error}</p>}
    </form>
  );
}

"use client";

import { useEffect, useState, type FormEvent } from "react";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { CustomFieldDefinition } from "@/lib/types";

export default function CustomFieldsPage() {
  const { isAdmin, loading } = useAuth();
  const [defs, setDefs] = useState<CustomFieldDefinition[]>([]);

  async function reload() {
    setDefs(
      await apiFetch<CustomFieldDefinition[]>("/api/custom-fields?include_inactive=true"),
    );
  }

  useEffect(() => {
    reload().catch(() => {});
  }, []);

  if (loading) return <p className="text-gray-400">טוען…</p>;
  if (!isAdmin) {
    return <p className="text-status-darkred">אין לך הרשאה לעמוד זה (מנהלים בלבד).</p>;
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <h1 className="text-2xl font-bold">שדות מותאמים אישית</h1>
      <p className="text-sm text-gray-500">
        כל שדה הוא תיבת סימון + הערה, ויופיע בכרטיס איש הקשר. לדוגמה: מסיבת חנוכה.
      </p>

      <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
        {defs.map((d) => (
          <DefRow key={d.id} def={d} onChanged={reload} />
        ))}
        {defs.length === 0 && (
          <p className="px-4 py-6 text-center text-gray-400">אין שדות מותאמים עדיין.</p>
        )}
      </div>

      <AddDef onAdded={reload} />
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
  const [label, setLabel] = useState(def.hebrew_label);

  async function save() {
    await apiFetch(`/api/custom-fields/${def.id}`, {
      method: "PUT",
      body: JSON.stringify({ hebrew_label: label }),
    });
    await onChanged();
  }

  async function deactivate() {
    await apiFetch(`/api/custom-fields/${def.id}`, { method: "DELETE" });
    await onChanged();
  }

  async function reactivate() {
    await apiFetch(`/api/custom-fields/${def.id}`, {
      method: "PUT",
      body: JSON.stringify({ is_active: true }),
    });
    await onChanged();
  }

  async function hardDelete() {
    if (!confirm(`למחוק לצמיתות את '${def.field_key}' וכל הערכים שלו?`)) return;
    await apiFetch(`/api/custom-fields/${def.id}?hard=true`, { method: "DELETE" });
    await onChanged();
  }

  const input = "rounded-md border border-gray-300 px-2 py-1 text-sm";

  return (
    <div
      className={`px-4 py-2 flex flex-wrap items-center gap-2 ${
        def.is_active ? "" : "opacity-60"
      }`}
    >
      <code className="text-xs text-gray-400 w-36 shrink-0" dir="ltr">
        {def.field_key}
      </code>
      <input
        className={`${input} flex-1 min-w-[8rem]`}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      {!def.is_active && (
        <span className="rounded bg-gray-200 text-gray-600 text-xs px-2 py-0.5">מושבת</span>
      )}
      <div className="flex items-center gap-1 ms-auto">
        <button
          onClick={save}
          className="rounded-md bg-gray-800 text-white px-3 py-1 text-xs hover:opacity-90"
        >
          שמור
        </button>
        {def.is_active ? (
          <button
            onClick={deactivate}
            className="rounded-md border border-status-darkred/40 text-status-darkred px-2 py-1 text-xs hover:bg-red-50"
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

function AddDef({ onAdded }: { onAdded: () => Promise<void> }) {
  const [fieldKey, setFieldKey] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");

  async function add(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await apiFetch("/api/custom-fields", {
        method: "POST",
        body: JSON.stringify({ field_key: fieldKey, hebrew_label: label }),
      });
      setFieldKey("");
      setLabel("");
      await onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "הוספה נכשלה");
    }
  }

  const input = "rounded-md border border-gray-300 px-2 py-1 text-sm";

  return (
    <form onSubmit={add} className="bg-white rounded-xl shadow-sm p-4 space-y-2">
      <h3 className="font-medium text-sm">הוספת שדה</h3>
      <div className="flex flex-wrap gap-2">
        <input
          className={`${input} w-44`}
          placeholder="מפתח (אנגלית) — hanuka_party"
          value={fieldKey}
          onChange={(e) => setFieldKey(e.target.value)}
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

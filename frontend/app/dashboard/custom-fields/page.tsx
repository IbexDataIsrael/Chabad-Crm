"use client";

import { useEffect, useState, type FormEvent } from "react";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";
import type { CustomFieldDefinition } from "@/lib/types";
import { useConfirm } from "@/lib/confirm";

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
    <div className="space-y-5 max-w-2xl">
      <h1 className="text-2xl font-bold">{t("cf.title", "שדות מותאמים אישית")}</h1>
      <p className="text-sm text-gray-500">
        {t("cf.intro", "כל שדה הוא תיבת סימון + הערה, ויופיע בכרטיס איש הקשר. לדוגמה: מסיבת חנוכה.")}
      </p>

      <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
        {defs.map((d) => (
          <DefRow key={d.id} def={d} onChanged={reload} />
        ))}
        {defs.length === 0 && (
          <p className="px-4 py-6 text-center text-gray-400">{t("cf.none", "אין שדות מותאמים עדיין.")}</p>
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
  const { t } = useLocalization();
  const confirmDialog = useConfirm();
  const { success, error } = useToast();
  const [label, setLabel] = useState(def.hebrew_label);

  async function save() {
    try {
      await apiFetch(`/api/custom-fields/${def.id}`, {
        method: "PUT",
        body: JSON.stringify({ hebrew_label: label }),
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
        <input
          className={`${input} w-44`}
          placeholder={t("cf.key_placeholder", "מפתח (אנגלית) — hanuka_party")}
          value={fieldKey}
          onChange={(e) => setFieldKey(e.target.value)}
          dir="ltr"
          required
        />
        <input
          className={`${input} flex-1 min-w-[8rem]`}
          placeholder={t("cf.label_placeholder", "תווית בעברית")}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          required
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

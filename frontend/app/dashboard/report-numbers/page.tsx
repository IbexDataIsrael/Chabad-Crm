"use client";

import { useEffect, useState, type FormEvent } from "react";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useConfirm } from "@/lib/confirm";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";
import { type ReportNumber } from "@/lib/types";

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";

/** Report-number (מספר דוח, fixes19) CRUD: list + add + inline edit + delete.
 *  Admin-only — the whole management page is gated on the admin role. */
export default function ReportNumbersPage() {
  const { isAdmin, loading } = useAuth();
  const { t } = useLocalization();
  const confirmDialog = useConfirm();
  const { success } = useToast();
  const [items, setItems] = useState<ReportNumber[]>([]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ReportNumber | null>(null);
  const [busy, setBusy] = useState(true);
  const [query, setQuery] = useState("");

  async function reload() {
    setItems(await apiFetch<ReportNumber[]>("/api/report-numbers"));
  }

  useEffect(() => {
    reload()
      .catch(() => setItems([]))
      .finally(() => setBusy(false));
  }, []);

  async function remove(rn: ReportNumber) {
    if (
      !(await confirmDialog({
        message: t(
          "report.delete_confirm",
          "למחוק את מספר הדוח? השיוכים לדירות ולפעילים יוסרו.",
        ),
        detail: rn.name,
      }))
    ) {
      return;
    }
    await apiFetch(`/api/report-numbers/${rn.id}`, { method: "DELETE" });
    await reload();
    success(t("msg.deleted", "נמחק בהצלחה"));
  }

  if (loading) return <p className="text-gray-400">{t("action.loading", "טוען…")}</p>;
  if (!isAdmin) {
    return (
      <p className="text-status-darkred">
        {t("page.admins_only", "אין לך הרשאה לעמוד זה (מנהלים בלבד).")}
      </p>
    );
  }

  const visible = items.filter(
    (rn) => !query.trim() || rn.name.includes(query.trim()),
  );

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("page.report_numbers", "מספרי דוח")}</h1>
        {!adding && !editing && (
          <button
            onClick={() => setAdding(true)}
            className="rounded-md bg-status-magenta text-white px-4 py-1.5 text-sm font-medium hover:opacity-90"
          >
            + {t("report.add", "מספר דוח חדש")}
          </button>
        )}
      </div>
      <p className="text-sm text-gray-500">
        {t(
          "page.report_numbers_intro",
          "ניהול מספרי הדוח של הארגון — משמשים לשיוך דירות ופעילים.",
        )}
      </p>

      {(adding || editing) && (
        <ReportNumberForm
          item={editing ?? undefined}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setAdding(false);
            setEditing(null);
            await reload();
            success(t("msg.saved", "נשמר בהצלחה"));
          }}
        />
      )}

      <input
        className={`${inputClass} max-w-xs`}
        placeholder={t("filter.search_name", "חיפוש לפי שם…")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
        {busy ? (
          <p className="px-4 py-6 text-center text-gray-400">{t("action.loading", "טוען…")}</p>
        ) : visible.length === 0 ? (
          <p className="px-4 py-6 text-center text-gray-400">
            {t("report.none", "אין מספרי דוח עדיין.")}
          </p>
        ) : (
          visible.map((rn) => (
            <div key={rn.id} className="px-4 py-3 flex flex-wrap items-center gap-2">
              <span className="font-medium min-w-[10rem]">{rn.name}</span>
              <div className="flex items-center gap-2 ms-auto">
                <button
                  onClick={() => {
                    setAdding(false);
                    setEditing(rn);
                  }}
                  className="rounded-md bg-gray-800 text-white px-3 py-1 text-xs hover:opacity-90"
                >
                  {t("action.edit", "ערוך")}
                </button>
                <button
                  onClick={() => remove(rn)}
                  className="rounded-md border border-status-darkred/40 text-status-darkred px-2 py-1 text-xs hover:bg-red-50"
                >
                  {t("action.delete", "מחק")}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ReportNumberForm({
  item,
  onClose,
  onSaved,
}: {
  item?: ReportNumber;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useLocalization();
  const [name, setName] = useState(item?.name ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const body = JSON.stringify({ name: name.trim() });
    try {
      if (item) {
        await apiFetch(`/api/report-numbers/${item.id}`, { method: "PUT", body });
      } else {
        await apiFetch("/api/report-numbers", { method: "POST", body });
      }
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="bg-white rounded-xl shadow-sm p-4 space-y-3">
      <h3 className="font-medium">
        {item ? t("action.edit", "ערוך") : t("report.add", "מספר דוח חדש")}
      </h3>
      <label className="block space-y-1 max-w-sm">
        <span className="block text-sm font-medium">{t("report_number.name", "שם")}</span>
        <input
          className={inputClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("report.name_ph", "שם / מספר…")}
          required
        />
      </label>
      {error && <p className="text-sm text-status-darkred">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-status-magenta text-white px-5 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {busy ? t("action.saving", "שומר…") : t("action.save", "שמור")}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
        >
          {t("action.cancel", "ביטול")}
        </button>
      </div>
    </form>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useConfirm } from "@/lib/confirm";
import { useLocalization } from "@/lib/localization";
import { naturalCompare } from "@/lib/naturalSort";
import { usePersistentState } from "@/lib/persist";
import { useToast } from "@/lib/toast";
import {
  contactFullName,
  type JewishCounts,
  type ReportNumber,
  type ShliachSummary,
} from "@/lib/types";

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";

// fixes53 §3: the grid's optional (toggleable) columns — name + actions
// always show.
const OPTIONAL_COLUMNS = ["jews", "engaged", "activist", "created_at"] as const;
type OptionalColumn = (typeof OPTIONAL_COLUMNS)[number];
type SortKey = "name" | OptionalColumn;

interface Row {
  rn: ReportNumber;
  jews: number;
  engaged: number;
  activists: ShliachSummary[];
}

/** Report-number (מספר דוח, fixes19) CRUD: list + add + inline edit + delete.
 *  fixes53 §3: grown into a grid — calculated Jewish-status columns, the
 *  covering activist(s) (linked to their contact page), a direct link to
 *  that report number's apartments, customizable columns and sorting.
 *  Admin-only — the whole management page is gated on the admin role. */
export default function ReportNumbersPage() {
  const { isAdmin, loading } = useAuth();
  const { t } = useLocalization();
  const confirmDialog = useConfirm();
  const { success } = useToast();
  const [items, setItems] = useState<ReportNumber[]>([]);
  const [jewishCounts, setJewishCounts] = useState<Record<number, JewishCounts>>({});
  const [assignments, setAssignments] = useState<Record<number, ShliachSummary[]>>({});
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ReportNumber | null>(null);
  const [busy, setBusy] = useState(true);
  const [query, setQuery] = useState("");
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [fields, setFields] = usePersistentState<OptionalColumn[]>(
    "crm.reportNumbers.fields", ["jews", "engaged", "activist"],
  );
  const [sortKey, setSortKey] = usePersistentState<SortKey>(
    "crm.reportNumbers.sortKey", "name",
  );
  const [sortDir, setSortDir] = usePersistentState<"asc" | "desc">(
    "crm.reportNumbers.sortDir", "asc",
  );

  async function reload() {
    const [rns, counts, links] = await Promise.all([
      apiFetch<ReportNumber[]>("/api/report-numbers"),
      apiFetch<Record<number, JewishCounts>>("/api/report-numbers/jewish-counts"),
      apiFetch<Record<number, ShliachSummary[]>>(
        "/api/report-numbers/shliach-assignments",
      ),
    ]);
    setItems(rns);
    setJewishCounts(counts);
    setAssignments(links);
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

  function toggleField(f: OptionalColumn) {
    setFields((prev) => (prev.includes(f) ? prev.filter((k) => k !== f) : [...prev, f]));
  }

  function activistLabel(activists: ShliachSummary[]): string {
    return activists.map((a) => contactFullName(a)).join(", ");
  }

  function onSortClick(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  if (loading) return <p className="text-gray-400">{t("action.loading", "טוען…")}</p>;
  if (!isAdmin) {
    return (
      <p className="text-status-darkred">
        {t("page.admins_only", "אין לך הרשאה לעמוד זה (מנהלים בלבד).")}
      </p>
    );
  }

  const rows: Row[] = items
    .filter((rn) => !query.trim() || rn.name.includes(query.trim()))
    .map((rn) => ({
      rn,
      jews: jewishCounts[rn.id]?.jews ?? 0,
      engaged: jewishCounts[rn.id]?.engaged ?? 0,
      activists: assignments[rn.id] ?? [],
    }));

  const sign = sortDir === "asc" ? 1 : -1;
  rows.sort((a, b) => {
    switch (sortKey) {
      case "jews":
        return sign * (a.jews - b.jews);
      case "engaged":
        return sign * (a.engaged - b.engaged);
      case "activist":
        return sign * naturalCompare(activistLabel(a.activists), activistLabel(b.activists));
      case "created_at":
        return sign * ((a.rn.created_at ?? "").localeCompare(b.rn.created_at ?? ""));
      default:
        return sign * naturalCompare(a.rn.name, b.rn.name);
    }
  });

  const columnLabels: Record<OptionalColumn, string> = {
    jews: t("report.jews_count", "מספר יהודים"),
    engaged: t("report.engaged_jews_count", "מספר יהודים מעוניינים"),
    activist: t("report.activist_name", "שם הפעיל"),
    created_at: t("sort.created", "תאריך יצירה"),
  };

  function SortHeader({ column, label }: { column: SortKey; label: string }) {
    return (
      <th
        className="px-3 py-2 text-start font-medium cursor-pointer select-none hover:bg-gray-100"
        onClick={() => onSortClick(column)}
      >
        {label} {sortKey === column ? (sortDir === "asc" ? "↑" : "↓") : ""}
      </th>
    );
  }

  return (
    <div className="space-y-5">
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

      <div className="flex flex-wrap items-center gap-2">
        <input
          className={`${inputClass} max-w-xs`}
          placeholder={t("filter.search_name", "חיפוש לפי שם…")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          onClick={() => setFieldsOpen(!fieldsOpen)}
          className={`rounded-md border px-3 py-2 text-sm ${
            fieldsOpen
              ? "border-status-magenta bg-status-magenta/10 text-status-magenta"
              : "border-gray-300 hover:bg-gray-50"
          }`}
        >
          {t("columns.title", "עמודות מוצגות")}
        </button>
      </div>

      {fieldsOpen && (
        <div className="bg-white rounded-xl shadow-sm p-4 flex flex-wrap gap-2">
          {OPTIONAL_COLUMNS.map((f) => {
            const active = fields.includes(f);
            return (
              <button
                key={f}
                type="button"
                onClick={() => toggleField(f)}
                className={`rounded-md border px-3 py-1.5 text-sm ${
                  active
                    ? "border-status-magenta bg-status-magenta/10 text-status-magenta"
                    : "border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                {active ? "✓ " : ""}
                {columnLabels[f]}
              </button>
            );
          })}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        {busy ? (
          <p className="px-4 py-6 text-center text-gray-400">{t("action.loading", "טוען…")}</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-gray-400">
            {t("report.none", "אין מספרי דוח עדיין.")}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <SortHeader column="name" label={t("report_number.name", "שם")} />
                {fields.map((f) => (
                  <SortHeader key={f} column={f} label={columnLabels[f]} />
                ))}
                <th className="px-3 py-2 text-start font-medium">
                  {t("action.actions", "פעולות")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(({ rn, jews, engaged, activists }) => (
                <tr key={rn.id}>
                  <td className="px-3 py-2 font-medium">{rn.name}</td>
                  {fields.map((f) => (
                    <td key={f} className="px-3 py-2">
                      {f === "jews" && jews}
                      {f === "engaged" && engaged}
                      {f === "created_at" &&
                        (rn.created_at ? new Date(rn.created_at).toLocaleDateString() : "—")}
                      {f === "activist" &&
                        (activists.length === 0 ? (
                          <span className="text-gray-400">
                            {t("report.no_activist", "אין פעיל משויך")}
                          </span>
                        ) : (
                          <span className="flex flex-wrap gap-1">
                            {activists.map((a, i) => (
                              <span key={a.id}>
                                <Link
                                  href={`/dashboard/contacts/${a.id}`}
                                  className="text-status-magenta hover:underline"
                                >
                                  {contactFullName(a)}
                                </Link>
                                {i < activists.length - 1 ? "," : ""}
                              </span>
                            ))}
                          </span>
                        ))}
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {/* fixes53 §3: deep link to this report number's apartments. */}
                      <Link
                        href={`/dashboard/apartments?report_number_ids=${rn.id}`}
                        className="rounded-md border border-status-magenta text-status-magenta px-2 py-1 text-xs hover:bg-status-magenta/10"
                      >
                        {t("report.view_apartments", "הצג דירות")}
                      </Link>
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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

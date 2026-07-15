"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { VisitDetails } from "@/components/VisitDetails";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { usePersistentState } from "@/lib/persist";
import { usePicklist } from "@/lib/picklists";
import type { Visit } from "@/lib/types";
import { useConfirm } from "@/lib/confirm";

export default function VisitsPage() {
  const { isAdmin, loading } = useAuth();
  const { t } = useLocalization();
  const confirmDialog = useConfirm();
  const { labelFor } = usePicklist("visit.type");
  const [visits, setVisits] = useState<Visit[]>([]);
  // fixes15 §1.1/§1.2: search + paging survive navigation.
  const [query, setQuery] = usePersistentState("crm.visits.q", "");
  const [page, setPage] = usePersistentState("crm.visits.page", 1);
  const [pageSize, setPageSize] = usePersistentState("crm.visits.pageSize", 20);
  // fixes26 §2: a row expands to a read-only view ("הצג") or to the inline
  // per-field editor ("ערוך") — both render VisitDetails.
  const [expanded, setExpanded] = useState<{ id: number; mode: "view" | "edit" } | null>(
    null,
  );
  const [loaded, setLoaded] = useState(false);

  async function reload() {
    setVisits(await apiFetch<Visit[]>("/api/visits"));
  }

  useEffect(() => {
    if (loading || !isAdmin) return;
    reload().catch(() => setVisits([])).finally(() => setLoaded(true));
  }, [loading, isAdmin]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return visits;
    return visits.filter(
      (v) =>
        (v.contact_name ?? "").toLowerCase().includes(q) ||
        (v.notes ?? "").toLowerCase().includes(q),
    );
  }, [visits, query]);

  async function remove(id: number) {
    if (!(await confirmDialog({ message: t("visit.delete_confirm", "למחוק ביקור זה?") }))) return;
    await apiFetch(`/api/visits/${id}`, { method: "DELETE" });
    await reload();
  }

  // Client-side pager over the filtered rows (fixes15 §1.1).
  const lastPage = Math.max(1, Math.ceil(shown.length / pageSize));
  const safePage = Math.min(page, lastPage);
  const visible = shown.slice((safePage - 1) * pageSize, safePage * pageSize);
  const rangeText = t("pager.range", "{from}–{to} מתוך {total}")
    .replace("{from}", String(shown.length === 0 ? 0 : (safePage - 1) * pageSize + 1))
    .replace("{to}", String(Math.min(safePage * pageSize, shown.length)))
    .replace("{total}", String(shown.length));

  if (loading) return <p className="text-gray-400">{t("action.loading", "טוען…")}</p>;
  if (!isAdmin) {
    return (
      <p className="text-status-darkred">
        {t("page.admins_only", "אין לך הרשאה לעמוד זה (מנהלים בלבד).")}
      </p>
    );
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("page.visits", "ביקורים")}</h1>
        <Link
          href="/dashboard/visits/add"
          className="rounded-md bg-status-magenta text-white px-4 py-1.5 text-sm font-medium hover:opacity-90"
        >
          {t("visit.add", "הוסף ביקור")}
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <input
          className="w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta"
          placeholder={t("visit.search_ph", "חיפוש לפי איש קשר או הערות…")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
        />
        <span className="ms-auto flex items-center gap-2 text-gray-500">
          {t("pager.page_size", "בעמוד:")}
          <select
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none"
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
          >
            {[20, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </span>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="bg-gray-50 text-gray-600 text-xs">
            <tr>
              <th className="px-3 py-2 text-start font-medium">{t("visit.contact", "איש קשר")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("visit.date", "תאריך")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("visit.type", "סוג ביקור")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("visit.location", "מיקום")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("visit.notes", "הערות")}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {!loaded ? null : shown.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-gray-400">
                  {t("visit.none", "אין ביקורים עדיין.")}
                </td>
              </tr>
            ) : (
              visible.map((v) =>
                expanded?.id === v.id ? (
                  <tr key={v.id} className="border-t border-gray-100">
                    <td colSpan={6} className="p-3">
                      <VisitDetails
                        visit={v}
                        readOnly={expanded.mode === "view"}
                        onPatch={async (partial) => {
                          await apiFetch<Visit>(`/api/visits/${v.id}`, {
                            method: "PATCH",
                            body: JSON.stringify(partial),
                          });
                          await reload();
                        }}
                        onClose={() => setExpanded(null)}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={v.id} className="border-t border-gray-100">
                    <td className="px-3 py-2">
                      {v.contact_id ? (
                        <Link
                          href={`/dashboard/contacts/${v.contact_id}`}
                          className="text-status-magenta hover:underline"
                        >
                          {v.contact_name}
                        </Link>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2" dir="ltr">
                      {new Date(v.visit_date).toLocaleDateString("he-IL")}
                    </td>
                    <td className="px-3 py-2">{v.visit_type ? labelFor(v.visit_type) : ""}</td>
                    <td className="px-3 py-2">{v.location}</td>
                    <td className="px-3 py-2">{v.notes}</td>
                    <td className="px-3 py-2 text-end whitespace-nowrap">
                      <button
                        onClick={() => setExpanded({ id: v.id, mode: "view" })}
                        className="text-sm text-status-magenta hover:underline me-2"
                      >
                        {t("action.view", "הצג")}
                      </button>
                      <button
                        onClick={() => setExpanded({ id: v.id, mode: "edit" })}
                        className="text-sm text-status-magenta hover:underline me-2"
                      >
                        {t("action.edit", "ערוך")}
                      </button>
                      <button
                        onClick={() => remove(v.id)}
                        className="text-sm text-status-darkred hover:underline"
                      >
                        {t("action.delete", "מחק")}
                      </button>
                    </td>
                  </tr>
                ),
              )
            )}
          </tbody>
        </table>
      </div>

      {loaded && shown.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => setPage(safePage - 1)}
            className="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("pager.prev", "→ הקודם")}
          </button>
          <span className="text-gray-500">{rangeText}</span>
          <button
            type="button"
            disabled={safePage >= lastPage}
            onClick={() => setPage(safePage + 1)}
            className="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("pager.next", "הבא ←")}
          </button>
        </div>
      )}
    </div>
  );
}

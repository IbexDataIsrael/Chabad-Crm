"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { usePersistentState } from "@/lib/persist";
import { useToast } from "@/lib/toast";
import {
  buildingDisplayName,
  contactFullName,
  type Area,
  type Building,
  type Contact,
  type ContactPage,
} from "@/lib/types";

type SortKey = "name" | "created";

export default function ShluchimPage() {
  const router = useRouter();
  const { isAdmin, loading } = useAuth();
  const { t } = useLocalization();
  const { success, error: toastError } = useToast();
  const [shluchim, setShluchim] = useState<Contact[]>([]);
  // fixes27 §3: id of the row whose login is being re-created right now.
  const [recreatingId, setRecreatingId] = useState<number | null>(null);
  const [areas, setAreas] = useState<Area[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  // fixes15 §4.1: sorting + multi-select geo filters, all persisted (§1.2).
  const [areaIds, setAreaIds] = usePersistentState<number[]>(
    "crm.shluchim.areaIds", [],
  );
  const [buildingIds, setBuildingIds] = usePersistentState<number[]>(
    "crm.shluchim.buildingIds", [],
  );
  const [sort, setSort] = usePersistentState<SortKey>("crm.shluchim.sort", "name");
  const [dir, setDir] = usePersistentState<"asc" | "desc">("crm.shluchim.dir", "asc");
  const [page, setPage] = usePersistentState("crm.shluchim.page", 1);
  const [pageSize, setPageSize] = usePersistentState("crm.shluchim.pageSize", 20);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(true);
  // Bumped to re-fetch the page after a login re-creation (fixes27 §3).
  const [refreshTick, setRefreshTick] = useState(0);

  // Admin-only page.
  useEffect(() => {
    if (!loading && !isAdmin) router.replace("/dashboard");
  }, [loading, isAdmin, router]);

  useEffect(() => {
    if (loading || !isAdmin) return;
    apiFetch<Area[]>("/api/areas").then(setAreas).catch(() => {});
    apiFetch<Building[]>("/api/buildings").then(setBuildings).catch(() => {});
  }, [loading, isAdmin]);

  // Server-side page (fixes15 §1.1) — filters match the shliach's coverage.
  useEffect(() => {
    if (loading || !isAdmin) return;
    const params = new URLSearchParams();
    params.set("contact_type", "shliach");
    areaIds.forEach((id) => params.append("area_ids", String(id)));
    buildingIds.forEach((id) => params.append("building_ids", String(id)));
    params.set("sort", sort);
    params.set("dir", dir);
    params.set("page", String(page));
    params.set("page_size", String(pageSize));
    setBusy(true);
    apiFetch<ContactPage>(`/api/contacts/list?${params}`)
      .then((res) => {
        setShluchim(res.items);
        setTotal(res.total);
      })
      .catch(() => {
        setShluchim([]);
        setTotal(0);
      })
      .finally(() => setBusy(false));
  }, [loading, isAdmin, areaIds, buildingIds, sort, dir, page, pageSize, refreshTick]);

  // fixes27 §3: one-click recovery of a suspended/deleted shliach login,
  // straight from the row's red notice.
  async function recreateLogin(c: Contact) {
    if (!c.email || recreatingId !== null) return;
    setRecreatingId(c.id);
    try {
      await apiFetch("/api/users/recreate", {
        method: "POST",
        body: JSON.stringify({ email: c.email }),
      });
      success(t("users.user_recreated", "המשתמש נוצר מחדש"));
      setRefreshTick((n) => n + 1);
    } catch (err) {
      toastError(
        err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"),
      );
    } finally {
      setRecreatingId(null);
    }
  }

  if (loading || !isAdmin) return <p className="text-gray-400">{t("action.loading", "טוען…")}</p>;

  const selectClass =
    "rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none";

  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const rangeText = t("pager.range", "{from}–{to} מתוך {total}")
    .replace("{from}", String(total === 0 ? 0 : (page - 1) * pageSize + 1))
    .replace("{to}", String(Math.min(page * pageSize, total)))
    .replace("{total}", String(total));

  const buildingOptions = buildings
    .filter((b) => areaIds.length === 0 || (b.area_id != null && areaIds.includes(b.area_id)))
    .map((b) => ({ id: b.id, label: buildingDisplayName(b) }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{t("page.shluchim", "פעילים")}</h1>
        <Link
          href="/dashboard/contacts/new-shliach"
          className="rounded-md bg-status-magenta text-white px-4 py-2 text-sm font-medium hover:opacity-90"
        >
          + {t("page.add_shliach", "הוסף פעיל")}
        </Link>
      </div>

      {/* fixes15 §4.1: multi-select coverage filters + sorting. */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <MultiSelectFilter
          allLabel={t("filter.all_areas", "כל האזורים")}
          options={areas.map((a) => ({ id: a.id, label: a.area_name }))}
          value={areaIds}
          onChange={(ids) => {
            setAreaIds(ids);
            setBuildingIds((prev) =>
              ids.length === 0
                ? prev
                : prev.filter((bid) =>
                    buildings.some(
                      (b) => b.id === bid && b.area_id != null && ids.includes(b.area_id),
                    ),
                  ),
            );
            setPage(1);
          }}
        />
        <MultiSelectFilter
          allLabel={t("filter.all_buildings", "כל הבניינים")}
          options={buildingOptions}
          value={buildingIds}
          onChange={(ids) => {
            setBuildingIds(ids);
            setPage(1);
          }}
        />
        <span className="flex items-center gap-2 text-gray-500">
          {t("sort.label", "מיון:")}
          <select
            className={selectClass}
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as SortKey);
              setPage(1);
            }}
          >
            <option value="name">{t("sort.by_name", "שם")}</option>
            <option value="created">{t("sort.created", "תאריך יצירה")}</option>
          </select>
          <button
            type="button"
            onClick={() => {
              setDir(dir === "asc" ? "desc" : "asc");
              setPage(1);
            }}
            className="rounded-md border border-gray-300 px-3 py-2 hover:bg-gray-50"
            title={dir === "asc" ? t("sort.asc", "עולה") : t("sort.desc", "יורד")}
          >
            {dir === "asc" ? "↑" : "↓"}
          </button>
        </span>
        <span className="ms-auto flex items-center gap-2 text-gray-500">
          {t("pager.page_size", "בעמוד:")}
          <select
            className={selectClass}
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
        <table className="w-full text-sm min-w-[520px]">
          <thead className="bg-gray-50 text-gray-600 text-start">
            <tr>
              <th className="px-4 py-2 text-start font-medium">{t("common.name", "שם")}</th>
              <th className="px-4 py-2 text-start font-medium">{t("contacts.phone", "טלפון")}</th>
              <th className="px-4 py-2 text-start font-medium">{t("contacts.email", "אימייל")}</th>
              <th className="px-4 py-2 text-start font-medium">
                {t("contacts.created_at", "נוצר בתאריך")}
              </th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {busy ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                  {t("action.loading", "טוען…")}
                </td>
              </tr>
            ) : shluchim.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                  {t("page.no_shluchim", "אין פעילים עדיין.")}
                </td>
              </tr>
            ) : (
              shluchim.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => router.push(`/dashboard/contacts/${c.id}`)}
                  className="border-t border-gray-100 cursor-pointer hover:bg-gray-50/80"
                >
                  <td className="px-4 py-2 font-medium">
                    <span className="text-status-magenta underline">
                      {contactFullName(c)}
                    </span>
                    {/* fixes27 §3: row-level notice for a deleted/disabled
                        login + one-click recovery. */}
                    {c.login_status && c.login_status !== "active" && (
                      <span
                        className="ms-2 inline-flex items-center gap-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="rounded bg-red-50 border border-status-darkred/40 text-status-darkred text-xs px-2 py-0.5">
                          {t("users.login_suspended", "הכניסה למערכת הושעתה")}
                        </span>
                        {c.email && (
                          <button
                            type="button"
                            onClick={() => recreateLogin(c)}
                            disabled={recreatingId !== null}
                            className="rounded-md bg-status-darkred text-white px-2 py-0.5 text-xs font-medium hover:opacity-90 disabled:opacity-50"
                          >
                            {recreatingId === c.id
                              ? t("action.saving", "שומר…")
                              : t("users.recreate_user", "צור משתמש מחדש")}
                          </button>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2" dir="ltr">{c.phone}</td>
                  <td className="px-4 py-2" dir="ltr">{c.email ?? ""}</td>
                  <td className="px-4 py-2" dir="ltr">
                    {new Date(c.created_at).toLocaleDateString("he-IL")}
                  </td>
                  <td className="px-4 py-2 text-end">
                    <Link
                      href={`/dashboard/contacts/${c.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-sm text-status-magenta hover:underline whitespace-nowrap"
                    >
                      {t("action.open_edit", "פתח / עריכה ›")}
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Server-side pager (fixes15 §1.1). */}
      {!busy && total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            className="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("pager.prev", "→ הקודם")}
          </button>
          <span className="text-gray-500">{rangeText}</span>
          <button
            type="button"
            disabled={page >= lastPage}
            onClick={() => setPage(page + 1)}
            className="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("pager.next", "הבא ←")}
          </button>
        </div>
      )}
    </div>
  );
}

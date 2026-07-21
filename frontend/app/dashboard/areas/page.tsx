"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { AreasMap } from "@/components/AreasMap";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { ApiError, apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { usePersistentState } from "@/lib/persist";
import { useToast } from "@/lib/toast";
import type { Area } from "@/lib/types";
import { useConfirm } from "@/lib/confirm";

export default function AreasPage() {
  const { isAdmin, loading } = useAuth();
  const { t } = useLocalization();
  const [areas, setAreas] = useState<Area[]>([]);
  // fixes15 §7.1 multi-select filter + §1.1 pagination, persisted (§1.2).
  const [areaIds, setAreaIds] = usePersistentState<number[]>("crm.areas.ids", []);
  const [page, setPage] = usePersistentState("crm.areas.page", 1);
  const [pageSize, setPageSize] = usePersistentState("crm.areas.pageSize", 20);

  async function reload() {
    setAreas(await apiFetch<Area[]>("/api/areas"));
  }

  useEffect(() => {
    reload().catch(() => {});
  }, []);

  if (loading) return <p className="text-gray-400">{t("action.loading", "טוען…")}</p>;

  const filtered =
    areaIds.length === 0 ? areas : areas.filter((a) => areaIds.includes(a.id));
  const lastPage = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, lastPage);
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const rangeText = t("pager.range", "{from}–{to} מתוך {total}")
    .replace("{from}", String(filtered.length === 0 ? 0 : (safePage - 1) * pageSize + 1))
    .replace("{to}", String(Math.min(safePage * pageSize, filtered.length)))
    .replace("{total}", String(filtered.length));

  const inputClass =
    "rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none";

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("areas", "אזורים")}</h1>
        {isAdmin && (
          <Link
            href="/dashboard/areas/add"
            className="rounded-md bg-status-magenta text-white px-4 py-1.5 text-sm font-medium hover:opacity-90"
          >
            {t("page.add_area", "אזור חדש")}
          </Link>
        )}
      </div>
      <p className="text-sm text-gray-500">{t("page.areas_intro")}</p>

      {areas.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-gray-500">{t("filter.by_area", "סנן לפי אזור:")}</span>
          <MultiSelectFilter
            allLabel={t("filter.all", "הכל")}
            options={areas.map((a) => ({ id: a.id, label: a.area_name }))}
            value={areaIds}
            onChange={(ids) => {
              setAreaIds(ids);
              setPage(1);
            }}
          />
          <span className="ms-auto flex items-center gap-2 text-gray-500">
            {t("pager.page_size", "בעמוד:")}
            <select
              className={inputClass}
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
      )}

      {/* All the org's zone polygons on one map (fixes7 §7A) — filtered. */}
      {filtered.some((a) => a.area_polygon) && (
        <div className="bg-white rounded-xl shadow-sm p-2 space-y-1">
          <h2 className="px-2 pt-1 text-sm font-semibold text-gray-500">
            {t("areas.map_all", "מפת האזורים")}
          </h2>
          <AreasMap areas={filtered} />
        </div>
      )}

      <div className="space-y-3">
        {visible.map((a) => (
          <AreaCard key={a.id} area={a} isAdmin={isAdmin} onChanged={reload} />
        ))}
        {filtered.length === 0 && (
          <p className="bg-white rounded-xl shadow-sm px-4 py-6 text-center text-gray-400">
            {t("page.no_areas", "אין אזורים עדיין.")}
          </p>
        )}
      </div>

      {/* Client-side pager (fixes15 §1.1 — areas live in one small list). */}
      {filtered.length > 0 && (
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

function AreaCard({
  area,
  isAdmin,
  onChanged,
}: {
  area: Area;
  isAdmin: boolean;
  onChanged: () => Promise<void>;
}) {
  const { t } = useLocalization();
  const confirmDialog = useConfirm();
  const { error: toastError } = useToast();
  // fixes33 §2.2: only set while the backend reports the area has buildings
  // and we're waiting on the admin's cascade/unassign/abort choice.
  const [cascadeChoiceOpen, setCascadeChoiceOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function attemptDelete(mode?: "cascade" | "unassign") {
    const qs = mode ? `?mode=${mode}` : "";
    try {
      await apiFetch(`/api/areas/${area.id}${qs}`, { method: "DELETE" });
      setCascadeChoiceOpen(false);
      await onChanged();
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        (err.body as { has_buildings?: boolean } | undefined)?.has_buildings
      ) {
        setCascadeChoiceOpen(true);
        return;
      }
      toastError(err instanceof Error ? err.message : t("msg.delete_failed", "מחיקה נכשלה"));
    }
  }

  async function remove() {
    if (!(await confirmDialog({ message: t("msg.delete_area_confirm", "למחוק את האזור?"), detail: area.area_name })))
      return;
    await attemptDelete();
  }

  async function resolveCascadeChoice(mode: "cascade" | "unassign") {
    setBusy(true);
    try {
      await attemptDelete(mode);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm p-4 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {/* The area name links to its detail page (works even if maps are down). */}
        <Link
          href={`/dashboard/areas/${area.id}`}
          className="font-medium text-status-magenta hover:underline"
        >
          {area.area_name}
        </Link>
        {area.area_polygon ? (
          <span className="rounded bg-status-green/10 text-status-green text-xs px-2 py-0.5">
            {t("page.area_has_boundary", "תחום מוגדר")}
          </span>
        ) : (
          <span className="rounded bg-gray-100 text-gray-500 text-xs px-2 py-0.5">
            {t("page.area_no_boundary", "ללא תחום")}
          </span>
        )}
        <div className="flex items-center gap-2 ms-auto">
          <Link
            href={`/dashboard/areas/${area.id}`}
            className="text-sm text-status-magenta hover:underline"
          >
            {t("page.show_area", "הצג אזור »")}
          </Link>
          {isAdmin && (
            <>
              <Link
                href={`/dashboard/areas/${area.id}/edit`}
                className="rounded-md bg-gray-800 text-white px-3 py-1 text-xs hover:opacity-90"
              >
                {t("action.edit", "ערוך")}
              </Link>
              <button
                onClick={remove}
                className="rounded-md border border-status-darkred/40 text-status-darkred px-2 py-1 text-xs hover:bg-red-50"
              >
                {t("action.delete", "מחק")}
              </button>
            </>
          )}
        </div>
      </div>
      {area.area_notes && <p className="text-sm text-gray-600">{area.area_notes}</p>}
      {/* fixes33 §2.2: three real outcomes (cascade / unassign / abort), not a
          plain yes/no — the generic useConfirm modal only has two. */}
      {cascadeChoiceOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm bg-white rounded-xl shadow-xl p-5 space-y-4">
            <h2 className="text-lg font-bold">{t("confirm.title", "אישור פעולה")}</h2>
            <p className="text-sm text-gray-700">
              {t(
                "areas.delete_has_buildings_confirm",
                "לאזור זה יש בניינים. האם למחוק את הבניינים?",
              )}
            </p>
            <div className="flex flex-col items-stretch gap-2 pt-1">
              <button
                type="button"
                disabled={busy}
                onClick={() => resolveCascadeChoice("cascade")}
                className="rounded-md bg-status-darkred text-white px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                {t("areas.delete_cascade_buildings", "מחק בניינים ודירות")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => resolveCascadeChoice("unassign")}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                {t("areas.delete_keep_buildings", "השאר בניינים (בטל שיוך לאזור)")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setCascadeChoiceOpen(false)}
                className="text-xs text-gray-500 hover:underline"
              >
                {t("action.cancel", "ביטול")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

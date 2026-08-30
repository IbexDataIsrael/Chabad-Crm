"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { AreasMap } from "@/components/AreasMap";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { ApiError, apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { naturalCompare } from "@/lib/naturalSort";
import { usePersistentState } from "@/lib/persist";
import { useToast } from "@/lib/toast";
import { contactFullName, type Area, type JewishCounts, type ShliachSummary } from "@/lib/types";
import { useConfirm } from "@/lib/confirm";

// fixes53 §3: the grid's optional (toggleable) columns — name always shows.
const OPTIONAL_COLUMNS = ["boundary", "jews", "engaged", "activist"] as const;
type OptionalColumn = (typeof OPTIONAL_COLUMNS)[number];
type SortKey = "name" | OptionalColumn;

interface Row {
  area: Area;
  jews: number;
  engaged: number;
  activists: ShliachSummary[];
}

export default function AreasPage() {
  const { isAdmin, loading } = useAuth();
  const { t } = useLocalization();
  const [areas, setAreas] = useState<Area[]>([]);
  const [jewishCounts, setJewishCounts] = useState<Record<number, JewishCounts>>({});
  const [assignments, setAssignments] = useState<Record<number, ShliachSummary[]>>({});
  // fixes15 §7.1 multi-select filter + §1.1 pagination, persisted (§1.2).
  const [areaIds, setAreaIds] = usePersistentState<number[]>("crm.areas.ids", []);
  const [page, setPage] = usePersistentState("crm.areas.page", 1);
  const [pageSize, setPageSize] = usePersistentState("crm.areas.pageSize", 20);
  // fixes53 §3: grid controls, matching apartments/report-numbers.
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [fields, setFields] = usePersistentState<OptionalColumn[]>(
    "crm.areas.fields", ["boundary", "jews", "engaged", "activist"],
  );
  const [sortKey, setSortKey] = usePersistentState<SortKey>("crm.areas.sortKey", "name");
  const [sortDir, setSortDir] = usePersistentState<"asc" | "desc">("crm.areas.sortDir", "asc");

  async function reload() {
    const [rows, counts, links] = await Promise.all([
      apiFetch<Area[]>("/api/areas"),
      apiFetch<Record<number, JewishCounts>>("/api/areas/jewish-counts"),
      apiFetch<Record<number, ShliachSummary[]>>("/api/areas/shliach-assignments"),
    ]);
    setAreas(rows);
    setJewishCounts(counts);
    setAssignments(links);
  }

  useEffect(() => {
    reload().catch(() => {});
  }, []);

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

  const filtered =
    areaIds.length === 0 ? areas : areas.filter((a) => areaIds.includes(a.id));

  const rows: Row[] = filtered.map((area) => ({
    area,
    jews: jewishCounts[area.id]?.jews ?? 0,
    engaged: jewishCounts[area.id]?.engaged ?? 0,
    activists: assignments[area.id] ?? [],
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
      case "boundary":
        return sign * (Number(!!a.area.area_polygon) - Number(!!b.area.area_polygon));
      default:
        return sign * naturalCompare(a.area.area_name, b.area.area_name);
    }
  });

  const lastPage = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, lastPage);
  const visible = rows.slice((safePage - 1) * pageSize, safePage * pageSize);
  const rangeText = t("pager.range", "{from}–{to} מתוך {total}")
    .replace("{from}", String(rows.length === 0 ? 0 : (safePage - 1) * pageSize + 1))
    .replace("{to}", String(Math.min(safePage * pageSize, rows.length)))
    .replace("{total}", String(rows.length));

  const inputClass =
    "rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none";

  const columnLabels: Record<OptionalColumn, string> = {
    boundary: t("page.area_boundary_col", "תחום"),
    jews: t("report.jews_count", "מספר יהודים"),
    engaged: t("report.engaged_jews_count", "מספר יהודים מעוניינים"),
    activist: t("report.activist_name", "שם הפעיל"),
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
          <button
            type="button"
            onClick={() => setFieldsOpen(!fieldsOpen)}
            className={`rounded-md border px-3 py-2 ${
              fieldsOpen
                ? "border-status-magenta bg-status-magenta/10 text-status-magenta"
                : "border-gray-300 hover:bg-gray-50"
            }`}
          >
            {t("columns.title", "עמודות מוצגות")}
          </button>
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

      {/* All the org's zone polygons on one map (fixes7 §7A) — filtered. */}
      {filtered.some((a) => a.area_polygon) && (
        <div className="bg-white rounded-xl shadow-sm p-2 space-y-1">
          <h2 className="px-2 pt-1 text-sm font-semibold text-gray-500">
            {t("areas.map_all", "מפת האזורים")}
          </h2>
          <AreasMap areas={filtered} />
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-gray-400">
            {t("page.no_areas", "אין אזורים עדיין.")}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <SortHeader column="name" label={t("areas.area_name", "כותרת")} />
                {fields.map((f) => (
                  <SortHeader key={f} column={f} label={columnLabels[f]} />
                ))}
                <th className="px-3 py-2 text-start font-medium">
                  {t("action.actions", "פעולות")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.map(({ area, jews, engaged, activists }) => (
                <AreaRow
                  key={area.id}
                  area={area}
                  jews={jews}
                  engaged={engaged}
                  activists={activists}
                  fields={fields}
                  isAdmin={isAdmin}
                  onChanged={reload}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Client-side pager (fixes15 §1.1 — areas live in one small list). */}
      {rows.length > 0 && (
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

function AreaRow({
  area,
  jews,
  engaged,
  activists,
  fields,
  isAdmin,
  onChanged,
}: {
  area: Area;
  jews: number;
  engaged: number;
  activists: ShliachSummary[];
  fields: OptionalColumn[];
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
    <tr>
      <td className="px-3 py-2">
        <Link
          href={`/dashboard/areas/${area.id}`}
          className="font-medium text-status-magenta hover:underline"
        >
          {area.area_name}
        </Link>
      </td>
      {fields.map((f) => (
        <td key={f} className="px-3 py-2">
          {f === "jews" && jews}
          {f === "engaged" && engaged}
          {f === "boundary" &&
            (area.area_polygon ? (
              <span className="rounded bg-status-green/10 text-status-green text-xs px-2 py-0.5">
                {t("page.area_has_boundary", "תחום מוגדר")}
              </span>
            ) : (
              <span className="rounded bg-gray-100 text-gray-500 text-xs px-2 py-0.5">
                {t("page.area_no_boundary", "ללא תחום")}
              </span>
            ))}
          {f === "activist" &&
            (activists.length === 0 ? (
              <span className="text-gray-400">{t("report.no_activist", "אין פעיל משויך")}</span>
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
          <Link
            href={`/dashboard/areas/${area.id}`}
            className="text-status-magenta hover:underline"
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
      </td>
    </tr>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { BuildingsMap } from "@/components/BuildingsMap";
import { ConfirmModal } from "@/components/ConfirmModal";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useFieldSettings } from "@/lib/fieldSettings";
import { useLocalization } from "@/lib/localization";
import { usePersistentState } from "@/lib/persist";
import { useToast } from "@/lib/toast";
import { useConfirm } from "@/lib/confirm";
import {
  apartmentTitle,
  buildingDisplayName,
  formatCoords,
  type Apartment,
  type Area,
  type Building,
  type BuildingPage,
} from "@/lib/types";

type SortKey = "address" | "name" | "area" | "created";

export default function BuildingsPage() {
  const { isAdmin, loading } = useAuth();
  const { t } = useLocalization();
  const [areas, setAreas] = useState<Area[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  // fixes15 §7.1: multi-area filter + sorting; §1.2: everything persisted.
  const [areaIds, setAreaIds] = usePersistentState<number[]>(
    "crm.buildings.areaIds", [],
  );
  const [sort, setSort] = usePersistentState<SortKey>("crm.buildings.sort", "address");
  const [dir, setDir] = usePersistentState<"asc" | "desc">("crm.buildings.dir", "asc");
  const [page, setPage] = usePersistentState("crm.buildings.page", 1);
  const [pageSize, setPageSize] = usePersistentState("crm.buildings.pageSize", 20);
  const [total, setTotal] = useState(0);

  // One server-side page of buildings (fixes12 §3.3); הכל is the default
  // filter (fixes11 §2.6) and fetching stays lazy per filter change.
  async function reload() {
    const params = new URLSearchParams();
    areaIds.forEach((id) => params.append("area_ids", String(id)));
    params.set("sort", sort);
    params.set("dir", dir);
    params.set("page", String(page));
    params.set("page_size", String(pageSize));
    const res = await apiFetch<BuildingPage>(`/api/buildings/list?${params}`);
    setBuildings(res.items);
    setTotal(res.total);
  }

  useEffect(() => {
    apiFetch<Area[]>("/api/areas").then(setAreas).catch(() => {});
  }, []);

  useEffect(() => {
    reload().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaIds, sort, dir, page, pageSize]);

  function onAreasChange(ids: number[]) {
    setAreaIds(ids);
    setPage(1);
  }

  function onPageSizeChange(n: number) {
    setPageSize(n);
    setPage(1);
  }

  function goToPage(p: number) {
    setPage(p);
  }

  const areaName = useMemo(() => {
    const map = new Map<number, string>();
    areas.forEach((a) => map.set(a.id, a.area_name));
    return (id: number) => map.get(id) ?? "—";
  }, [areas]);

  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const rangeText = t("pager.range", "{from}–{to} מתוך {total}")
    .replace("{from}", String(total === 0 ? 0 : (page - 1) * pageSize + 1))
    .replace("{to}", String(Math.min(page * pageSize, total)))
    .replace("{total}", String(total));

  if (loading) return <p className="text-gray-400">{t("action.loading", "טוען…")}</p>;

  const inputClass =
    "rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("buildings", "בניינים")}</h1>
        {isAdmin && areas.length > 0 && (
          <Link
            href="/dashboard/buildings/add"
            className="rounded-md bg-status-magenta text-white px-4 py-1.5 text-sm font-medium hover:opacity-90"
          >
            {t("page.add_building", "הוסף בניין")}
          </Link>
        )}
      </div>
      {areas.length === 0 ? (
        <p className="text-sm text-status-darkred">
          {t("page.need_area_first", "יש להגדיר אזור אחד לפחות לפני הוספת בניין.")}{" "}
          <Link href="/dashboard/areas/add" className="font-medium underline hover:text-status-magenta">
            {t("page.add_area", "אזור חדש")}
          </Link>
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-gray-500">{t("filter.by_area", "סנן לפי אזור:")}</span>
          {/* fixes15 §7.1: several areas at once (like the apartments view). */}
          <MultiSelectFilter
            allLabel={t("filter.all", "הכל")}
            options={areas.map((a) => ({ id: a.id, label: a.area_name }))}
            value={areaIds}
            onChange={onAreasChange}
          />
          {/* fixes15 §7.1: full column sorting. */}
          <span className="flex items-center gap-2 text-gray-500">
            {t("sort.label", "מיון:")}
            <select
              className={inputClass}
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as SortKey);
                setPage(1);
              }}
            >
              <option value="address">{t("sort.address", "כתובת")}</option>
              <option value="name">{t("buildings.building_name", "שם בניין")}</option>
              <option value="area">{t("sort.area", "אזור")}</option>
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
              className={inputClass}
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
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

      {buildings.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-2">
          {/* fixes11 §2.5: geo-fence polygons overlay the building markers. */}
          <BuildingsMap buildings={buildings} areas={areas} />
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
        {buildings.map((b) => (
          <BuildingRow
            key={b.id}
            building={b}
            areaName={areaName(b.area_id)}
            isAdmin={isAdmin}
            onDeleted={reload}
          />
        ))}
        {buildings.length === 0 && (
          <p className="px-4 py-6 text-center text-gray-400">{t("page.no_buildings", "אין בניינים להצגה.")}</p>
        )}
      </div>

      {/* Server-side pager (fixes12 §3.3). */}
      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => goToPage(page - 1)}
            className="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("pager.prev", "→ הקודם")}
          </button>
          <span className="text-gray-500">{rangeText}</span>
          <button
            type="button"
            disabled={page >= lastPage}
            onClick={() => goToPage(page + 1)}
            className="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("pager.next", "הבא ←")}
          </button>
        </div>
      )}
    </div>
  );
}

function DeleteButton({
  id,
  name,
  onDone,
}: {
  id: number;
  name: string;
  onDone: () => Promise<void>;
}) {
  const { t } = useLocalization();
  const confirmDialog = useConfirm();
  const { success } = useToast();
  async function remove() {
    if (!(await confirmDialog({ message: t("msg.delete_building_confirm", "למחוק את הבניין?"), detail: name }))) return;
    await apiFetch(`/api/buildings/${id}`, { method: "DELETE" });
    await onDone();
    success(t("msg.deleted", "נמחק בהצלחה"));
  }
  return (
    <button
      onClick={remove}
      className="rounded-md border border-status-darkred/40 text-status-darkred px-2 py-1 text-xs hover:bg-red-50"
    >
      {t("action.delete", "מחק")}
    </button>
  );
}

// One building row: summary line + an expandable panel listing its apartments.
// Editing routes to the dedicated /dashboard/buildings/edit/{id} page.
function BuildingRow({
  building,
  areaName,
  isAdmin,
  onDeleted,
}: {
  building: Building;
  areaName: string;
  isAdmin: boolean;
  onDeleted: () => Promise<void>;
}) {
  const { t } = useLocalization();
  const { isFieldVisible } = useFieldSettings();
  const [open, setOpen] = useState(false);
  const display = buildingDisplayName(building);
  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[10rem]">
          <Link
            href={`/dashboard/buildings/${building.id}`}
            className="font-medium text-status-magenta hover:underline"
          >
            {display}
          </Link>
          {isFieldVisible("buildings.building_name") &&
            building.building_name &&
            building.building_name !== display && (
              <div className="text-sm text-gray-500">{building.building_name}</div>
            )}
          {building.latitude != null && building.longitude != null && (
            <div className="text-xs text-gray-400">
              <span>{t("buildings.coords", "קואורדינטות")}: </span>
              <span dir="ltr">{formatCoords(building.latitude, building.longitude)}</span>
            </div>
          )}
        </div>
        <span className="rounded bg-gray-100 text-gray-600 text-xs px-2 py-0.5">{areaName}</span>
        {(building.floors?.length ?? 0) > 0 && (
          <span className="rounded bg-gray-100 text-gray-600 text-xs px-2 py-0.5">
            {building.floors!.length} {t("buildings.floors", "קומות")}
          </span>
        )}
        <div className="flex items-center gap-2 ms-auto">
          <button
            onClick={() => setOpen((o) => !o)}
            className="text-sm text-status-magenta hover:underline"
          >
            {open ? t("page.hide_apartments", "הסתר דירות") : t("page.show_apartments", "הצג דירות")}
          </button>
          {isAdmin && (
            <>
              <Link
                href={`/dashboard/buildings/edit/${building.id}`}
                className="rounded-md bg-gray-800 text-white px-3 py-1 text-xs hover:opacity-90"
              >
                {t("action.edit", "ערוך")}
              </Link>
              <DeleteButton id={building.id} name={display} onDone={onDeleted} />
            </>
          )}
        </div>
      </div>
      {open && <BuildingApartments building={building} isAdmin={isAdmin} />}
    </div>
  );
}

// Apartment list for a single building — add/edit route to the standalone
// apartment views (fixes12 §2); delete uses the localized modal (§3.1).
function BuildingApartments({ building, isAdmin }: { building: Building; isAdmin: boolean }) {
  const { t } = useLocalization();
  const { success } = useToast();
  const [apts, setApts] = useState<Apartment[] | null>(null);
  const [deleting, setDeleting] = useState<Apartment | null>(null);

  const returnTo = encodeURIComponent("/dashboard/buildings");

  async function reload() {
    setApts(await apiFetch<Apartment[]>(`/api/apartments?building_id=${building.id}`));
  }

  useEffect(() => {
    reload().catch(() => setApts([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [building.id]);

  async function remove(apt: Apartment) {
    setDeleting(null);
    await apiFetch(`/api/apartments/${apt.id}`, { method: "DELETE" });
    await reload();
    success(t("msg.deleted", "נמחק בהצלחה"));
  }

  return (
    <div className="mt-3 border-t border-gray-100 pt-3 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-gray-500">{t("apartments", "דירות")}</h4>
        <Link
          href={`/dashboard/apartments/add?building=${building.id}&return=${returnTo}`}
          className="text-xs text-status-magenta hover:underline"
        >
          + {t("apt.add_apartment", "הוסף דירה")}
        </Link>
      </div>

      {deleting && (
        <ConfirmModal
          message={t("apt.delete_confirm", "למחוק את הדירה?")}
          detail={apartmentTitle(deleting)}
          onCancel={() => setDeleting(null)}
          onConfirm={() => remove(deleting)}
        />
      )}

      {apts === null ? (
        <p className="text-sm text-gray-400">{t("action.loading", "טוען…")}</p>
      ) : apts.length === 0 ? (
        <p className="text-sm text-gray-400">{t("apt.no_apartments_building", "אין דירות בבניין זה.")}</p>
      ) : (
        <ul className="space-y-1">
          {apts.map((a) => (
            <li key={a.id} className="flex items-center gap-2 text-sm">
              <Link
                href={`/dashboard/apartments/${a.id}`}
                className="font-medium text-status-magenta hover:underline"
              >
                {apartmentTitle(a)}
              </Link>
              {a.name && <span className="text-gray-600">{a.name}</span>}
              {a.apartment_notes && <span className="text-gray-500">— {a.apartment_notes}</span>}
              <span className="ms-auto flex items-center gap-2">
                <Link
                  href={`/dashboard/apartments/edit/${a.id}?return=${returnTo}`}
                  className="text-xs text-gray-600 hover:underline"
                >
                  {t("action.edit", "ערוך")}
                </Link>
                {isAdmin && (
                  <button
                    onClick={() => setDeleting(a)}
                    className="text-xs text-status-darkred hover:underline"
                  >
                    {t("action.delete", "מחק")}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

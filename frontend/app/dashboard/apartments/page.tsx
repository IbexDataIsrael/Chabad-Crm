"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { ApartmentEditor } from "@/components/ApartmentEditor";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { useToast } from "@/lib/toast";
import {
  apartmentTitle,
  buildingDisplayName,
  type ApartmentListItem,
  type ApartmentPage,
  type Area,
  type Building,
  type Floor,
} from "@/lib/types";

const inputClass =
  "rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";

const PAGE_SIZES = [20, 50, 100];

type SortKey = "floor" | "label" | "resident" | "building";
type SortDir = "asc" | "desc";

/** Filter/sort/page values a handler wants applied before state has settled. */
interface LoadOverrides {
  areaId?: string;
  buildingId?: string;
  q?: string;
  sort?: SortKey;
  dir?: SortDir;
  page?: number;
  pageSize?: number;
}

export default function ApartmentsPage() {
  const { loading, isShliach } = useAuth();
  const { t } = useLocalization();
  const [items, setItems] = useState<ApartmentListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [areas, setAreas] = useState<Area[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [filterArea, setFilterArea] = useState("");
  const [filterBuilding, setFilterBuilding] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("floor");
  const [dir, setDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [adding, setAdding] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [busy, setBusy] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function reload(over: LoadOverrides = {}) {
    const params = new URLSearchParams();
    const areaId = over.areaId ?? filterArea;
    const buildingId = over.buildingId ?? filterBuilding;
    const q = (over.q ?? query).trim();
    if (areaId) params.set("area_id", areaId);
    if (buildingId) params.set("building_id", buildingId);
    if (q) params.set("q", q);
    params.set("sort", over.sort ?? sort);
    params.set("dir", over.dir ?? dir);
    params.set("page", String(over.page ?? page));
    params.set("page_size", String(over.pageSize ?? pageSize));
    const res = await apiFetch<ApartmentPage>(`/api/apartments/list?${params}`);
    setItems(res.items);
    setTotal(res.total);
  }

  // The building dropdown holds only the active area's buildings (fixes8 §2B).
  async function loadBuildings(areaId: string) {
    const list = await apiFetch<Building[]>(
      `/api/buildings${areaId ? `?area_id=${areaId}` : ""}`,
    ).catch(() => [] as Building[]);
    setBuildings(list);
    return list;
  }

  // Boot (fixes8 §2A): land pre-filtered on the first area (fallback: first
  // building) instead of loading the whole org. Shliach users skip the default
  // — their list is already server-scoped to the apartments they cover, and a
  // default area could hide all of them.
  useEffect(() => {
    if (loading) return;
    (async () => {
      const a = await apiFetch<Area[]>("/api/areas").catch(() => [] as Area[]);
      setAreas(a);
      const areaId = !isShliach && a.length > 0 ? String(a[0].id) : "";
      const bs = await loadBuildings(areaId);
      const buildingId = !isShliach && !areaId && bs.length > 0 ? String(bs[0].id) : "";
      setFilterArea(areaId);
      setFilterBuilding(buildingId);
      await reload({ areaId, buildingId, page: 1 });
    })()
      .catch(() => setItems([]))
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // Debounced dynamic search (street name / label / resident).
  function onQueryChange(v: string) {
    setQuery(v);
    setPage(1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => reload({ q: v, page: 1 }).catch(() => {}), 300);
  }

  function onAreaChange(v: string) {
    setFilterArea(v);
    setFilterBuilding("");
    setPage(1);
    loadBuildings(v).catch(() => {});
    reload({ areaId: v, buildingId: "", page: 1 }).catch(() => {});
  }

  function onBuildingChange(v: string) {
    setFilterBuilding(v);
    setPage(1);
    reload({ buildingId: v, page: 1 }).catch(() => {});
  }

  function onSortChange(v: SortKey) {
    setSort(v);
    setPage(1);
    reload({ sort: v, page: 1 }).catch(() => {});
  }

  function onDirToggle() {
    const d: SortDir = dir === "asc" ? "desc" : "asc";
    setDir(d);
    setPage(1);
    reload({ dir: d, page: 1 }).catch(() => {});
  }

  function onPageSizeChange(n: number) {
    setPageSize(n);
    setPage(1);
    reload({ pageSize: n, page: 1 }).catch(() => {});
  }

  function goToPage(p: number) {
    setPage(p);
    reload({ page: p }).catch(() => {});
  }

  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const rangeText = t("pager.range", "{from}–{to} מתוך {total}")
    .replace("{from}", String(total === 0 ? 0 : (page - 1) * pageSize + 1))
    .replace("{to}", String(Math.min(page * pageSize, total)))
    .replace("{total}", String(total));

  if (loading) return <p className="text-gray-400">{t("action.loading", "טוען…")}</p>;

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{t("apartments", "דירות")}</h1>
        {!isShliach && (
          <div className="flex items-center gap-2">
            {!batchOpen && (
              <button
                onClick={() => setBatchOpen(true)}
                className="rounded-md border border-status-magenta text-status-magenta px-4 py-1.5 text-sm font-medium hover:bg-status-magenta/10"
              >
                {t("batch.open", "יצירה מרובה")}
              </button>
            )}
            {!adding && (
              <button
                onClick={() => setAdding(true)}
                className="rounded-md bg-status-magenta text-white px-4 py-1.5 text-sm font-medium hover:opacity-90"
              >
                + {t("apt.add_apartment", "הוסף דירה")}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Dataset filters (fixes8 §2): area + building bounds, street lookup. */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-gray-500">{t("filter.by_area", "סנן לפי אזור:")}</span>
        <select
          className={inputClass}
          value={filterArea}
          onChange={(e) => onAreaChange(e.target.value)}
        >
          <option value="">{t("filter.all_areas", "כל האזורים")}</option>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.area_name}
            </option>
          ))}
        </select>
        <select
          className={inputClass}
          value={filterBuilding}
          onChange={(e) => onBuildingChange(e.target.value)}
        >
          <option value="">{t("filter.all_buildings", "כל הבניינים")}</option>
          {buildings.map((b) => (
            <option key={b.id} value={b.id}>
              {buildingDisplayName(b)}
            </option>
          ))}
        </select>
        <input
          className={`${inputClass} flex-1 min-w-[12rem]`}
          placeholder={t("apt.street_search", "חיפוש לפי שם רחוב…")}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
      </div>

      {/* Sorting (fixes8 §1C) + page size (fixes8 §2C). */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-gray-500">{t("sort.label", "מיון:")}</span>
        <select
          className={inputClass}
          value={sort}
          onChange={(e) => onSortChange(e.target.value as SortKey)}
        >
          <option value="floor">{t("sort.floor", "קומה")}</option>
          <option value="label">{t("sort.by_label", "תווית דירה")}</option>
          <option value="resident">{t("sort.resident", "שם דייר")}</option>
          <option value="building">{t("sort.building", "בניין")}</option>
        </select>
        <button
          type="button"
          onClick={onDirToggle}
          className="rounded-md border border-gray-300 px-3 py-2 hover:bg-gray-50"
          title={dir === "asc" ? t("sort.asc", "עולה") : t("sort.desc", "יורד")}
        >
          {dir === "asc" ? "↑" : "↓"} {dir === "asc" ? t("sort.asc", "עולה") : t("sort.desc", "יורד")}
        </button>
        <span className="ms-auto text-gray-500">{t("pager.page_size", "בעמוד:")}</span>
        <select
          className={inputClass}
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      {batchOpen && (
        <BatchModal
          onClose={() => setBatchOpen(false)}
          onDone={async () => {
            setBatchOpen(false);
            await reload();
          }}
        />
      )}

      {adding && (
        <div className="bg-white rounded-xl shadow-sm p-4">
          <ApartmentEditor
            onClose={() => setAdding(false)}
            onSaved={async () => {
              setAdding(false);
              await reload();
            }}
          />
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
        {busy ? (
          <p className="px-4 py-6 text-center text-gray-400">{t("action.loading", "טוען…")}</p>
        ) : items.length === 0 ? (
          <p className="px-4 py-6 text-center text-gray-400">
            {t("apt.no_apartments_page", "אין דירות להצגה.")}
          </p>
        ) : (
          items.map((a) => (
            <div key={a.id} className="px-4 py-3 flex flex-wrap items-center gap-2">
              <div className="min-w-[9rem]">
                <Link
                  href={`/dashboard/apartments/${a.id}`}
                  className="font-medium text-status-magenta hover:underline"
                >
                  {apartmentTitle(a)}
                </Link>
                {a.name && <span className="ms-2 text-sm text-gray-600">{a.name}</span>}
                <div className="text-xs text-gray-500">
                  {[buildingDisplayName({ id: a.building_id, building_name: a.building_name, building_address: a.building_address }), a.area_name]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <div className="ms-auto text-sm">
                {a.contact_id ? (
                  <Link
                    href={`/dashboard/contacts/${a.contact_id}`}
                    className="rounded-full bg-status-magenta/10 text-status-magenta px-3 py-1 hover:bg-status-magenta/20"
                  >
                    {a.contact_name}
                  </Link>
                ) : (
                  <span className="text-gray-400">{t("apt.no_contact", "ללא איש קשר")}</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Server-side pager (fixes8 §2C). */}
      {!busy && total > 0 && (
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

/** Bulk apartment generator (fixes7 §5): building → floors → explicit label
 *  tokens → Cartesian product, in one request/transaction. Fetches the full
 *  building list itself — the page's dropdown is scoped to the active area. */
function BatchModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { t } = useLocalization();
  const { success, error: toastError } = useToast();
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [buildingId, setBuildingId] = useState<number | "">("");
  const [floors, setFloors] = useState<Floor[]>([]);
  const [selectedFloors, setSelectedFloors] = useState<number[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [labelInput, setLabelInput] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<Building[]>("/api/buildings")
      .then(setBuildings)
      .catch(() => setBuildings([]));
  }, []);

  useEffect(() => {
    if (buildingId === "") {
      setFloors([]);
      setSelectedFloors([]);
      return;
    }
    apiFetch<Floor[]>(`/api/buildings/${buildingId}/floors`)
      .then((f) => {
        setFloors(f);
        setSelectedFloors([]);
      })
      .catch(() => setFloors([]));
  }, [buildingId]);

  function toggleFloor(id: number) {
    setSelectedFloors((prev) =>
      prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id],
    );
  }

  function addLabel() {
    // Explicit token selection: comma/space-separated entries become chips.
    const tokens = labelInput
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (tokens.length === 0) return;
    setLabels((prev) => [...prev, ...tokens.filter((tk) => !prev.includes(tk))]);
    setLabelInput("");
  }

  async function run() {
    setError("");
    if (buildingId === "" || selectedFloors.length === 0 || labels.length === 0) {
      setError(t("batch.pick_floor_label", "יש לבחור לפחות קומה אחת ותווית אחת"));
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch<{ created: number; skipped: number }>(
        "/api/apartments/batch",
        {
          method: "POST",
          body: JSON.stringify({
            building_id: Number(buildingId),
            floor_ids: selectedFloors,
            labels,
          }),
        },
      );
      success(
        t("batch.result", "נוצרו {created} דירות ({skipped} דולגו — קיימות)")
          .replace("{created}", String(res.created))
          .replace("{skipped}", String(res.skipped)),
      );
      await onDone();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה");
      setError(msg);
      toastError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg bg-white rounded-xl shadow-xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div>
          <h2 className="text-lg font-bold">{t("batch.title", "יצירת דירות מרובות")}</h2>
          <p className="text-sm text-gray-500">
            {t(
              "batch.intro",
              "בחר בניין, קומות ותוויות דירה — כל השילובים ייווצרו בבת אחת.",
            )}
          </p>
        </div>

        <label className="block space-y-1">
          <span className="block text-sm font-medium">{t("apartments.building_id", "בניין")}</span>
          <select
            className={`${inputClass} w-full`}
            value={buildingId}
            onChange={(e) => setBuildingId(e.target.value === "" ? "" : Number(e.target.value))}
          >
            <option value="">{t("apt.choose_building", "בחר בניין…")}</option>
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>
                {buildingDisplayName(b)}
              </option>
            ))}
          </select>
        </label>

        {buildingId !== "" && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="block text-sm font-medium">{t("batch.floors", "קומות")}</span>
              {floors.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedFloors(floors.map((f) => f.id))}
                  className="text-xs text-status-magenta hover:underline"
                >
                  {t("batch.select_all", "בחר הכל")}
                </button>
              )}
            </div>
            {floors.length === 0 ? (
              <p className="text-sm text-gray-400">
                {t("batch.no_floors", "לבניין זה אין קומות. הוסף קומות בעריכת הבניין.")}
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {floors.map((f) => (
                  <label
                    key={f.id}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm cursor-pointer ${
                      selectedFloors.includes(f.id)
                        ? "border-status-magenta bg-status-magenta/10 text-status-magenta"
                        : "border-gray-200 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="accent-status-magenta"
                      checked={selectedFloors.includes(f.id)}
                      onChange={() => toggleFloor(f.id)}
                    />
                    {f.name}
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="space-y-1">
          <span className="block text-sm font-medium">
            {t("batch.labels", "מספרי / אותיות דירות")}
          </span>
          {labels.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {labels.map((l) => (
                <li
                  key={l}
                  className="inline-flex items-center gap-1 rounded-full bg-status-magenta/10 text-status-magenta px-3 py-1 text-sm"
                >
                  {l}
                  <button
                    type="button"
                    onClick={() => setLabels((prev) => prev.filter((x) => x !== l))}
                    className="text-status-magenta/70 hover:text-status-darkred"
                    aria-label={t("action.remove", "הסר")}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-2">
            <input
              className={`${inputClass} w-40`}
              dir="ltr"
              placeholder={t("batch.label_placeholder", "לדוגמה A או 1")}
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addLabel();
                }
              }}
            />
            <button
              type="button"
              onClick={addLabel}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
            >
              + {t("batch.add_label", "הוסף")}
            </button>
          </div>
        </div>

        {error && <p className="text-sm text-status-darkred">{error}</p>}
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="rounded-md bg-status-magenta text-white px-5 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {busy ? t("action.saving", "שומר…") : t("batch.create", "צור דירות")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
          >
            {t("action.cancel", "ביטול")}
          </button>
        </div>
      </div>
    </div>
  );
}

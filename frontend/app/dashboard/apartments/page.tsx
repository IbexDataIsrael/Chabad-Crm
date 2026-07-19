"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";

import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { PicklistSelect } from "@/components/PicklistSelect";
import { SearchableSelect } from "@/components/SearchableSelect";
import { InlineEdit } from "@/components/ui/InlineEdit";
import { MultiSelectSearchFilter } from "@/components/ui/MultiSelectSearchFilter";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { mapsHref } from "@/lib/contactActions";
import { useLocalization } from "@/lib/localization";
import { usePersistentState } from "@/lib/persist";
import { usePicklist } from "@/lib/picklists";
import { useDbPreference } from "@/lib/preferences";
import { useToast } from "@/lib/toast";
import {
  apartmentTitle,
  buildingDisplayName,
  type Apartment,
  type ApartmentBulkUpdateResult,
  type ApartmentListItem,
  type ApartmentPage,
  type Area,
  type Building,
  type BuildingAggregate,
  type Floor,
  type ReportNumber,
  type ReportNumberBuildingLink,
} from "@/lib/types";

const inputClass =
  "rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta";

const PAGE_SIZES = [20, 50, 100];

type SortKey = "floor" | "label" | "resident" | "building";
type SortDir = "asc" | "desc";

/** Toggleable table columns (fixes15 §7.2 / fixes17 §3.1); the apartment
 * title and the linked contact always show. */
const FIELD_KEYS = [
  "resident",
  "building",
  "area",
  "report_number",
  "notes",
  "phone",
  "email",
  "language",
  "jewish_status",
  "campaign_status",
  "mezuzah_status",
] as const;
type FieldKey = (typeof FIELD_KEYS)[number];
const DEFAULT_FIELDS: FieldKey[] = ["resident", "building", "area"];

export default function ApartmentsPage() {
  const { loading, isShliach } = useAuth();
  const { t } = useLocalization();
  const [items, setItems] = useState<ApartmentListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [areas, setAreas] = useState<Area[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  // fixes20 §3 / fixes23 §2: report-number filter source + multi-selection.
  const [reportNumbers, setReportNumbers] = useState<ReportNumber[]>([]);
  const [reportNumberIds, setReportNumberIds] = usePersistentState<number[]>(
    "crm.apartments.reportNumberIds", [],
  );
  // fixes23 §2: (report number → building) links drive the conditional building
  // filter — a building shows only while it holds a matching apartment.
  const [reportBuildingLinks, setReportBuildingLinks] = useState<
    ReportNumberBuildingLink[]
  >([]);
  // fixes15 §1.2: filters/sort/page survive navigation; §7.1: multi-area.
  const [areaIds, setAreaIds] = usePersistentState<number[]>(
    "crm.apartments.areaIds", [],
  );
  // fixes23 §2: multi-select building filter (was single-select).
  const [buildingIds, setBuildingIds] = usePersistentState<number[]>(
    "crm.apartments.buildingIds", [],
  );
  // fixes18 §5.2: picklist filters (multi-select technical values).
  const [jewishFilter, setJewishFilter] = usePersistentState<string[]>(
    "crm.apartments.jewish", [],
  );
  const [mezuzahFilter, setMezuzahFilter] = usePersistentState<string[]>(
    "crm.apartments.mezuzah", [],
  );
  const [query, setQuery] = usePersistentState("crm.apartments.q", "");
  const [sort, setSort] = usePersistentState<SortKey>("crm.apartments.sort", "floor");
  const [dir, setDir] = usePersistentState<SortDir>("crm.apartments.dir", "asc");
  const [page, setPage] = usePersistentState("crm.apartments.page", 1);
  const [pageSize, setPageSize] = usePersistentState("crm.apartments.pageSize", 20);
  // fixes17 §1.1: the column selection lives in the DB (follows the account).
  const [fields, setFields] = useDbPreference<FieldKey[]>(
    "apartments.fields", DEFAULT_FIELDS,
  );
  // fixes30 §1b: the linked-contact column has its own toggle — a separate
  // preference (not a new fields-array entry) so every existing saved column
  // selection keeps showing the column.
  const [showContact, setShowContact] = useDbPreference<boolean>(
    "apartments.showContact", true,
  );
  // fixes30 §1a: group the table by building; the sort is forced to
  // "building" while active so groups stay contiguous across pages.
  const [groupByBuilding, setGroupByBuilding] = usePersistentState(
    "crm.apartments.groupByBuilding", false,
  );
  const [aggregates, setAggregates] = useState<Record<number, number>>({});
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [debouncedQ, setDebouncedQ] = useState(query);
  const [batchOpen, setBatchOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [busy, setBusy] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const language = usePicklist("apartment.language");
  const jewish = usePicklist("apartment.Jewish_status");
  const campaign = usePicklist("apartment.campaign_status");
  const mezuzah = usePicklist("apartment.mezuzah_status");

  async function reload() {
    const params = new URLSearchParams();
    areaIds.forEach((id) => params.append("area_ids", String(id)));
    buildingIds.forEach((id) => params.append("building_ids", String(id)));
    reportNumberIds.forEach((id) => params.append("report_number_ids", String(id)));
    jewishFilter.forEach((v) => params.append("jewish_status", v));
    mezuzahFilter.forEach((v) => params.append("mezuzah_status", v));
    if (debouncedQ.trim()) params.set("q", debouncedQ.trim());
    // fixes30 §1a: grouping needs building-contiguous rows.
    params.set("sort", groupByBuilding ? "building" : sort);
    params.set("dir", dir);
    params.set("page", String(page));
    params.set("page_size", String(pageSize));
    const res = await apiFetch<ApartmentPage>(`/api/apartments/list?${params}`);
    setItems(res.items);
    setTotal(res.total);
  }

  // Boot: load the filter sources once; the list itself is fetched by the
  // effect below (restored filters included — fixes15 §1.2).
  useEffect(() => {
    if (loading) return;
    apiFetch<Area[]>("/api/areas").then(setAreas).catch(() => setAreas([]));
    apiFetch<Building[]>("/api/buildings")
      .then(setBuildings)
      .catch(() => setBuildings([]));
    apiFetch<ReportNumber[]>("/api/report-numbers")
      .then(setReportNumbers)
      .catch(() => setReportNumbers([]));
    // fixes23 §2: which buildings each report number appears in.
    apiFetch<ReportNumberBuildingLink[]>("/api/apartments/report-number-buildings")
      .then(setReportBuildingLinks)
      .catch(() => setReportBuildingLinks([]));
  }, [loading]);

  // One server-side page per filter/sort/page change.
  useEffect(() => {
    if (loading) return;
    setBusy(true);
    reload()
      .catch(() => {
        setItems([]);
        setTotal(0);
      })
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    loading, areaIds, buildingIds, reportNumberIds, jewishFilter, mezuzahFilter,
    debouncedQ, sort, dir, page, pageSize, groupByBuilding,
  ]);

  // fixes30 §1a: filter-scoped per-building counts for the group headers —
  // each building shows its full filtered count, not just this page's rows.
  useEffect(() => {
    if (loading || !groupByBuilding) return;
    const params = new URLSearchParams();
    areaIds.forEach((id) => params.append("area_ids", String(id)));
    buildingIds.forEach((id) => params.append("building_ids", String(id)));
    reportNumberIds.forEach((id) => params.append("report_number_ids", String(id)));
    jewishFilter.forEach((v) => params.append("jewish_status", v));
    mezuzahFilter.forEach((v) => params.append("mezuzah_status", v));
    if (debouncedQ.trim()) params.set("q", debouncedQ.trim());
    apiFetch<BuildingAggregate[]>(`/api/apartments/building-aggregates?${params}`)
      .then((rows) =>
        setAggregates(Object.fromEntries(rows.map((r) => [r.building_id, r.count]))),
      )
      .catch(() => setAggregates({}));
  }, [
    loading, groupByBuilding, areaIds, buildingIds, reportNumberIds,
    jewishFilter, mezuzahFilter, debouncedQ,
  ]);

  // Debounced dynamic search (street name / label / resident).
  function onQueryChange(v: string) {
    setQuery(v);
    setPage(1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQ(v), 300);
  }

  // fixes23 §2: buildings that hold an apartment carrying a selected report
  // number. null = no report filter active, so no building restriction.
  const buildingIdsForReports =
    reportNumberIds.length === 0
      ? null
      : new Set(
          reportBuildingLinks
            .filter((l) => reportNumberIds.includes(l.report_number_id))
            .map((l) => l.building_id),
        );

  function onAreasChange(ids: number[]) {
    setAreaIds(ids);
    // Drop building selections that fell outside the chosen areas.
    if (buildingIds.length > 0 && ids.length > 0) {
      const kept = buildingIds.filter((id) =>
        buildings.some((b) => b.id === id && ids.includes(b.area_id)),
      );
      if (kept.length !== buildingIds.length) setBuildingIds(kept);
    }
    setPage(1);
  }

  function onBuildingsChange(ids: number[]) {
    setBuildingIds(ids);
    setPage(1);
  }

  function onReportNumbersChange(ids: number[]) {
    setReportNumberIds(ids);
    // Drop building selections that no longer contain a matching apartment.
    if (buildingIds.length > 0 && ids.length > 0) {
      const allowed = new Set(
        reportBuildingLinks
          .filter((l) => ids.includes(l.report_number_id))
          .map((l) => l.building_id),
      );
      const kept = buildingIds.filter((id) => allowed.has(id));
      if (kept.length !== buildingIds.length) setBuildingIds(kept);
    }
    setPage(1);
  }

  function onSortChange(v: SortKey) {
    setSort(v);
    setPage(1);
  }

  function onDirToggle() {
    setDir(dir === "asc" ? "desc" : "asc");
    setPage(1);
  }

  function onPageSizeChange(n: number) {
    setPageSize(n);
    setPage(1);
  }

  function goToPage(p: number) {
    setPage(p);
  }

  function toggleField(k: FieldKey) {
    setFields((prev) =>
      prev.includes(k) ? prev.filter((f) => f !== k) : [...prev, k],
    );
  }

  // fixes30 §1c: one-field inline save from the list. The PUT is a fixes19 §3
  // versioned edit returning a NEW active row — swap the row's id in place so
  // the page, scroll and filters all stay put.
  async function saveListField(
    a: ApartmentListItem,
    field: "jewish_status" | "campaign_status" | "mezuzah_status",
    v: string | null,
  ) {
    const saved = await apiFetch<Apartment>(`/api/apartments/${a.id}`, {
      method: "PUT",
      body: JSON.stringify({ [field]: v }),
    });
    setItems((prev) =>
      prev.map((it) => (it.id === a.id ? { ...it, id: saved.id, [field]: v } : it)),
    );
  }

  const inlinePicklistCell = (
    a: ApartmentListItem,
    field: "jewish_status" | "campaign_status" | "mezuzah_status",
    picklistKey: string,
    label: string | null | undefined,
  ) => (
    <InlineEdit<string | null>
      value={a[field] ?? null}
      display={label || "—"}
      commitOnBlur={false}
      onSave={(v) => saveListField(a, field, v)}
      editor={(draft, _setDraft, commit) => (
        <PicklistSelect fieldKey={picklistKey} value={draft} onChange={commit} />
      )}
    />
  );

  const fieldLabels: Record<FieldKey, string> = {
    resident: t("apartments.name", "שם דייר"),
    building: t("apartments.building_id", "בניין"),
    area: t("buildings.area_id", "אזור"),
    report_number: t("apartments.report_number_id", "מספר דוח"),
    notes: t("apartments.apartment_notes", "הערות"),
    phone: t("apartments.phone", "טלפון"),
    email: t("apartments.email", "אימייל"),
    language: t("picklist.apartment.language", "שפה"),
    jewish_status: t("picklist.apartment.Jewish_status", "יהדות"),
    campaign_status: t("picklist.apartment.campaign_status", "סטטוס קמפיין"),
    mezuzah_status: t("picklist.apartment.mezuzah_status", "מזוזה"),
  };
  // Ignore unknown stored keys (older versions used e.g. "location").
  const activeFields = FIELD_KEYS.filter((k) => fields.includes(k));

  function cell(a: ApartmentListItem, k: FieldKey) {
    switch (k) {
      case "resident":
        return a.name ?? "—";
      case "building": {
        const name = buildingDisplayName({
          id: a.building_id,
          building_name: a.building_name,
          building_address: a.building_address,
        });
        // fixes30 §4: the shluchim display navigates via Google Maps.
        if (isShliach && a.building_address) {
          return (
            <a
              href={mapsHref(a.building_address)}
              target="_blank"
              rel="noopener noreferrer"
              title={t("apt.navigate", "ניווט בגוגל מפות")}
              className="text-status-magenta hover:underline"
            >
              📍 {name}
            </a>
          );
        }
        return name;
      }
      case "area":
        return a.area_name ?? "—";
      case "report_number":
        return a.report_number_name ?? "—";
      case "notes":
        return a.apartment_notes ?? "—";
      case "phone":
        return a.phone ? <span dir="ltr">{a.phone}</span> : "—";
      case "email":
        return a.email ? <span dir="ltr">{a.email}</span> : "—";
      case "language":
        return language.labelFor(a.language) || "—";
      // fixes30 §1c: these three edit in place, straight from the list row.
      case "jewish_status":
        return inlinePicklistCell(
          a, "jewish_status", "apartment.Jewish_status",
          jewish.labelFor(a.jewish_status),
        );
      case "campaign_status":
        return inlinePicklistCell(
          a, "campaign_status", "apartment.campaign_status",
          campaign.labelFor(a.campaign_status),
        );
      case "mezuzah_status":
        return inlinePicklistCell(
          a, "mezuzah_status", "apartment.mezuzah_status",
          mezuzah.labelFor(a.mezuzah_status),
        );
    }
  }

  const visibleBuildings = buildings.filter(
    (b) =>
      (areaIds.length === 0 || areaIds.includes(b.area_id)) &&
      // fixes23 §2: when report numbers are selected, only buildings that hold a
      // matching apartment remain choosable.
      (buildingIdsForReports === null || buildingIdsForReports.has(b.id)),
  );

  // Title + optional data columns + optional contact column + trailing filler.
  const colCount = 2 + activeFields.length + (showContact ? 1 : 0);

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
            {/* Dedicated add route (fixes12 §2.2). */}
            <Link
              href="/dashboard/apartments/add"
              className="rounded-md bg-status-magenta text-white px-4 py-1.5 text-sm font-medium hover:opacity-90"
            >
              + {t("apt.add_apartment", "הוסף דירה")}
            </Link>
          </div>
        )}
      </div>

      {/* Dataset filters (fixes8 §2): multi-area (fixes15 §7.1) + building
          bounds, street lookup. */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-gray-500">{t("filter.by_area", "סנן לפי אזור:")}</span>
        <MultiSelectFilter
          allLabel={t("filter.all_areas", "כל האזורים")}
          options={areas.map((a) => ({ id: a.id, label: a.area_name }))}
          value={areaIds}
          onChange={onAreasChange}
        />
        {/* fixes23 §2: multi-select searchable building filter. */}
        <MultiSelectSearchFilter
          className="w-56"
          allLabel={t("filter.all_buildings", "כל הבניינים")}
          options={visibleBuildings.map((b) => ({
            id: b.id,
            label: buildingDisplayName(b),
          }))}
          value={buildingIds}
          onChange={onBuildingsChange}
          searchPlaceholder={t("filter.search_buildings", "חיפוש בניין…")}
        />
        {/* fixes23 §2: multi-select searchable report-number filter. */}
        {reportNumbers.length > 0 && (
          <MultiSelectSearchFilter
            className="w-48"
            allLabel={t("filter.all_report_numbers", "כל מספרי הדוח")}
            options={reportNumbers.map((rn) => ({ id: rn.id, label: rn.name }))}
            value={reportNumberIds}
            onChange={onReportNumbersChange}
            searchPlaceholder={t("filter.search_report_numbers", "חיפוש מספר דוח…")}
          />
        )}
        {/* fixes18 §5.2: Jewish-status + mezuzah picklist filters. */}
        <MultiSelectFilter
          allLabel={t("filter.all_jewish", "כל סטטוסי היהדות")}
          options={jewish.options.map((o) => ({ id: o.value, label: jewish.display(o) }))}
          value={jewishFilter}
          onChange={(vals) => {
            setJewishFilter(vals);
            setPage(1);
          }}
        />
        <MultiSelectFilter
          allLabel={t("filter.all_mezuzah", "כל סטטוסי המזוזה")}
          options={mezuzah.options.map((o) => ({ id: o.value, label: mezuzah.display(o) }))}
          value={mezuzahFilter}
          onChange={(vals) => {
            setMezuzahFilter(vals);
            setPage(1);
          }}
        />
        <input
          className={`${inputClass} flex-1 min-w-[12rem]`}
          placeholder={t("apt.street_search", "חיפוש לפי שם רחוב…")}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
      </div>

      {/* Sorting (fixes8 §1C) + field config (fixes15 §7.2) + page size. */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-gray-500">{t("sort.label", "מיון:")}</span>
        <select
          className={inputClass}
          value={groupByBuilding ? "building" : sort}
          disabled={groupByBuilding}
          title={
            groupByBuilding
              ? t("apt.grouping_sort_hint", "בזמן קיבוץ לפי בניין המיון קבוע לפי בניין")
              : undefined
          }
          onChange={(e) => onSortChange(e.target.value as SortKey)}
        >
          <option value="floor">{t("sort.floor", "קומה")}</option>
          <option value="label">{t("sort.by_label", "תווית דירה")}</option>
          <option value="resident">{t("sort.resident", "שם דייר")}</option>
          <option value="building">{t("sort.building", "בניין")}</option>
          {/* fixes17 §3.2: chronological sorting. */}
          <option value="created">{t("sort.created", "תאריך יצירה")}</option>
        </select>
        <button
          type="button"
          onClick={onDirToggle}
          className="rounded-md border border-gray-300 px-3 py-2 hover:bg-gray-50"
          title={dir === "asc" ? t("sort.asc", "עולה") : t("sort.desc", "יורד")}
        >
          {dir === "asc" ? "↑" : "↓"} {dir === "asc" ? t("sort.asc", "עולה") : t("sort.desc", "יורד")}
        </button>
        {/* fixes30 §1a: aggregate the rows under per-building headers. */}
        <button
          type="button"
          onClick={() => setGroupByBuilding(!groupByBuilding)}
          className={`rounded-md border px-3 py-2 ${
            groupByBuilding
              ? "border-status-magenta bg-status-magenta/10 text-status-magenta"
              : "border-gray-300 hover:bg-gray-50"
          }`}
        >
          {groupByBuilding ? "✓ " : ""}
          {t("apt.group_by_building", "קיבוץ לפי בניין")}
        </button>
        <button
          type="button"
          onClick={() => setFieldsOpen((v) => !v)}
          className="rounded-md border border-gray-300 px-3 py-2 hover:bg-gray-50"
        >
          ⚙ {t("columns.fields_configure", "התאמת שדות")}
        </button>
        {/* fixes23 §3: bulk edit the apartments matching the active filters —
            enabled only while there are matching rows to change. */}
        {!isShliach && (
          <button
            type="button"
            onClick={() => setBulkOpen(true)}
            disabled={busy || total === 0}
            className="rounded-md border border-status-magenta text-status-magenta px-3 py-2 font-medium hover:bg-status-magenta/10 disabled:opacity-40 disabled:cursor-not-allowed"
            title={t("bulkedit.open_hint", "עריכה מרובה של כל הדירות המסוננות")}
          >
            ✎ {t("bulkedit.open", "עריכה מרובה")}
          </button>
        )}
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

      {/* fixes15 §7.2: user-selected row attributes (persisted per browser). */}
      {fieldsOpen && (
        <div className="bg-white rounded-xl shadow-sm p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{t("columns.title", "עמודות מוצגות")}</h3>
            <button
              type="button"
              onClick={() => setFields(DEFAULT_FIELDS)}
              className="text-xs text-status-magenta hover:underline"
            >
              {t("columns.reset", "איפוס ברירת מחדל")}
            </button>
          </div>
          <p className="text-xs text-gray-400">
            {t(
              "columns.hint",
              "בחר אילו עמודות יוצגו בטבלה. ההעדפה נשמרת בדפדפן זה.",
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            {FIELD_KEYS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => toggleField(k)}
                className={`rounded-md border px-3 py-1.5 text-sm ${
                  activeFields.includes(k)
                    ? "border-status-magenta bg-status-magenta/10 text-status-magenta"
                    : "border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                {activeFields.includes(k) ? "✓ " : ""}
                {fieldLabels[k]}
              </button>
            ))}
            {/* fixes30 §1b: the linked-contact column, previously always on. */}
            <button
              type="button"
              onClick={() => setShowContact(!showContact)}
              className={`rounded-md border px-3 py-1.5 text-sm ${
                showContact
                  ? "border-status-magenta bg-status-magenta/10 text-status-magenta"
                  : "border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {showContact ? "✓ " : ""}
              {t("apartments.contact", "איש קשר")}
            </button>
          </div>
        </div>
      )}

      {batchOpen && (
        <BatchModal
          onClose={() => setBatchOpen(false)}
          onDone={async () => {
            setBatchOpen(false);
            await reload();
          }}
        />
      )}

      {bulkOpen && (
        <BulkEditModal
          total={total}
          reportNumbers={reportNumbers}
          filters={{
            building_ids: buildingIds,
            area_ids: areaIds,
            report_number_ids: reportNumberIds,
            jewish_status: jewishFilter,
            mezuzah_status: mezuzahFilter,
            q: debouncedQ.trim() || undefined,
          }}
          onClose={() => setBulkOpen(false)}
          onDone={async () => {
            setBulkOpen(false);
            await reload();
          }}
        />
      )}

      {/* fixes17 §3.1: a real table — every column carries its field's title. */}
      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-right">
            <tr>
              <th className="px-3 py-1.5 font-medium w-px whitespace-nowrap">
                {t("apartments.apartment_name", "מספר דירה")}
              </th>
              {activeFields.map((k) => (
                <th key={k} className="px-3 py-1.5 font-medium w-px whitespace-nowrap">
                  {fieldLabels[k]}
                </th>
              ))}
              {/* fixes30 §1b: toggleable via the fields panel. */}
              {showContact && (
                <th className="px-3 py-1.5 font-medium w-px whitespace-nowrap">
                  {t("apartments.contact", "איש קשר")}
                </th>
              )}
              <th className="w-full"></th>
            </tr>
          </thead>
          <tbody>
            {busy ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-6 text-center text-gray-400">
                  {t("action.loading", "טוען…")}
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-6 text-center text-gray-400">
                  {t("apt.no_apartments_page", "אין דירות להצגה.")}
                </td>
              </tr>
            ) : (
              items.map((a, i) => (
                <Fragment key={a.id}>
                  {/* fixes30 §1a: a header row opens each building group (also
                      when a group continues from the previous page). */}
                  {groupByBuilding &&
                    (i === 0 || items[i - 1].building_id !== a.building_id) && (
                      <tr className="border-t border-gray-200 bg-gray-50/80">
                        <td colSpan={colCount} className="px-3 py-2">
                          <span className="font-semibold">
                            {cell(a, "building")}
                          </span>
                          {a.area_name && (
                            <span className="ms-2 text-gray-500">{a.area_name}</span>
                          )}
                          {aggregates[a.building_id] !== undefined && (
                            <span className="ms-2 rounded-full bg-status-magenta/10 text-status-magenta px-2 py-0.5 text-xs">
                              {t("apt.group_count", "{n} דירות").replace(
                                "{n}",
                                String(aggregates[a.building_id]),
                              )}
                            </span>
                          )}
                        </td>
                      </tr>
                    )}
                  <tr className="border-t border-gray-100">
                    <td className="px-3 py-2 w-px whitespace-nowrap">
                      <Link
                        href={`/dashboard/apartments/${a.id}`}
                        className="font-medium text-status-magenta hover:underline"
                      >
                        {apartmentTitle(a)}
                      </Link>
                    </td>
                    {activeFields.map((k) => (
                      <td key={k} className="px-3 py-2 w-px whitespace-nowrap max-w-[14rem] truncate">
                        {cell(a, k)}
                      </td>
                    ))}
                    {showContact && (
                      <td className="px-3 py-2 w-px whitespace-nowrap">
                        {a.contact_id ? (
                          <Link
                            href={`/dashboard/contacts/${a.contact_id}`}
                            className="rounded-full bg-status-magenta/10 text-status-magenta px-3 py-0.5 hover:bg-status-magenta/20"
                          >
                            {a.contact_name}
                          </Link>
                        ) : (
                          <span className="text-gray-400">{t("apt.no_contact", "ללא איש קשר")}</span>
                        )}
                      </td>
                    )}
                    <td></td>
                  </tr>
                </Fragment>
              ))
            )}
          </tbody>
        </table>
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
          <SearchableSelect
            value={buildingId === "" ? null : buildingId}
            onChange={(id) => setBuildingId(id ?? "")}
            options={buildings.map((b) => ({ id: b.id, label: buildingDisplayName(b) }))}
            placeholder={t("apt.choose_building", "בחר בניין…")}
          />
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

/** The active-filter snapshot passed to the bulk editor — mirrors the query
 *  params sent to /api/apartments/list (fixes23 §3). */
type BulkFilters = {
  building_ids: number[];
  area_ids: number[];
  report_number_ids: number[];
  jewish_status: string[];
  mezuzah_status: string[];
  q?: string;
};

/** Bulk apartment editor (fixes23 §3): apply a new report number and/or notes
 *  to *every* apartment matching the page's current filters, in one request.
 *  Each field carries an explicit "update this field" toggle so an untouched
 *  field is left alone (rather than silently cleared). */
function BulkEditModal({
  total,
  reportNumbers,
  filters,
  onClose,
  onDone,
}: {
  total: number;
  reportNumbers: ReportNumber[];
  filters: BulkFilters;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { t } = useLocalization();
  const { success, error: toastError } = useToast();
  const [updateReport, setUpdateReport] = useState(false);
  const [reportNumberId, setReportNumberId] = useState<number | null>(null);
  const [updateNotes, setUpdateNotes] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function apply() {
    setError("");
    if (!updateReport && !updateNotes) {
      setError(t("bulkedit.pick_field", "יש לבחור לפחות שדה אחד לעדכון"));
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch<ApartmentBulkUpdateResult>(
        "/api/apartments/bulk-update",
        {
          method: "POST",
          body: JSON.stringify({
            building_ids: filters.building_ids,
            area_ids: filters.area_ids,
            report_number_ids: filters.report_number_ids,
            jewish_status: filters.jewish_status,
            mezuzah_status: filters.mezuzah_status,
            q: filters.q,
            set_report_number: updateReport,
            report_number_id: updateReport ? reportNumberId : null,
            set_notes: updateNotes,
            apartment_notes: updateNotes ? notes : null,
          }),
        },
      );
      success(
        t("bulkedit.result", "{n} דירות עודכנו").replace("{n}", String(res.updated)),
      );
      await onDone();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה");
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
          <h2 className="text-lg font-bold">
            {t("bulkedit.title", "עריכה מרובה של דירות")}
          </h2>
          <p className="text-sm text-gray-500">
            {t(
              "bulkedit.intro",
              "השינויים יחולו על כל {total} הדירות התואמות לסינון הנוכחי.",
            ).replace("{total}", String(total))}
          </p>
        </div>

        {/* Report number */}
        <div className="space-y-1 rounded-lg border border-gray-200 p-3">
          <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
            <input
              type="checkbox"
              className="accent-status-magenta"
              checked={updateReport}
              onChange={(e) => setUpdateReport(e.target.checked)}
            />
            {t("bulkedit.set_report", "עדכן מספר דוח")}
          </label>
          {updateReport && (
            <div className="pt-1 space-y-1">
              <SearchableSelect
                value={reportNumberId}
                onChange={(id) => setReportNumberId(id)}
                options={reportNumbers.map((rn) => ({ id: rn.id, label: rn.name }))}
                placeholder={t("bulkedit.choose_report", "בחר מספר דוח…")}
              />
              <p className="text-xs text-gray-400">
                {t("bulkedit.clear_hint", "השאר ריק כדי להסיר את מספר הדוח מהדירות.")}
              </p>
            </div>
          )}
        </div>

        {/* Notes */}
        <div className="space-y-1 rounded-lg border border-gray-200 p-3">
          <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
            <input
              type="checkbox"
              className="accent-status-magenta"
              checked={updateNotes}
              onChange={(e) => setUpdateNotes(e.target.checked)}
            />
            {t("bulkedit.set_notes", "עדכן הערות")}
          </label>
          {updateNotes && (
            <textarea
              className={`${inputClass} w-full`}
              rows={3}
              placeholder={t("apartments.apartment_notes", "הערות")}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          )}
        </div>

        {error && <p className="text-sm text-status-darkred">{error}</p>}
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={apply}
            disabled={busy || total === 0}
            className="rounded-md bg-status-magenta text-white px-5 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {busy ? t("action.saving", "שומר…") : t("bulkedit.apply", "החל שינויים")}
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

"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Layers, Plus, Settings2, SlidersHorizontal, X } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { PicklistSelect } from "@/components/PicklistSelect";
import { SearchableSelect } from "@/components/SearchableSelect";
import { CustomFieldValueDisplay, CustomFieldValueInput } from "@/components/CustomFieldValueInput";
import { InlineEdit } from "@/components/ui/InlineEdit";
import { MultiSelectEditor } from "@/components/ui/MultiSelectEditor";
import { MultiSelectSearchFilter } from "@/components/ui/MultiSelectSearchFilter";
import { TruncatedText } from "@/components/ui/TruncatedText";
import { apiFetch } from "@/lib/api";
import { isFeatureEnabled, useAuth } from "@/lib/auth";
import { mapsHref } from "@/lib/contactActions";
import { useCustomFieldDefs } from "@/lib/customFields";
import { useFieldSettings } from "@/lib/fieldSettings";
import { useLocalization } from "@/lib/localization";
import { usePersistentState } from "@/lib/persist";
import { FIXED_APARTMENT_PICKLIST_KEYS, usePicklist, usePicklistsMap } from "@/lib/picklists";
import { useDbPreference } from "@/lib/preferences";
import { useToast } from "@/lib/toast";
import { useSortableList } from "@/lib/useSortableList";
import { EMAIL_HINT, PHONE_HINT, isValidEmail, isValidPhone } from "@/lib/validation";
import {
  apartmentTitle,
  buildingDisplayName,
  type Apartment,
  type ApartmentBulkUpdateResult,
  type ApartmentListItem,
  type ApartmentPage,
  type Area,
  type Building,
  type CustomFieldDefinition,
  type Floor,
  type PicklistField,
  type ReportNumber,
  type ReportNumberBuildingLink,
} from "@/lib/types";

const inputClass =
  "rounded-md border border-input px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

const PAGE_SIZES = [20, 50, 100];

// fixes53 §2: Excel-style "blank" selection for a dynamic text-field filter
// — must exactly match the backend's EMPTY_FIELD_SENTINEL (apartments.py).
const EMPTY_FIELD_SENTINEL = "\x00__empty__\x00";

type SortKey =
  | "floor" | "label" | "resident" | "building" | "created" | "hierarchy"
  // fixes54 §1.1: header-click sorting on the remaining plain/single-join
  // grid columns.
  | "area" | "report_number" | "notes" | "phone" | "email";
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
// fixes33 §5.2: each toggleable column's Manage Fields registry key, so an
// org-wide hide (from /dashboard/fields) removes it here too — mirrors the
// pattern already used on the Contacts page. "building"/"area" have no
// registry entry (structural, never hideable).
const FIELD_REGISTRY_KEYS: Partial<Record<FieldKey, string>> = {
  resident: "apartments.name",
  report_number: "apartments.report_number_id",
  notes: "apartments.apartment_notes",
  phone: "apartments.phone",
  email: "apartments.email",
  language: "apartment.language",
  jewish_status: "apartment.Jewish_status",
  campaign_status: "apartment.campaign_status",
  mezuzah_status: "apartment.mezuzah_status",
};
// fixes54 §1.1: header-click sort arrows (mirrors Report Numbers) — only for
// columns the backend can actually order by (plain columns / single-join
// relations). Picklist-backed columns (jewish/campaign/mezuzah status,
// language) and every dynamic custom field/picklist/contact column have no
// entry here, so their header renders with no arrow and isn't clickable.
const FIELD_SORT_KEYS: Partial<Record<FieldKey, SortKey>> = {
  resident: "resident",
  building: "building",
  area: "area",
  report_number: "report_number",
  notes: "notes",
  phone: "phone",
  email: "email",
};

export default function ApartmentsPage() {
  const { loading, isShliach, user } = useAuth();
  // fixes51 §4: org-wide Shliach Role Configuration Panel settings — only
  // ever consulted for isShliach users (an admin/staff session ignores it).
  const shliachViewConfig = user?.organization?.shliach_view_config;
  const shliachEditDisabled = isShliach && !!shliachViewConfig?.disable_edit;
  const shliachFiltersHidden = isShliach && !!shliachViewConfig?.hide_filters;
  // fixes54 §6: per-field "Edit Lock" (dashboard/shliach-config) — a
  // narrower complement to the blanket disable_edit above. Only ever
  // consulted for isShliach users, same as every other shliachViewConfig read
  // on this page.
  const apartmentEditLockedFields = new Set(
    isShliach && Array.isArray(shliachViewConfig?.apartment_edit_locked_fields)
      ? (shliachViewConfig.apartment_edit_locked_fields as string[])
      : [],
  );
  const fieldEditLocked = (k: FieldKey) =>
    shliachEditDisabled || apartmentEditLockedFields.has(k);
  // fixes54 §6: hides the "Customize fields" column picker entirely for an
  // activist when the admin has locked it — the feature itself (and its
  // persisted per-user state) is untouched, just not reachable from the UI.
  const customizeFieldsLocked = isShliach && !!shliachViewConfig?.customize_fields_locked;
  const { t, lang } = useLocalization();
  const router = useRouter();
  const searchParams = useSearchParams();
  // fixes33 §5.2: org-wide field hiding (Manage Fields) must also apply here
  // — filters, column-selector chips and the rendered columns themselves.
  const { isFieldVisible: vis } = useFieldSettings();
  const fieldVisible = (k: FieldKey) => {
    const registryKey = FIELD_REGISTRY_KEYS[k];
    return registryKey ? vis(registryKey) : true;
  };
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
  // fixes32 §6: language filter, same multi-select pattern as jewish/mezuzah.
  const [languageFilter, setLanguageFilter] = usePersistentState<string[]>(
    "crm.apartments.language", [],
  );
  // fixes32 §6: any admin-added apartment.* picklist beyond the fixed 4 —
  // each one automatically gets a filter (here) and a grid column (below),
  // keyed by field_key so the set can grow with no page code changes.
  const [customDefs, setCustomDefs] = useState<PicklistField[]>([]);
  const [customFilters, setCustomFilters] = usePersistentState<Record<string, string[]>>(
    "crm.apartments.customFilters", {},
  );
  // fixes52 §2.6: which custom apartment.* picklists are HIDDEN from the
  // table — a field absent from this array is visible, same as any built-in
  // column. Was an inclusion-list ("apartments.customFields", null = all
  // visible) — the moment an admin hid even one field it became the concrete
  // set of field_keys that existed *then*, so any field created afterward
  // was silently absent from it and defaulted to hidden. New preference key
  // (not reused) so a stale inclusion-list value is never misread as a
  // hidden-list one — same migration fixes50 did for the Users page.
  const [hiddenCustomKeys, setHiddenCustomKeys] = useDbPreference<string[]>(
    "apartments.customFieldsHidden", [],
  );
  // fixes35 §3: any non-select apartment custom field — same column-selector
  // treatment as the picklist ones above, in its own preference so existing
  // "apartments.customFieldFields" selections (picklist-only) are untouched.
  // fixes52 §2.6: same inclusion→exclusion-list flip as above.
  const customFieldDefs = useCustomFieldDefs("apartment").filter((d) => d.field_type !== "select");
  const [hiddenCustomFieldKeys, setHiddenCustomFieldKeys] = useDbPreference<string[]>(
    "apartments.customFieldFieldsHidden", [],
  );
  // fixes52 §2.2: one filter per non-select apartment custom field — boolean
  // fields store "true"/"false"/"" (unset), text/number/date store a free-
  // text "contains" query. Same shape as the Users page's shliachFieldFilters
  // (fixes48 §3), but resolved server-side here since this list is paginated.
  const [customFieldFilters, setCustomFieldFilters] = usePersistentState<
    Record<string, string>
  >("crm.apartments.customFieldFilters", {});
  const [debouncedCustomFieldFilters, setDebouncedCustomFieldFilters] =
    useState(customFieldFilters);
  const [query, setQuery] = usePersistentState("crm.apartments.q", "");
  // fixes53 §2: the mandatory canonical default — Report Number → Building →
  // Floor. A user who already customized their sort (persisted under this
  // key from before this round) keeps their own choice; only fresh state
  // gets the new default.
  const [sort, setSort] = usePersistentState<SortKey>("crm.apartments.sort", "hierarchy");
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
  // fixes30 §1a / fixes53 §2: group the table by building; the sort is
  // forced to "building" while active. The backend paginates by building in
  // this mode (page_size = buildings per page) so a building's apartments
  // are never split across pages — every group renders in full and its
  // header count is just the rendered row count, never a separate fetch
  // that could disagree with what's on screen (fixes53's reported bug).
  // fixes53 §2 also drops the old +/- per-group collapse toggle.
  const [groupByBuilding, setGroupByBuilding] = usePersistentState(
    "crm.apartments.groupByBuilding", false,
  );
  // Distinct buildings matching the current filters — only meaningful while
  // groupByBuilding is on; drives the building-based pager in that mode.
  const [totalBuildings, setTotalBuildings] = useState(0);
  // fixes32 §6: the whole filter section can be tucked away, mirroring the
  // Contacts page (fixes29 §1) — hidden filters keep applying to the list.
  const [filtersOpen, setFiltersOpen] = usePersistentState(
    "crm.apartments.filtersOpen", true,
  );
  const [fieldsOpen, setFieldsOpen] = useState(false);
  // fixes39: SortableJS-backed reorder, mobile-first (native HTML5
  // drag-and-drop never engages on many Windows trackpads — see
  // useSortableList's doc comment).
  const { containerRef: fieldsSortableRef, withClickGuard } =
    useSortableList<HTMLDivElement>(reorderFields);
  const [debouncedQ, setDebouncedQ] = useState(query);
  const [batchOpen, setBatchOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [busy, setBusy] = useState(true);
  // A failed list fetch (network blip, cold-start timeout, etc.) used to
  // silently render the same "no apartments" empty state as a genuinely
  // empty result, so a transient error looked exactly like "you have zero
  // apartments" with nothing to retry. Track it separately so the grid can
  // tell the two apart.
  const [loadError, setLoadError] = useState(false);
  const { error: toastError } = useToast();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const language = usePicklist("apartment.language");
  const jewish = usePicklist("apartment.Jewish_status");
  const campaign = usePicklist("apartment.campaign_status");
  const mezuzah = usePicklist("apartment.mezuzah_status");
  // fixes32 §6: options for every dynamic apartment.* picklist at once.
  const customPicklists = usePicklistsMap(customDefs.map((d) => d.field_key));
  // fixes57 §2: shared "-" option offered on every filter whose underlying
  // value can genuinely be blank (not the building filter — building_id is
  // mandatory on every apartment). Selecting it means "match apartments with
  // no value at all for this field", ORed with any real values also checked.
  const emptyOptionLabel = t("filter.empty_option", "- (ריק)");

  // fixes33 §5.2: a field an admin hid org-wide can't be searched by even if
  // a stale value survives from before it was hidden — otherwise the list
  // silently narrows with no visible control explaining why.
  const effectiveReportNumberIds = fieldVisible("report_number") ? reportNumberIds : [];
  const effectiveJewishFilter = fieldVisible("jewish_status") ? jewishFilter : [];
  const effectiveMezuzahFilter = fieldVisible("mezuzah_status") ? mezuzahFilter : [];
  const effectiveLanguageFilter = fieldVisible("language") ? languageFilter : [];

  // fixes32 §6: the `picklist=field_key:value` params any dynamic apartment
  // picklist filter sends — shared by the list fetch and the aggregates fetch.
  // fixes33 §5.2: a custom picklist hidden org-wide is dropped here too.
  function appendCustomPicklistParams(params: URLSearchParams) {
    const visibleKeys = new Set(orgVisibleCustomDefs.map((d) => d.field_key));
    for (const [fieldKey, values] of Object.entries(customFilters)) {
      if (!visibleKeys.has(fieldKey)) continue;
      for (const v of values) params.append("picklist", `${fieldKey}:${v}`);
    }
  }

  // fixes33 §3.2/§5.2: the exact (visibility-aware) filter state driving the
  // current list — shared by the list fetch, the aggregates fetch and the
  // "create report from filtered results" deep link.
  function buildFilterParams(): URLSearchParams {
    const params = new URLSearchParams();
    areaIds.forEach((id) => params.append("area_ids", String(id)));
    buildingIds.forEach((id) => params.append("building_ids", String(id)));
    effectiveReportNumberIds.forEach((id) => params.append("report_number_ids", String(id)));
    effectiveJewishFilter.forEach((v) => params.append("jewish_status", v));
    effectiveMezuzahFilter.forEach((v) => params.append("mezuzah_status", v));
    effectiveLanguageFilter.forEach((v) => params.append("language", v));
    appendCustomPicklistParams(params);
    // fixes52 §2.2: dynamic custom (non-select) apartment field filters —
    // same "field_key:query" convention as the picklist ones above.
    // fixes33 §5.2-style guard: a field hidden org-wide never filters even
    // if a stale value survives from before it was hidden.
    const visibleFieldKeys = new Set(orgVisibleCustomFieldDefs.map((d) => d.field_key));
    for (const [fieldKey, val] of Object.entries(debouncedCustomFieldFilters)) {
      if (val && visibleFieldKeys.has(fieldKey)) {
        params.append("custom_field_filter", `${fieldKey}:${val}`);
      }
    }
    if (debouncedQ.trim()) params.set("q", debouncedQ.trim());
    return params;
  }

  function goToFilteredReport() {
    const params = buildFilterParams();
    // fixes33 §3.2: an explicit marker — when every filter is cleared
    // (viewing all apartments), the resulting query string would otherwise
    // be empty and indistinguishable from a plain, non-deep-linked visit to
    // the reports page.
    params.set("from", "apartments-filtered");
    router.push(`/dashboard/reports/create?${params.toString()}`);
  }

  async function reload() {
    const params = buildFilterParams();
    // fixes30 §1a: grouping needs building-contiguous rows.
    params.set("sort", groupByBuilding ? "building" : sort);
    params.set("dir", dir);
    params.set("page", String(page));
    params.set("page_size", String(pageSize));
    const res = await apiFetch<ApartmentPage>(`/api/apartments/list?${params}`);
    setItems(res.items);
    setTotal(res.total);
    setTotalBuildings(res.total_buildings ?? 0);
  }

  // fixes51 §4: an admin-configured default filter/column set for the
  // Shliach role's landing view — applied once, only when the shliach hasn't
  // already got their own persisted (non-empty) state. A shliach who
  // explicitly clears everything back to empty won't see it reapplied on a
  // later visit (there's no signal to distinguish "never touched" from
  // "cleared" once both look identical) — an accepted, minor edge case.
  const appliedShliachDefaults = useRef(false);
  useEffect(() => {
    if (appliedShliachDefaults.current || !isShliach || !shliachViewConfig) return;
    appliedShliachDefaults.current = true;
    const df = shliachViewConfig.default_filters;
    if (df) {
      if (areaIds.length === 0 && Array.isArray(df.area_ids) && df.area_ids.length) {
        setAreaIds(df.area_ids as number[]);
      }
      if (buildingIds.length === 0 && Array.isArray(df.building_ids) && df.building_ids.length) {
        setBuildingIds(df.building_ids as number[]);
      }
      if (jewishFilter.length === 0 && Array.isArray(df.jewish_status) && df.jewish_status.length) {
        setJewishFilter(df.jewish_status as string[]);
      }
      if (mezuzahFilter.length === 0 && Array.isArray(df.mezuzah_status) && df.mezuzah_status.length) {
        setMezuzahFilter(df.mezuzah_status as string[]);
      }
      if (languageFilter.length === 0 && Array.isArray(df.language) && df.language.length) {
        setLanguageFilter(df.language as string[]);
      }
    }
    if (
      shliachViewConfig.default_columns &&
      JSON.stringify(fields) === JSON.stringify(DEFAULT_FIELDS)
    ) {
      setFields(shliachViewConfig.default_columns as FieldKey[]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isShliach, shliachViewConfig]);

  // fixes53 §3: a deep link from the Report Numbers grid ("view its
  // apartments") — ?report_number_ids=<id> replaces whatever filters were
  // already persisted (matching what "create report from filtered results"
  // does in reverse) so the visitor lands on exactly that report number's
  // apartments, not a stale mix of their own last filters plus this one.
  const appliedReportNumberDeepLink = useRef(false);
  useEffect(() => {
    if (appliedReportNumberDeepLink.current || loading) return;
    const raw = searchParams.getAll("report_number_ids");
    if (raw.length === 0) return;
    appliedReportNumberDeepLink.current = true;
    const ids = raw.map(Number).filter((n) => !Number.isNaN(n));
    if (ids.length === 0) return;
    clearAllFilters();
    setReportNumberIds(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, searchParams]);

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
    // fixes32 §6 / fixes37: any admin-added apartment picklist beyond the
    // fixed 4 — entity_type is real data now, not a prefix guess.
    apiFetch<PicklistField[]>("/api/picklists")
      .then((defs) =>
        setCustomDefs(
          defs.filter(
            (d) =>
              d.entity_type === "apartment" &&
              !FIXED_APARTMENT_PICKLIST_KEYS.includes(d.field_key),
          ),
        ),
      )
      .catch(() => setCustomDefs([]));
  }, [loading]);

  // One server-side page per filter/sort/page change.
  useEffect(() => {
    if (loading) return;
    setBusy(true);
    reload()
      .then(() => setLoadError(false))
      .catch(() => {
        setItems([]);
        setTotal(0);
        setLoadError(true);
        toastError(t("apt.load_failed", "טעינת הדירות נכשלה. נסה שוב."));
      })
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    loading, areaIds, buildingIds, reportNumberIds, jewishFilter, mezuzahFilter,
    languageFilter, customFilters, debouncedCustomFieldFilters, debouncedQ,
    sort, dir, page, pageSize, groupByBuilding,
  ]);

  // Debounced dynamic search (street name / label / resident).
  function onQueryChange(v: string) {
    setQuery(v);
    setPage(1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQ(v), 300);
  }

  // fixes52 §2.2: debounced custom-field text filters — same 300ms pattern
  // as the free-text street search above, one shared timer for the whole
  // filters object (a per-keystroke request per field would be excessive).
  const customFieldFilterDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onCustomFieldFilterChange(fieldKey: string, value: string) {
    setCustomFieldFilters((prev) => ({ ...prev, [fieldKey]: value }));
    setPage(1);
    if (customFieldFilterDebounceRef.current) {
      clearTimeout(customFieldFilterDebounceRef.current);
    }
    customFieldFilterDebounceRef.current = setTimeout(() => {
      setDebouncedCustomFieldFilters((prev) => ({ ...prev, [fieldKey]: value }));
    }, 300);
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
    // fixes57 §2: 0 is the "-" (no area assigned) sentinel.
    if (buildingIds.length > 0 && ids.length > 0) {
      const kept = buildingIds.filter((id) =>
        buildings.some(
          (b) =>
            b.id === id &&
            ((ids.includes(0) && b.area_id == null) ||
              (b.area_id != null && ids.includes(b.area_id))),
        ),
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

  // fixes32 §6: active-filter badge + one-click reset, mirroring Contacts
  // (fixes29 §1) — shown even while the filter section is collapsed.
  // fixes33 §5.2: a field hidden org-wide doesn't count toward this even if a
  // stale filter value survives from before it was hidden.
  const customFilterCount = Object.entries(customFilters).reduce(
    (sum, [fieldKey, vals]) => sum + (vis(fieldKey) ? vals.length : 0), 0,
  );
  // fixes52 §2.2: same org-visibility-guarded count for custom field filters.
  const customFieldFilterCount = Object.entries(customFieldFilters).reduce(
    (sum, [fieldKey, val]) =>
      sum + (val && vis(`customfield.apartment.${fieldKey}`) ? 1 : 0), 0,
  );
  const activeFilterCount =
    areaIds.length +
    buildingIds.length +
    effectiveReportNumberIds.length +
    effectiveJewishFilter.length +
    effectiveMezuzahFilter.length +
    effectiveLanguageFilter.length +
    customFilterCount +
    customFieldFilterCount +
    (query.trim() ? 1 : 0);

  function clearAllFilters() {
    setAreaIds([]);
    setBuildingIds([]);
    setReportNumberIds([]);
    setJewishFilter([]);
    setMezuzahFilter([]);
    setLanguageFilter([]);
    setCustomFilters({});
    setCustomFieldFilters({});
    setDebouncedCustomFieldFilters({});
    setQuery("");
    setDebouncedQ("");
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

  // fixes54 §1.1: clicking a sortable column header — toggles direction if
  // it's already the active key, else switches to it (ascending). No-op
  // while grouped by building, since that mode forces sort="building"
  // server-side (the select above is disabled there too).
  function onHeaderSortClick(key: SortKey) {
    if (groupByBuilding) return;
    if (sort === key) onDirToggle();
    else onSortChange(key);
  }
  // A real production complaint traced back here: only the *active* sort
  // column ever showed an arrow, so every other sortable header looked like
  // plain non-interactive text with no hint it's clickable. Every sortable
  // header now always carries an indicator — dim "⇅" when inactive, a solid
  // ↑/↓ when it's the active key (hidden entirely while grouped, since the
  // headers aren't clickable in that mode).
  function sortArrow(key: SortKey): ReactNode {
    if (groupByBuilding) return null;
    const active = sort === key;
    return (
      <span className={active ? "text-foreground" : "text-muted-foreground"}>
        {" "}
        {active ? (dir === "asc" ? "↑" : "↓") : "⇅"}
      </span>
    );
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

  // fixes39 §3: SortableJS's container holds every chip (active + inactive
  // — an inactive one can't be dragged, per useSortableList's `filter`, but
  // a dragged active chip can still land next to/among them), so rather
  // than translate a single from/to index pair against two different lists,
  // just recompute the active order from the container's resulting DOM
  // order directly: keep whichever of `orderedKeys` are currently active,
  // in their new relative order.
  function reorderFields(orderedKeys: string[]) {
    setFields((prev) => {
      const activeSet = new Set(
        prev.filter((k): k is FieldKey => (FIELD_KEYS as readonly string[]).includes(k)),
      );
      const reordered = orderedKeys.filter((k): k is FieldKey => activeSet.has(k as FieldKey));
      return reordered.length > 0 ? reordered : prev;
    });
  }

  // fixes38: guaranteed-reliable fallback for the pointer/drag reorder above
  // — a trackpad's drag gesture is ultimately at the mercy of the OS/driver
  // ever reporting a sustained press-and-move, which nothing in-app can force
  // 100% of the time. These buttons swap adjacent active fields directly, the
  // same one-step arrow-button pattern the contact page's Display Order
  // settings already use (moveSegment) — no gesture involved at all.
  function moveActiveField(key: FieldKey, delta: -1 | 1) {
    setFields((prev) => {
      const known = prev.filter((k): k is FieldKey =>
        (FIELD_KEYS as readonly string[]).includes(k),
      );
      const idx = known.indexOf(key);
      const to = idx + delta;
      if (idx === -1 || to < 0 || to >= known.length) return prev;
      const next = [...known];
      [next[idx], next[to]] = [next[to], next[idx]];
      return next;
    });
  }

  // fixes30 §1c / fixes32 §6: one-field inline save from the list. The PUT is
  // a fixes19 §3 versioned edit returning a NEW active row — merge the full
  // response into the row in place (id + every Apartment field, including the
  // resolved picklist_values) so the page, scroll and filters all stay put.
  async function saveListField(a: ApartmentListItem, body: Record<string, unknown>) {
    const saved = await apiFetch<Apartment>(`/api/apartments/${a.id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    setItems((prev) => prev.map((it) => (it.id === a.id ? { ...it, ...saved } : it)));
  }

  const inlinePicklistCell = (
    a: ApartmentListItem,
    field: "jewish_status" | "campaign_status" | "mezuzah_status",
    picklistKey: string,
    label: string | null | undefined,
  ) => (
    <InlineEdit<string | null>
      value={a[field] ?? null}
      display={<TruncatedText text={label || "—"} />}
      commitOnBlur={false}
      disabled={fieldEditLocked(field)}
      onSave={(v) => saveListField(a, { [field]: v })}
      editor={(draft, _setDraft, commit) => (
        <PicklistSelect fieldKey={picklistKey} value={draft} onChange={commit} />
      )}
    />
  );

  // fixes54 §3: report_number_id is a real, directly-settable Apartment
  // column (ApartmentEditor's own form already edits it via this exact
  // SearchableSelect) — it just had no inline-grid editor, unlike every
  // other plain field on this row.
  const inlineReportNumberCell = (a: ApartmentListItem) => (
    <InlineEdit<number | null>
      value={a.report_number_id ?? null}
      display={<TruncatedText text={a.report_number_name ?? "—"} />}
      commitOnBlur={false}
      disabled={fieldEditLocked("report_number")}
      onSave={(v) => saveListField(a, { report_number_id: v })}
      editor={(draft, _setDraft, commit) => (
        <SearchableSelect
          value={draft}
          onChange={commit}
          options={reportNumbers.map((rn) => ({ id: rn.id, label: rn.name }))}
          placeholder={t("apt.choose_report_number", "בחר מספר דוח…")}
        />
      )}
    />
  );

  // fixes51 §2.2: apartment.language is multi-select — same explicit-apply
  // pattern as ContactView's area/report-number multi-selects (a raw
  // mousedown listener inside MultiSelectFilter closes its own dropdown
  // before InlineEdit's onBlur would ever fire).
  const inlineLanguageCell = (a: ApartmentListItem) => (
    <InlineEdit<string[]>
      value={a.language}
      display={
        <TruncatedText
          text={a.language.map((v) => language.labelFor(v)).join(", ") || "—"}
        />
      }
      commitOnBlur={false}
      disabled={fieldEditLocked("language")}
      onSave={(vals) => saveListField(a, { language: vals })}
      editor={(draft, setDraft, commit) => (
        <MultiSelectEditor onApply={() => commit(draft)}>
          <MultiSelectFilter
            allLabel={t("filter.all_languages", "כל השפות")}
            options={language.options.map((o) => ({ id: o.value, label: language.display(o) }))}
            value={draft}
            onChange={setDraft}
          />
        </MultiSelectEditor>
      )}
    />
  );

  // fixes32 §6: plain-text inline edit for comments/email/phone.
  // fixes54 §6: maps each model column to its FIELD_KEYS/Edit Lock name.
  const TEXT_FIELD_LOCK_KEY: Record<"apartment_notes" | "email" | "phone" | "name", FieldKey> = {
    apartment_notes: "notes",
    email: "email",
    phone: "phone",
    name: "resident",
  };
  const inlineTextCell = (
    a: ApartmentListItem,
    field: "apartment_notes" | "email" | "phone" | "name",
    opts: { dir?: "ltr"; multiline?: boolean; validate?: (v: string) => string | null } = {},
  ) => (
    <InlineEdit<string>
      value={(a[field] as string | null) ?? ""}
      display={
        a[field] ? (
          <span dir={opts.dir}>
            <TruncatedText text={a[field] as string} />
          </span>
        ) : (
          "—"
        )
      }
      validate={opts.validate}
      enterCommits={!opts.multiline}
      disabled={fieldEditLocked(TEXT_FIELD_LOCK_KEY[field])}
      onSave={(v) => saveListField(a, { [field]: v.trim() || null })}
      editor={(draft, setDraft) =>
        opts.multiline ? (
          <textarea
            className={`${inputClass} w-full`}
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        ) : (
          <input
            className={inputClass}
            dir={opts.dir}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        )
      }
    />
  );

  // fixes49 §1: per-column min-width so short values (dates, badges) don't
  // get squeezed in the RTL grid — free-text-prone columns get the wider floor.
  const WIDE_FIELD_KEYS = new Set<FieldKey>(["resident", "building", "area", "notes"]);
  const fieldMinWidth = (k: FieldKey) =>
    WIDE_FIELD_KEYS.has(k) ? "min-w-[150px]" : "min-w-[120px]";
  // fixes52 §2.5: the sticky first column pins to the side the table's own
  // text starts from — right in RTL (Hebrew), left in LTR (English).
  const firstColStickySide = lang === "en" ? "left-0" : "right-0";

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
  // fixes32 §6: a dynamic apartment.* definition's display name in the
  // current language (mirrors the Picklists dashboard's defLabel).
  const customDefLabel = (d: PicklistField) =>
    (lang === "en" ? d.english_label || d.label : d.label) || d.field_key;
  // fixes33 §5.2: custom picklists an admin hid org-wide (Manage Fields)
  // never reach the filter row or the column-selector panel at all.
  const orgVisibleCustomDefs = customDefs.filter((d) => vis(d.field_key));
  // fixes33 §3.1 / fixes52 §2.6: the subset of (org-visible) custom
  // picklists the personal column-selector panel hasn't hidden — a field
  // missing from `hiddenCustomKeys` is visible, including one created just
  // now, with no reload needed.
  const visibleCustomDefs = orgVisibleCustomDefs.filter(
    (d) => !hiddenCustomKeys.includes(d.field_key),
  );
  function toggleCustomField(fieldKey: string) {
    setHiddenCustomKeys((prev) =>
      prev.includes(fieldKey)
        ? prev.filter((k) => k !== fieldKey)
        : [...prev, fieldKey],
    );
  }
  // fixes35 §3: same org-visibility + personal column-selector treatment for
  // non-select apartment custom fields.
  const orgVisibleCustomFieldDefs = customFieldDefs.filter((d) =>
    vis(`customfield.apartment.${d.field_key}`),
  );
  const visibleCustomFieldDefs = orgVisibleCustomFieldDefs.filter(
    (d) => !hiddenCustomFieldKeys.includes(d.field_key),
  );
  function toggleCustomFieldColumn(fieldKey: string) {
    setHiddenCustomFieldKeys((prev) =>
      prev.includes(fieldKey)
        ? prev.filter((k) => k !== fieldKey)
        : [...prev, fieldKey],
    );
  }
  // fixes32 §6: the stored array's own order is now the display order — drag-
  // reordering the chips below persists it. (Previously this always rendered
  // in the fixed FIELD_KEYS order regardless of the stored array's order.)
  // Unknown stored keys (older versions used e.g. "location") are dropped.
  const activeFields = fields.filter((k): k is FieldKey =>
    (FIELD_KEYS as readonly string[]).includes(k),
  );
  // fixes33 §5.2: what actually renders as a table column — active minus
  // anything an admin hid org-wide. `activeFields` itself (the stored
  // preference) is left untouched so it reappears if unhidden later.
  const renderedFields = activeFields.filter(fieldVisible);

  function cell(a: ApartmentListItem, k: FieldKey) {
    switch (k) {
      // fixes54 §3: was plain read-only text — no InlineEdit wrapper at all,
      // so clicking it never opened an editor (unlike notes/phone/email
      // right below, which already used inlineTextCell).
      case "resident":
        return inlineTextCell(a, "name");
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
              className="text-primary hover:underline"
            >
              📍 <TruncatedText text={name} />
            </a>
          );
        }
        return <TruncatedText text={name} />;
      }
      case "area":
        return <TruncatedText text={a.area_name ?? "—"} />;
      case "report_number":
        return inlineReportNumberCell(a);
      // fixes32 §6: notes/email/phone edit in place, straight from the list row.
      case "notes":
        return inlineTextCell(a, "apartment_notes", { multiline: true });
      case "phone":
        return inlineTextCell(a, "phone", {
          dir: "ltr",
          validate: (v) =>
            v.trim() === "" || isValidPhone(v.trim())
              ? null
              : t("validation.phone_hint", PHONE_HINT),
        });
      case "email":
        return inlineTextCell(a, "email", {
          dir: "ltr",
          validate: (v) =>
            v.trim() === "" || isValidEmail(v.trim())
              ? null
              : t("validation.email_hint", EMAIL_HINT),
        });
      case "language":
        return inlineLanguageCell(a);
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
      (areaIds.length === 0 ||
        // fixes57 §2: 0 is the "-" (no area assigned) sentinel.
        (areaIds.includes(0) && b.area_id == null) ||
        (b.area_id != null && areaIds.includes(b.area_id))) &&
      // fixes23 §2: when report numbers are selected, only buildings that hold a
      // matching apartment remain choosable.
      (buildingIdsForReports === null || buildingIdsForReports.has(b.id)),
  );

  // fixes53 §2: the backend now returns every apartment for each building on
  // the page in grouped mode (never a partial building), so the header
  // count is simply how many loaded rows share that building_id — no
  // separate aggregate fetch that could disagree with what's rendered.
  const buildingCounts = (() => {
    const counts = new Map<number, number>();
    if (groupByBuilding) {
      for (const a of items) counts.set(a.building_id, (counts.get(a.building_id) ?? 0) + 1);
    }
    return counts;
  })();

  // Title + optional data columns + custom-picklist columns + optional
  // contact column + trailing filler.
  const colCount =
    2 +
    renderedFields.length +
    visibleCustomDefs.length +
    visibleCustomFieldDefs.length +
    (showContact ? 1 : 0);

  // fixes53 §2: while grouped by building, the pager paginates buildings
  // (page_size = buildings per page), not apartment rows — `total` is still
  // the real apartment count (used elsewhere, e.g. the bulk-edit dialog),
  // so it can't drive `lastPage`/`rangeText` here without the last page
  // undercounting or truncating a building's rows mid-list.
  const pagerTotal = groupByBuilding ? totalBuildings : total;
  const lastPage = Math.max(1, Math.ceil(pagerTotal / pageSize));
  const rangeText = t(
    groupByBuilding ? "pager.range_buildings" : "pager.range",
    groupByBuilding ? "בניינים {from}–{to} מתוך {total}" : "{from}–{to} מתוך {total}",
  )
    .replace("{from}", String(pagerTotal === 0 ? 0 : (page - 1) * pageSize + 1))
    .replace("{to}", String(Math.min(page * pageSize, pagerTotal)))
    .replace("{total}", String(pagerTotal));
  // fixes52 §2.3: the custom-picklist/custom-field-filter "field_key:value"
  // params, computed once for the bulk-edit modal's filter payload below.
  const currentFilterParams = buildFilterParams();

  if (loading) return <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>;
  // fixes54 §8: the superadmin "Apartment display" toggle (cascades from
  // Area -> Building) — defense in depth alongside the now-gone nav link.
  if (!isFeatureEnabled(user?.organization, "apartment_display_enabled")) {
    return (
      <p className="text-status-darkred">
        {t("page.module_disabled", "התכונה הזו כבויה עבור הארגון שלך.")}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{t("apartments", "דירות")}</h1>
        {/* fixes52 §2.1: flex-wrap (was missing) + py-2 (was py-1.5) so this
            row folds instead of overflowing on mobile and matches the
            Contacts page's header button heights exactly. */}
        <div className="flex flex-wrap items-center gap-2">
          {/* fixes51 §4: an admin can hide the filter UI entirely for the
              Shliach role — a stronger, org-enforced version of the
              per-user filtersOpen collapse below. */}
          {!shliachFiltersHidden && (
            <>
              {/* fixes32 §6: always reachable while any filter narrows the
                  list — mirrors the Contacts page (fixes29 §1). */}
              {activeFilterCount > 0 && (
                <Button type="button" variant="outline" onClick={clearAllFilters}>
                  <X className="h-4 w-4" /> {t("filter.clear_all", "נקה את כל הסינונים")}
                </Button>
              )}
              <Button type="button" variant="outline" onClick={() => setFiltersOpen((v) => !v)}>
                <SlidersHorizontal className="h-4 w-4" />
                {filtersOpen ? t("filter.hide_filters", "הסתר סינון") : t("filter.show_filters", "הצג סינון")}
                {!filtersOpen && activeFilterCount > 0 && (
                  <span className="ms-1 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground text-xs px-1.5 py-0.5 leading-none">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
            </>
          )}
          {/* fixes38 §2.1: the columns toggle lives outside the filtersOpen
              block so collapsing filters never hides it. fixes54 §6: entirely
              hidden from activists when an admin locks it — the previously
              always-reachable "Customize fields" button an admin has no way
              to turn off. */}
          {!customizeFieldsLocked && (
            <Button type="button" variant="outline" onClick={() => setFieldsOpen((v) => !v)}>
              <Settings2 className="h-4 w-4" /> {t("columns.fields_configure", "התאמת שדות")}
            </Button>
          )}
          {!isShliach && (
            <>
              {!batchOpen && (
                <Button
                  type="button"
                  variant="outline"
                  className="border-primary text-primary hover:bg-primary/10"
                  onClick={() => setBatchOpen(true)}
                >
                  <Layers className="h-4 w-4" /> {t("batch.open", "יצירה מרובה")}
                </Button>
              )}
              {/* Dedicated add route (fixes12 §2.2). */}
              <Button asChild>
                <Link href="/dashboard/apartments/add">
                  <Plus className="h-4 w-4" /> {t("apt.add_apartment", "הוסף דירה")}
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* fixes38 §2.1: the columns panel is deliberately OUTSIDE the
          filtersOpen fragment below, so collapsing filters never hides it.
          fixes54 §6: also gated on customizeFieldsLocked — fieldsOpen is
          itself persisted, so a lock flipped on after an activist already had
          the panel open must still hide it, not just the toggle button. */}
      {fieldsOpen && !customizeFieldsLocked && (
        <div className="bg-card border border-border rounded-xl shadow-sm p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{t("columns.title", "עמודות מוצגות")}</h3>
            <button
              type="button"
              onClick={() => setFields(DEFAULT_FIELDS)}
              className="text-xs text-primary hover:underline"
            >
              {t("columns.reset", "איפוס ברירת מחדל")}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t(
              "columns.hint",
              "בחר אילו עמודות יוצגו בטבלה. ההעדפה נשמרת בדפדפן זה.",
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("columns.reorder_hint", "גרור עמודה פעילה כדי לשנות את סדר ההצגה.")}
          </p>
          {orgVisibleCustomDefs.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t(
                "columns.custom_picklists_hint",
                "עמודות רשימת בחירה מותאמות אישית — ניתן להסתיר כל אחת בנפרד.",
              )}
            </p>
          )}
          {/* fixes39 §3: one real SortableJS-managed container for every
              chip (mobile-first — see useSortableList's doc comment). Only
              the active-field chips are actually reorderable — every other
              chip here (inactive fields, custom-picklist/custom-field/
              linked-contact toggles) is marked `data-sortable-disabled` so
              it can't be dragged (its own click still works —
              `preventOnFilter: false`) but still occupies a normal slot so
              the active ones keep flowing in the same row. Active chips
              render FIRST, in their actual current (reordered) order.
              fixes33 §5.2: fields an admin hid org-wide aren't offered. */}
          <div ref={fieldsSortableRef} className="flex flex-wrap gap-2">
            {activeFields.filter(fieldVisible).map((k) => {
              const activeIdx = activeFields.indexOf(k);
              return (
                <span key={k} data-sort-key={k} className="inline-flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={withClickGuard(() => toggleField(k))}
                    className="rounded-md border px-3 py-1.5 text-sm border-primary bg-primary/10 text-primary cursor-grab active:cursor-grabbing"
                  >
                    ⠿ {fieldLabels[k]}
                  </button>
                  {/* fixes38: guaranteed-reliable fallback for dragging —
                      a click always works, unlike a drag gesture on some
                      trackpads. */}
                  <span className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      disabled={activeIdx === 0}
                      onClick={() => moveActiveField(k, -1)}
                      title={t("action.move_up", "העלה")}
                      className="flex items-center justify-center w-7 h-7 rounded text-sm leading-none text-muted-foreground hover:text-primary hover:bg-accent active:bg-muted disabled:opacity-20"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      disabled={activeIdx === activeFields.length - 1}
                      onClick={() => moveActiveField(k, 1)}
                      title={t("action.move_down", "הורד")}
                      className="flex items-center justify-center w-7 h-7 rounded text-sm leading-none text-muted-foreground hover:text-primary hover:bg-accent active:bg-muted disabled:opacity-20"
                    >
                      ▼
                    </button>
                  </span>
                </span>
              );
            })}
            {FIELD_KEYS.filter((k) => !activeFields.includes(k) && fieldVisible(k)).map(
              (k) => (
                <button
                  key={k}
                  type="button"
                  data-sort-key={k}
                  data-sortable-disabled=""
                  onClick={() => toggleField(k)}
                  className="rounded-md border px-3 py-1.5 text-sm border-border text-muted-foreground hover:bg-accent"
                >
                  {fieldLabels[k]}
                </button>
              ),
            )}
            {/* fixes33 §3.1: one show/hide toggle per admin-added apartment.*
                picklist — a personal preference, separate from whether the
                field is hidden org-wide (Manage Fields, fixes33 §5.2). */}
            {orgVisibleCustomDefs.map((d) => {
              const active = !hiddenCustomKeys.includes(d.field_key);
              return (
                <button
                  key={d.field_key}
                  type="button"
                  data-sortable-disabled=""
                  onClick={() => toggleCustomField(d.field_key)}
                  className={`rounded-md border px-3 py-1.5 text-sm ${
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {active ? "✓ " : ""}
                  {customDefLabel(d)}
                </button>
              );
            })}
            {/* fixes35 §3: one show/hide toggle per admin-added non-select
                apartment custom field. */}
            {orgVisibleCustomFieldDefs.map((d) => {
              const active = !hiddenCustomFieldKeys.includes(d.field_key);
              return (
                <button
                  key={d.field_key}
                  type="button"
                  data-sortable-disabled=""
                  onClick={() => toggleCustomFieldColumn(d.field_key)}
                  className={`rounded-md border px-3 py-1.5 text-sm ${
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {active ? "✓ " : ""}
                  {(lang === "en" ? d.english_label || d.hebrew_label : d.hebrew_label) ||
                    d.field_key}
                </button>
              );
            })}
            {/* fixes30 §1b: the linked-contact column, previously always on. */}
            <button
              type="button"
              data-sortable-disabled=""
              onClick={() => setShowContact(!showContact)}
              className={`rounded-md border px-3 py-1.5 text-sm ${
                showContact
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-accent"
              }`}
            >
              {showContact ? "✓ " : ""}
              {t("apartments.contact", "איש קשר")}
            </button>
          </div>
        </div>
      )}

      {/* fixes32 §6: both filter rows unmount while the toggle is off; the
          persisted filter state is untouched, so it keeps filtering the list
          — the exact fixes29 §1 pattern from the Contacts page. */}
      {filtersOpen && !shliachFiltersHidden && (<>
      {/* Dataset filters (fixes8 §2): multi-area (fixes15 §7.1) + building
          bounds, street lookup. */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">{t("filter.by_area", "סנן לפי אזור:")}</span>
        <MultiSelectFilter
          allLabel={t("filter.all_areas", "כל האזורים")}
          label={t("buildings.area_id", "אזור")}
          options={[
            { id: 0, label: emptyOptionLabel },
            ...areas.map((a) => ({ id: a.id, label: a.area_name })),
          ]}
          value={areaIds}
          onChange={onAreasChange}
        />
        {/* fixes23 §2: multi-select searchable building filter. No "-" empty
            option here — building_id is mandatory on every apartment. */}
        <MultiSelectSearchFilter
          className="w-56"
          allLabel={t("filter.all_buildings", "כל הבניינים")}
          label={t("apartments.building_id", "בניין")}
          options={visibleBuildings.map((b) => ({
            id: b.id,
            label: buildingDisplayName(b),
          }))}
          value={buildingIds}
          onChange={onBuildingsChange}
          searchPlaceholder={t("filter.search_buildings", "חיפוש בניין…")}
        />
        {/* fixes23 §2: multi-select searchable report-number filter.
            fixes33 §5.2: hidden org-wide → no filter control either. */}
        {reportNumbers.length > 0 && fieldVisible("report_number") && (
          <MultiSelectSearchFilter
            className="w-48"
            allLabel={t("filter.all_report_numbers", "כל מספרי הדוח")}
            label={t("apartments.report_number_id", "מספר דוח")}
            options={[
              { id: 0, label: emptyOptionLabel },
              ...reportNumbers.map((rn) => ({ id: rn.id, label: rn.name })),
            ]}
            value={reportNumberIds}
            onChange={onReportNumbersChange}
            searchPlaceholder={t("filter.search_report_numbers", "חיפוש מספר דוח…")}
          />
        )}
        {/* fixes18 §5.2: Jewish-status + mezuzah picklist filters
            (fixes33 §5.2: gated on the field not being hidden org-wide). */}
        {fieldVisible("jewish_status") && (
          <MultiSelectFilter
            allLabel={t("filter.all_jewish", "כל סטטוסי היהדות")}
            label={t("picklist.apartment.Jewish_status", "יהדות")}
            options={[
              { id: EMPTY_FIELD_SENTINEL, label: emptyOptionLabel },
              ...jewish.options.map((o) => ({ id: o.value, label: jewish.display(o) })),
            ]}
            value={jewishFilter}
            onChange={(vals) => {
              setJewishFilter(vals);
              setPage(1);
            }}
          />
        )}
        {fieldVisible("mezuzah_status") && (
          <MultiSelectFilter
            allLabel={t("filter.all_mezuzah", "כל סטטוסי המזוזה")}
            label={t("picklist.apartment.mezuzah_status", "מזוזה")}
            options={[
              { id: EMPTY_FIELD_SENTINEL, label: emptyOptionLabel },
              ...mezuzah.options.map((o) => ({ id: o.value, label: mezuzah.display(o) })),
            ]}
            value={mezuzahFilter}
            onChange={(vals) => {
              setMezuzahFilter(vals);
              setPage(1);
            }}
          />
        )}
        {/* fixes32 §6: language filter. */}
        {fieldVisible("language") && (
        <MultiSelectFilter
          allLabel={t("filter.all_languages", "כל השפות")}
          label={t("picklist.apartment.language", "שפה")}
          options={[
            { id: EMPTY_FIELD_SENTINEL, label: emptyOptionLabel },
            ...language.options.map((o) => ({ id: o.value, label: language.display(o) })),
          ]}
          value={languageFilter}
          onChange={(vals) => {
            setLanguageFilter(vals);
            setPage(1);
          }}
        />
        )}
        {/* fixes32 §6: one filter per admin-added apartment.* picklist
            (fixes33 §5.2: org-hidden ones are excluded). */}
        {orgVisibleCustomDefs.map((d) => {
          const opts = customPicklists.map[d.field_key] ?? [];
          return (
            <MultiSelectFilter
              key={d.field_key}
              allLabel={customDefLabel(d)}
              label={customDefLabel(d)}
              options={[
                { id: EMPTY_FIELD_SENTINEL, label: emptyOptionLabel },
                ...opts.map((o) => ({ id: o.value, label: customPicklists.display(o) })),
              ]}
              value={customFilters[d.field_key] ?? []}
              onChange={(vals) => {
                setCustomFilters((prev) => ({ ...prev, [d.field_key]: vals }));
                setPage(1);
              }}
            />
          );
        })}
        {/* fixes52 §2.2: one filter per admin-added, non-select apartment
            custom field — boolean fields get a 3-state select, everything
            else a "contains" text input. */}
        {orgVisibleCustomFieldDefs.map((d) => {
          const label =
            (lang === "en" ? d.english_label || d.hebrew_label : d.hebrew_label) ||
            d.field_key;
          if (d.field_type === "boolean") {
            return (
              <select
                key={d.field_key}
                className={inputClass}
                value={customFieldFilters[d.field_key] ?? ""}
                onChange={(e) => onCustomFieldFilterChange(d.field_key, e.target.value)}
              >
                <option value="">{label}</option>
                <option value="true">{t("filter.yes", "כן")}</option>
                <option value="false">{t("filter.no", "לא")}</option>
              </select>
            );
          }
          // fixes53 §2: an "Empty" toggle alongside the free-text search —
          // Excel-style blank selection. Checking it sends the sentinel
          // instead of typed text and disables the input (they're mutually
          // exclusive: you're either searching text or matching blanks).
          const isEmptyFilter = customFieldFilters[d.field_key] === EMPTY_FIELD_SENTINEL;
          return (
            <div key={d.field_key} className="flex items-center gap-1">
              <input
                className={`${inputClass} min-w-[10rem]`}
                placeholder={label}
                disabled={isEmptyFilter}
                value={isEmptyFilter ? "" : customFieldFilters[d.field_key] ?? ""}
                onChange={(e) => onCustomFieldFilterChange(d.field_key, e.target.value)}
              />
              <label
                className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer whitespace-nowrap"
                title={t("filter.empty_hint", "הצג רק דירות ללא ערך בשדה זה")}
              >
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={isEmptyFilter}
                  onChange={(e) =>
                    onCustomFieldFilterChange(
                      d.field_key,
                      e.target.checked ? EMPTY_FIELD_SENTINEL : "",
                    )
                  }
                />
                {t("filter.empty", "ריק")}
              </label>
            </div>
          );
        })}
        <input
          className={`${inputClass} flex-1 min-w-[12rem]`}
          placeholder={t("apt.street_search", "חיפוש לפי שם רחוב…")}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
      </div>

      {/* Sorting (fixes8 §1C) + field config (fixes15 §7.2) + page size. */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">{t("sort.label", "מיון:")}</span>
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
          {/* fixes53 §2: the mandatory default — Report Number → Building →
              Floor (floor's own "L"-first order is unchanged) — always
              ascending, hence no dir toggle for it below. */}
          <option value="hierarchy">
            {t("sort.hierarchy", "היררכיה (מס׳ דוח ← בניין ← קומה)")}
          </option>
          <option value="floor">{t("sort.floor", "קומה")}</option>
          <option value="label">{t("sort.by_label", "תווית דירה")}</option>
          <option value="resident">{t("sort.resident", "שם דייר")}</option>
          <option value="building">{t("sort.building", "בניין")}</option>
          {/* fixes17 §3.2: chronological sorting. */}
          <option value="created">{t("sort.created", "תאריך יצירה")}</option>
        </select>
        {!groupByBuilding && sort === "hierarchy" ? (
          <span
            className="rounded-md border border-border px-3 py-2 text-muted-foreground"
            title={t("apt.hierarchy_sort_hint", "מיון היררכיה תמיד עולה")}
          >
            ↑ {t("sort.asc", "עולה")}
          </span>
        ) : (
          <button
            type="button"
            onClick={onDirToggle}
            className="rounded-md border border-input px-3 py-2 hover:bg-accent"
            title={dir === "asc" ? t("sort.asc", "עולה") : t("sort.desc", "יורד")}
          >
            {dir === "asc" ? "↑" : "↓"} {dir === "asc" ? t("sort.asc", "עולה") : t("sort.desc", "יורד")}
          </button>
        )}
        {/* fixes30 §1a: aggregate the rows under per-building headers. */}
        <button
          type="button"
          onClick={() => setGroupByBuilding(!groupByBuilding)}
          className={`rounded-md border px-3 py-2 ${
            groupByBuilding
              ? "border-primary bg-primary/10 text-primary"
              : "border-input hover:bg-accent"
          }`}
        >
          {groupByBuilding ? "✓ " : ""}
          {t("apt.group_by_building", "קיבוץ לפי בניין")}
        </button>
        {/* fixes23 §3: bulk edit the apartments matching the active filters —
            enabled only while there are matching rows to change. */}
        {!isShliach && (
          <button
            type="button"
            onClick={() => setBulkOpen(true)}
            disabled={busy || total === 0}
            className="rounded-md border border-primary text-primary px-3 py-2 font-medium hover:bg-primary/10 disabled:opacity-40 disabled:cursor-not-allowed"
            title={t("bulkedit.open_hint", "עריכה מרובה של כל הדירות המסוננות")}
          >
            ✎ {t("bulkedit.open", "עריכה מרובה")}
          </button>
        )}
        {/* fixes33 §3.2: hands the current filter state to the reports page. */}
        <button
          type="button"
          onClick={goToFilteredReport}
          disabled={total === 0}
          className="rounded-md border border-primary text-primary px-3 py-2 font-medium hover:bg-primary/10 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          📄 {t("apt.create_report_from_filters", "צור דוח מהתוצאות המסוננות")}
        </button>
        <span className="ms-auto text-muted-foreground">{t("pager.page_size", "בעמוד:")}</span>
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

      </>)}

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
          customDefs={orgVisibleCustomDefs}
          customFieldDefs={orgVisibleCustomFieldDefs}
          // fixes52 §2.3: the full active filter set (was a 6-of-9 subset —
          // bulk-edit now touches exactly the rows the grid shows, including
          // campaign_status/language/custom-picklist/custom-field filters).
          filters={{
            building_ids: buildingIds,
            area_ids: areaIds,
            report_number_ids: effectiveReportNumberIds,
            jewish_status: effectiveJewishFilter,
            mezuzah_status: effectiveMezuzahFilter,
            language: effectiveLanguageFilter,
            picklist: currentFilterParams.getAll("picklist"),
            custom_field_filter: currentFilterParams.getAll("custom_field_filter"),
            q: debouncedQ.trim() || undefined,
          }}
          onClose={() => setBulkOpen(false)}
          onDone={async () => {
            setBulkOpen(false);
            await reload();
          }}
        />
      )}

      {/* fixes17 §3.1: a real table — every column carries its field's title.
          fixes52 §2.5 / fixes54 §1.4: sticky header row + sticky first
          column, RTL/LTR-aware — the wrapper needs its own bounded scroll
          frame (max-h + overflow-y-auto) for `sticky top-0` to actually
          engage; an `overflow-x-auto`-only div never scrolls vertically
          itself, so a sticky child inside it just scrolls away with the page
          instead of sticking. */}
      <div className="bg-card border border-border rounded-xl shadow-sm overflow-x-auto overflow-y-auto max-h-[75vh]">
        <table className="w-full text-sm">
          <thead className="bg-background text-muted-foreground text-right">
            <tr>
              {/* The corner cell needs both stickiness axes, so it sits above
                  the plain header row (z-20 vs. z-10) at their intersection.
                  fixes54 §1.1: clickable sort-arrow header (mirrors Report
                  Numbers), inert while grouped by building. */}
              <th
                onClick={groupByBuilding ? undefined : () => onHeaderSortClick("label")}
                className={`px-3 py-1.5 font-medium w-px whitespace-nowrap min-w-[150px] sticky top-0 z-20 bg-background ${firstColStickySide} ${
                  groupByBuilding ? "" : "cursor-pointer select-none hover:bg-accent"
                }`}
              >
                {t("apartments.apartment_name", "מספר דירה")}
                {sortArrow("label")}
              </th>
              {/* fixes49 §1: each column carries a data-type-dependent
                  min-width floor so RTL headers don't squeeze. fixes54 §1.1:
                  sortable columns (FIELD_SORT_KEYS) get a click handler +
                  arrow; the rest (picklist-backed / dynamic) render plain. */}
              {renderedFields.map((k) => {
                const sortKeyForField = FIELD_SORT_KEYS[k];
                const sortable = sortKeyForField && !groupByBuilding;
                return (
                  <th
                    key={k}
                    onClick={sortable ? () => onHeaderSortClick(sortKeyForField!) : undefined}
                    className={`px-3 py-1.5 font-medium w-px whitespace-nowrap sticky top-0 z-10 bg-background ${fieldMinWidth(k)} ${
                      sortable ? "cursor-pointer select-none hover:bg-accent" : ""
                    }`}
                  >
                    {fieldLabels[k]}
                    {sortKeyForField ? sortArrow(sortKeyForField) : ""}
                  </th>
                );
              })}
              {/* fixes32 §6 / fixes33 §3.1: one column per admin-added
                  apartment.* picklist the column-selector panel has left on. */}
              {visibleCustomDefs.map((d) => (
                <th
                  key={d.field_key}
                  className="px-3 py-1.5 font-medium w-px whitespace-nowrap min-w-[120px] sticky top-0 z-10 bg-background"
                >
                  {customDefLabel(d)}
                </th>
              ))}
              {/* fixes35 §3: one column per non-select apartment custom field
                  the column-selector panel has left on. */}
              {visibleCustomFieldDefs.map((d) => (
                <th
                  key={d.field_key}
                  className={`px-3 py-1.5 font-medium w-px whitespace-nowrap sticky top-0 z-10 bg-background ${
                    d.field_type === "text" ? "min-w-[150px]" : "min-w-[120px]"
                  }`}
                >
                  {(lang === "en" ? d.english_label || d.hebrew_label : d.hebrew_label) ||
                    d.field_key}
                </th>
              ))}
              {/* fixes30 §1b: toggleable via the fields panel. */}
              {showContact && (
                <th className="px-3 py-1.5 font-medium w-px whitespace-nowrap sticky top-0 z-10 bg-background">
                  {t("apartments.contact", "איש קשר")}
                </th>
              )}
              <th className="w-full sticky top-0 z-10 bg-background"></th>
            </tr>
          </thead>
          <tbody>
            {busy ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-10 text-center">
                  <div className="mx-auto h-6 w-6 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
                </td>
              </tr>
            ) : loadError ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-6 text-center text-status-darkred">
                  <p>{t("apt.load_failed", "טעינת הדירות נכשלה. נסה שוב.")}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => {
                      setBusy(true);
                      reload()
                        .then(() => setLoadError(false))
                        .catch(() => {
                          setItems([]);
                          setTotal(0);
                          setLoadError(true);
                        })
                        .finally(() => setBusy(false));
                    }}
                  >
                    {t("action.retry", "נסה שוב")}
                  </Button>
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-6 text-center text-muted-foreground">
                  {t("apt.no_apartments_page", "אין דירות להצגה.")}
                </td>
              </tr>
            ) : (
              items.map((a, i) => (
                <Fragment key={a.id}>
                  {/* fixes30 §1a / fixes53 §2: a header row opens each building
                      group; groups always render in full now (no +/- collapse —
                      the count badge is the exact rendered row count below it).
                      fixes54 §1.2: a building holding exactly one apartment
                      (a townhouse) skips the group header entirely — its row
                      renders directly, indistinguishable from ungrouped mode. */}
                  {groupByBuilding &&
                    (buildingCounts.get(a.building_id) ?? 0) > 1 &&
                    (i === 0 || items[i - 1].building_id !== a.building_id) && (
                      <tr className="border-t border-border bg-background/80">
                        <td colSpan={colCount} className="px-3 py-2">
                          {/* fixes54 §1.3 BUG FIX: without an isolated bidi
                              context, adjacent spans that each end/start with
                              digits (a street address ending in a house
                              number, immediately followed by the count
                              badge's leading digit) get their boxes
                              repositioned by the Unicode Bidi Algorithm and
                              visually overlap/merge — confirmed live via
                              getBoundingClientRect (the badge rendered ~60px
                              too far right, overlapping the area name) even
                              though the ms-2 margins themselves compute
                              correctly. `unicode-bidi: isolate` on each
                              dynamic-text span stops that cross-span
                              reordering; margin-based spacing between them
                              then measures exactly as authored. */}
                          <span className="font-semibold" style={{ unicodeBidi: "isolate" }}>
                            {cell(a, "building")}
                          </span>
                          {a.area_name && (
                            <span
                              className="ms-2 text-muted-foreground"
                              style={{ unicodeBidi: "isolate" }}
                            >
                              {a.area_name}
                            </span>
                          )}
                          {buildingCounts.has(a.building_id) && (
                            <span
                              className="ms-2 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-xs"
                              style={{ unicodeBidi: "isolate" }}
                            >
                              {t("apt.group_count", "{n} דירות").replace(
                                "{n}",
                                String(buildingCounts.get(a.building_id)),
                              )}
                            </span>
                          )}
                        </td>
                      </tr>
                    )}
                  <tr className="border-t border-border">
                    <td
                      className={`px-3 py-2 w-px whitespace-nowrap min-w-[150px] sticky z-10 bg-card ${firstColStickySide}`}
                    >
                      <ApartmentNameCell
                        a={a}
                        onSave={(v) => saveListField(a, { apartment_name: v })}
                      />
                    </td>
                    {/* fixes49 §1: break-words (not truncate/overflow-hidden) —
                        several of these cells hold a PicklistSelect/date-picker
                        editor that must render its floating dropdown past its
                        own <td> to stay visible, same reasoning as fixes47 on
                        the Contacts page. The cell text itself is already
                        pre-truncated via TruncatedText. */}
                    {renderedFields.map((k) => (
                      <td
                        key={k}
                        className={`px-3 py-2 max-w-[14rem] break-words ${fieldMinWidth(k)}`}
                      >
                        {cell(a, k)}
                      </td>
                    ))}
                    {/* fixes32 §6: inline-editable, straight from the list row —
                        no per-field code needed for a new custom picklist. */}
                    {visibleCustomDefs.map((d) => {
                      const value = a.picklist_values?.[d.field_key] ?? null;
                      return (
                        <td
                          key={d.field_key}
                          className="px-3 py-2 max-w-[14rem] break-words min-w-[120px]"
                        >
                          <InlineEdit<string | null>
                            value={value}
                            display={
                              <TruncatedText text={customPicklists.labelFor(d.field_key, value) || "—"} />
                            }
                            commitOnBlur={false}
                            onSave={(v) =>
                              saveListField(a, { picklist_values: { [d.field_key]: v } })
                            }
                            editor={(draft, _setDraft, commit) => (
                              <PicklistSelect
                                fieldKey={d.field_key}
                                value={draft}
                                onChange={commit}
                              />
                            )}
                          />
                        </td>
                      );
                    })}
                    {/* fixes35 §3: inline-editable, straight from the list row. */}
                    {visibleCustomFieldDefs.map((d) => {
                      const value = a.custom_field_values?.[d.field_key] ?? null;
                      return (
                        <td
                          key={d.field_key}
                          className={`px-3 py-2 max-w-[14rem] break-words ${
                            d.field_type === "text" ? "min-w-[150px]" : "min-w-[120px]"
                          }`}
                        >
                          <InlineEdit<string | number | boolean | null>
                            value={value}
                            display={
                              d.field_type === "text" && typeof value === "string" ? (
                                <TruncatedText text={value} />
                              ) : (
                                <CustomFieldValueDisplay fieldType={d.field_type} value={value} />
                              )
                            }
                            commitOnBlur={d.field_type === "text" || d.field_type === "number"}
                            onSave={(v) =>
                              saveListField(a, { custom_field_values: { [d.field_key]: v } })
                            }
                            editor={(draft, setDraft, commit) => (
                              <CustomFieldValueInput
                                fieldType={d.field_type}
                                value={draft}
                                onChange={
                                  d.field_type === "boolean" || d.field_type === "date"
                                    ? commit
                                    : setDraft
                                }
                              />
                            )}
                          />
                        </td>
                      );
                    })}
                    {showContact && (
                      <td className="px-3 py-2 w-px whitespace-nowrap">
                        {a.contact_id ? (
                          <Link
                            href={`/dashboard/contacts/${a.contact_id}`}
                            className="rounded-full bg-primary/10 text-primary px-3 py-0.5 hover:bg-primary/20"
                          >
                            {a.contact_name}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">{t("apt.no_contact", "ללא איש קשר")}</span>
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

      {/* Server-side pager (fixes8 §2C; fixes53 §2: paginates buildings while grouped). */}
      {!busy && pagerTotal > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => goToPage(page - 1)}
            className="rounded-md border border-input px-3 py-1.5 hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("pager.prev", "→ הקודם")}
          </button>
          <span className="text-muted-foreground">{rangeText}</span>
          <button
            type="button"
            disabled={page >= lastPage}
            onClick={() => goToPage(page + 1)}
            className="rounded-md border border-input px-3 py-1.5 hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("pager.next", "הבא ←")}
          </button>
        </div>
      )}
    </div>
  );
}

/** fixes32 §6: the apartment-number cell stays the primary navigation Link
 *  (unchanged click target) with a separate hover-pencil icon that opens
 *  inline edit in place — avoids the ambiguity of one click target doing two
 *  different things (navigate vs. edit). */
function ApartmentNameCell({
  a,
  onSave,
}: {
  a: ApartmentListItem;
  onSave: (v: string | null) => Promise<void>;
}) {
  const { t } = useLocalization();
  const { error: toastError } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(a.apartment_name ?? "");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  async function commit() {
    if (saving) return;
    const next = draft.trim() || null;
    if (next === (a.apartment_name ?? null)) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
      setEditing(false);
    } catch (err) {
      toastError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="rounded-md border border-primary px-1.5 py-0.5 text-sm w-20 focus:outline-none"
        value={draft}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void commit();
          } else if (e.key === "Escape") {
            setDraft(a.apartment_name ?? "");
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <span className="group inline-flex items-center gap-1">
      <Link
        href={`/dashboard/apartments/${a.id}`}
        className="font-medium text-primary hover:underline"
      >
        {apartmentTitle(a)}
      </Link>
      <button
        type="button"
        onClick={() => {
          setDraft(a.apartment_name ?? "");
          setEditing(true);
        }}
        title={t("inline.click_to_edit", "לחץ לעריכה")}
        className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-primary"
      >
        ✎
      </button>
    </span>
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
      <div className="w-full max-w-lg bg-card rounded-xl shadow-xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div>
          <h2 className="text-lg font-bold">{t("batch.title", "יצירת דירות מרובות")}</h2>
          <p className="text-sm text-muted-foreground">
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
                  className="text-xs text-primary hover:underline"
                >
                  {t("batch.select_all", "בחר הכל")}
                </button>
              )}
            </div>
            {floors.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("batch.no_floors", "לבניין זה אין קומות. הוסף קומות בעריכת הבניין.")}
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {floors.map((f) => (
                  <label
                    key={f.id}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm cursor-pointer ${
                      selectedFloors.includes(f.id)
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="accent-primary"
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
                  className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-3 py-1 text-sm"
                >
                  {l}
                  <button
                    type="button"
                    onClick={() => setLabels((prev) => prev.filter((x) => x !== l))}
                    className="text-primary/70 hover:text-status-darkred"
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
              className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent"
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
            className="rounded-md bg-primary text-white px-5 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {busy ? t("action.saving", "שומר…") : t("batch.create", "צור דירות")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-input px-4 py-2 text-sm hover:bg-accent"
          >
            {t("action.cancel", "ביטול")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The active-filter snapshot passed to the bulk editor — mirrors the query
 *  params sent to /api/apartments/list (fixes23 §3, expanded fixes52 §2.3
 *  to the page's full filter set, not just a subset). */
type BulkFilters = {
  building_ids: number[];
  area_ids: number[];
  report_number_ids: number[];
  jewish_status: string[];
  mezuzah_status: string[];
  language: string[];
  picklist: string[];
  custom_field_filter: string[];
  q?: string;
};

// fixes52 §2.3: standard bulk-editable fields — everything on the apartment
// EXCEPT apartment_name/building (the spec explicitly excludes both; they
// simply have no row here, and no field on the API's ApartmentBulkChanges
// schema either).
const BULK_STANDARD_FIELDS = [
  "floor", "name", "phone", "email", "report_number_id",
  "jewish_status", "campaign_status", "mezuzah_status", "language",
  "apartment_notes",
] as const;
type BulkStandardField = (typeof BULK_STANDARD_FIELDS)[number];

/** Bulk apartment editor (fixes23 §3, expanded fixes52 §2.3): apply a change
 *  to *every* apartment matching the page's current filters, in one request.
 *  Every standard field plus every custom picklist/custom field carries its
 *  own "update this field" toggle — an unchecked field's key is simply
 *  omitted from the payload, so the backend (`exclude_unset` semantics on
 *  `ApartmentBulkChanges`) leaves the existing DB value untouched. */
function BulkEditModal({
  total,
  reportNumbers,
  customDefs,
  customFieldDefs,
  filters,
  onClose,
  onDone,
}: {
  total: number;
  reportNumbers: ReportNumber[];
  customDefs: PicklistField[];
  customFieldDefs: CustomFieldDefinition[];
  filters: BulkFilters;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { t, lang } = useLocalization();
  const { success, error: toastError } = useToast();
  const language = usePicklist("apartment.language");
  // Keyed by BulkStandardField, `picklist:<field_key>` or
  // `customfield:<field_key>` — one enabled-flag/value pair per row.
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function setFieldEnabled(key: string, on: boolean) {
    setEnabled((prev) => ({ ...prev, [key]: on }));
  }
  function setFieldValue(key: string, value: unknown) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  const standardLabels: Record<BulkStandardField, string> = {
    floor: t("apartments.floor", "קומה"),
    name: t("apartments.name", "שם דייר"),
    phone: t("apartments.phone", "טלפון"),
    email: t("apartments.email", "אימייל"),
    report_number_id: t("apartments.report_number_id", "מספר דוח"),
    jewish_status: t("picklist.apartment.Jewish_status", "יהדות"),
    campaign_status: t("picklist.apartment.campaign_status", "סטטוס קמפיין"),
    mezuzah_status: t("picklist.apartment.mezuzah_status", "מזוזה"),
    language: t("picklist.apartment.language", "שפה"),
    apartment_notes: t("apartments.apartment_notes", "הערות"),
  };

  function renderStandardEditor(field: BulkStandardField) {
    switch (field) {
      case "floor":
      case "name":
        return (
          <input
            className={`${inputClass} w-full`}
            value={(values[field] as string) ?? ""}
            onChange={(e) => setFieldValue(field, e.target.value)}
          />
        );
      case "phone":
      case "email":
        return (
          <input
            className={`${inputClass} w-full`}
            dir="ltr"
            value={(values[field] as string) ?? ""}
            onChange={(e) => setFieldValue(field, e.target.value)}
          />
        );
      case "report_number_id":
        return (
          <div className="space-y-1">
            <SearchableSelect
              value={(values.report_number_id as number | null) ?? null}
              onChange={(id) => setFieldValue("report_number_id", id)}
              options={reportNumbers.map((rn) => ({ id: rn.id, label: rn.name }))}
              placeholder={t("bulkedit.choose_report", "בחר מספר דוח…")}
            />
            <p className="text-xs text-muted-foreground">
              {t("bulkedit.clear_hint", "השאר ריק כדי להסיר את מספר הדוח מהדירות.")}
            </p>
          </div>
        );
      case "jewish_status":
        return (
          <PicklistSelect
            fieldKey="apartment.Jewish_status"
            value={(values.jewish_status as string | null) ?? null}
            onChange={(v) => setFieldValue("jewish_status", v)}
          />
        );
      case "campaign_status":
        return (
          <PicklistSelect
            fieldKey="apartment.campaign_status"
            value={(values.campaign_status as string | null) ?? null}
            onChange={(v) => setFieldValue("campaign_status", v)}
          />
        );
      case "mezuzah_status":
        return (
          <PicklistSelect
            fieldKey="apartment.mezuzah_status"
            value={(values.mezuzah_status as string | null) ?? null}
            onChange={(v) => setFieldValue("mezuzah_status", v)}
          />
        );
      case "language":
        return (
          <MultiSelectFilter
            allLabel={t("filter.all_languages", "כל השפות")}
            options={language.options.map((o) => ({ id: o.value, label: language.display(o) }))}
            value={(values.language as string[]) ?? []}
            onChange={(vals) => setFieldValue("language", vals)}
          />
        );
      case "apartment_notes":
        return (
          <textarea
            className={`${inputClass} w-full`}
            rows={3}
            value={(values.apartment_notes as string) ?? ""}
            onChange={(e) => setFieldValue("apartment_notes", e.target.value)}
          />
        );
    }
  }

  async function apply() {
    setError("");
    const changes: Record<string, unknown> = {};
    const picklistValues: Record<string, unknown> = {};
    const customFieldValues: Record<string, unknown> = {};
    for (const [key, on] of Object.entries(enabled)) {
      if (!on) continue;
      if (key.startsWith("picklist:")) {
        picklistValues[key.slice("picklist:".length)] = values[key] ?? null;
      } else if (key.startsWith("customfield:")) {
        customFieldValues[key.slice("customfield:".length)] = values[key] ?? null;
      } else {
        changes[key] = values[key] ?? (key === "language" ? [] : null);
      }
    }
    if (Object.keys(picklistValues).length) changes.picklist_values = picklistValues;
    if (Object.keys(customFieldValues).length) changes.custom_field_values = customFieldValues;
    if (Object.keys(changes).length === 0) {
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
            language: filters.language,
            picklist: filters.picklist,
            custom_field_filter: filters.custom_field_filter,
            q: filters.q,
            changes,
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

  function FieldRow({ fieldKey, label }: { fieldKey: string; label: string }) {
    const on = !!enabled[fieldKey];
    return (
      <div className="space-y-1 rounded-lg border border-border p-3">
        <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
          <input
            type="checkbox"
            className="accent-primary"
            checked={on}
            onChange={(e) => setFieldEnabled(fieldKey, e.target.checked)}
          />
          {label}
        </label>
        {on && (
          <div className="pt-1">
            {BULK_STANDARD_FIELDS.includes(fieldKey as BulkStandardField)
              ? renderStandardEditor(fieldKey as BulkStandardField)
              : fieldKey.startsWith("picklist:")
                ? (
                  <PicklistSelect
                    fieldKey={fieldKey.slice("picklist:".length)}
                    value={(values[fieldKey] as string | null) ?? null}
                    onChange={(v) => setFieldValue(fieldKey, v)}
                  />
                )
                : (() => {
                    const def = customFieldDefs.find(
                      (d) => `customfield:${d.field_key}` === fieldKey,
                    );
                    return def ? (
                      <CustomFieldValueInput
                        fieldType={def.field_type}
                        value={
                          (values[fieldKey] as string | number | boolean | null) ?? null
                        }
                        onChange={(v) => setFieldValue(fieldKey, v)}
                      />
                    ) : null;
                  })()}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg bg-card rounded-xl shadow-xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div>
          <h2 className="text-lg font-bold">
            {t("bulkedit.title", "עריכה מרובה של דירות")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t(
              "bulkedit.intro",
              "השינויים יחולו על כל {total} הדירות התואמות לסינון הנוכחי.",
            ).replace("{total}", String(total))}
          </p>
        </div>

        {BULK_STANDARD_FIELDS.map((f) => (
          <FieldRow key={f} fieldKey={f} label={standardLabels[f]} />
        ))}
        {/* fixes52 §2.3: one row per admin-added apartment.* picklist. */}
        {customDefs.map((d) => (
          <FieldRow
            key={d.field_key}
            fieldKey={`picklist:${d.field_key}`}
            label={(lang === "en" ? d.english_label || d.label : d.label) || d.field_key}
          />
        ))}
        {/* fixes52 §2.3: one row per admin-added non-select apartment field. */}
        {customFieldDefs.map((d) => (
          <FieldRow
            key={d.field_key}
            fieldKey={`customfield:${d.field_key}`}
            label={(lang === "en" ? d.english_label || d.hebrew_label : d.hebrew_label) || d.field_key}
          />
        ))}

        {error && <p className="text-sm text-status-darkred">{error}</p>}
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={apply}
            disabled={busy || total === 0}
            className="rounded-md bg-primary text-white px-5 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {busy ? t("action.saving", "שומר…") : t("bulkedit.apply", "החל שינויים")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-input px-4 py-2 text-sm hover:bg-accent"
          >
            {t("action.cancel", "ביטול")}
          </button>
        </div>
      </div>
    </div>
  );
}

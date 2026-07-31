"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState } from "react";

import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { PicklistSelect } from "@/components/PicklistSelect";
import { SearchableSelect } from "@/components/SearchableSelect";
import { CustomFieldValueDisplay, CustomFieldValueInput } from "@/components/CustomFieldValueInput";
import { InlineEdit } from "@/components/ui/InlineEdit";
import { MultiSelectSearchFilter } from "@/components/ui/MultiSelectSearchFilter";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { mapsHref } from "@/lib/contactActions";
import { useCustomFieldDefs } from "@/lib/customFields";
import { useFieldSettings } from "@/lib/fieldSettings";
import { useLocalization } from "@/lib/localization";
import { usePersistentState } from "@/lib/persist";
import { FIXED_APARTMENT_PICKLIST_KEYS, usePicklist, usePicklistsMap } from "@/lib/picklists";
import { useDbPreference } from "@/lib/preferences";
import { useToast } from "@/lib/toast";
import { useChipReorder } from "@/lib/useChipReorder";
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
  type BuildingAggregate,
  type Floor,
  type PicklistField,
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

export default function ApartmentsPage() {
  const { loading, isShliach } = useAuth();
  const { t, lang } = useLocalization();
  const router = useRouter();
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
  // fixes33 §3.1: which custom apartment.* picklists show as table columns —
  // null (unset) means "all of them", so existing users see no change until
  // they explicitly hide one via the column-selector panel.
  const [visibleCustomKeys, setVisibleCustomKeys] = useDbPreference<string[] | null>(
    "apartments.customFields", null,
  );
  // fixes35 §3: any non-select apartment custom field — same column-selector
  // treatment as the picklist ones above, in its own preference so existing
  // "apartments.customFields" selections (picklist-only) are untouched.
  const customFieldDefs = useCustomFieldDefs("apartment").filter((d) => d.field_type !== "select");
  const [visibleCustomFieldKeys, setVisibleCustomFieldKeys] = useDbPreference<string[] | null>(
    "apartments.customFieldFields", null,
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
  // fixes32 §6: the whole filter section can be tucked away, mirroring the
  // Contacts page (fixes29 §1) — hidden filters keep applying to the list.
  const [filtersOpen, setFiltersOpen] = usePersistentState(
    "crm.apartments.filtersOpen", true,
  );
  const [fieldsOpen, setFieldsOpen] = useState(false);
  // fixes38: pointer-events-based reorder (native HTML5 drag-and-drop never
  // engages on many Windows trackpads — see useChipReorder's doc comment).
  const { draggedKey: draggedField, hoverKey: hoverField, chipProps: fieldChipProps, withClickGuard } =
    useChipReorder<FieldKey>(moveField);
  const [debouncedQ, setDebouncedQ] = useState(query);
  const [batchOpen, setBatchOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [busy, setBusy] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const language = usePicklist("apartment.language");
  const jewish = usePicklist("apartment.Jewish_status");
  const campaign = usePicklist("apartment.campaign_status");
  const mezuzah = usePicklist("apartment.mezuzah_status");
  // fixes32 §6: options for every dynamic apartment.* picklist at once.
  const customPicklists = usePicklistsMap(customDefs.map((d) => d.field_key));

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
      .catch(() => {
        setItems([]);
        setTotal(0);
      })
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    loading, areaIds, buildingIds, reportNumberIds, jewishFilter, mezuzahFilter,
    languageFilter, customFilters, debouncedQ, sort, dir, page, pageSize, groupByBuilding,
  ]);

  // fixes30 §1a: filter-scoped per-building counts for the group headers —
  // each building shows its full filtered count, not just this page's rows.
  useEffect(() => {
    if (loading || !groupByBuilding) return;
    const params = buildFilterParams();
    apiFetch<BuildingAggregate[]>(`/api/apartments/building-aggregates?${params}`)
      .then((rows) =>
        setAggregates(Object.fromEntries(rows.map((r) => [r.building_id, r.count]))),
      )
      .catch(() => setAggregates({}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    loading, groupByBuilding, areaIds, buildingIds, reportNumberIds,
    jewishFilter, mezuzahFilter, languageFilter, customFilters, debouncedQ,
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
        buildings.some((b) => b.id === id && b.area_id != null && ids.includes(b.area_id)),
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
  const activeFilterCount =
    areaIds.length +
    buildingIds.length +
    effectiveReportNumberIds.length +
    effectiveJewishFilter.length +
    effectiveMezuzahFilter.length +
    effectiveLanguageFilter.length +
    customFilterCount +
    (query.trim() ? 1 : 0);

  function clearAllFilters() {
    setAreaIds([]);
    setBuildingIds([]);
    setReportNumberIds([]);
    setJewishFilter([]);
    setMezuzahFilter([]);
    setLanguageFilter([]);
    setCustomFilters({});
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

  // fixes32 §6: drag one active-field chip to another position — reorders the
  // stored preference array itself (no separate "column order" preference).
  // fixes38 §2.1: the insert index must account for the shift caused by
  // removing `from` first — otherwise a rightward drag lands the chip AFTER
  // the drop target while a leftward drag lands it BEFORE, which reads as
  // "reordering is broken" (same gesture, direction-dependent result).
  function moveField(from: FieldKey, to: FieldKey) {
    if (from === to) return;
    setFields((prev) => {
      const known = prev.filter((k): k is FieldKey =>
        (FIELD_KEYS as readonly string[]).includes(k),
      );
      const fromIdx = known.indexOf(from);
      const toIdx = known.indexOf(to);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const next = [...known];
      next.splice(fromIdx, 1);
      const insertIdx = fromIdx < toIdx ? toIdx - 1 : toIdx;
      next.splice(insertIdx, 0, from);
      return next;
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
    field: "jewish_status" | "campaign_status" | "mezuzah_status" | "language",
    picklistKey: string,
    label: string | null | undefined,
  ) => (
    <InlineEdit<string | null>
      value={a[field] ?? null}
      display={label || "—"}
      commitOnBlur={false}
      onSave={(v) => saveListField(a, { [field]: v })}
      editor={(draft, _setDraft, commit) => (
        <PicklistSelect fieldKey={picklistKey} value={draft} onChange={commit} />
      )}
    />
  );

  // fixes32 §6: plain-text inline edit for comments/email/phone.
  const inlineTextCell = (
    a: ApartmentListItem,
    field: "apartment_notes" | "email" | "phone",
    opts: { dir?: "ltr"; multiline?: boolean; validate?: (v: string) => string | null } = {},
  ) => (
    <InlineEdit<string>
      value={(a[field] as string | null) ?? ""}
      display={
        a[field] ? <span dir={opts.dir} className="whitespace-pre-wrap">{a[field]}</span> : "—"
      }
      validate={opts.validate}
      enterCommits={!opts.multiline}
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
  // fixes33 §3.1: the subset of (org-visible) custom picklists the personal
  // column-selector panel has left switched on.
  const visibleCustomDefs = orgVisibleCustomDefs.filter(
    (d) => visibleCustomKeys === null || visibleCustomKeys.includes(d.field_key),
  );
  function toggleCustomField(fieldKey: string) {
    setVisibleCustomKeys((prev) => {
      const current = prev ?? orgVisibleCustomDefs.map((d) => d.field_key);
      return current.includes(fieldKey)
        ? current.filter((k) => k !== fieldKey)
        : [...current, fieldKey];
    });
  }
  // fixes35 §3: same org-visibility + personal column-selector treatment for
  // non-select apartment custom fields.
  const orgVisibleCustomFieldDefs = customFieldDefs.filter((d) =>
    vis(`customfield.apartment.${d.field_key}`),
  );
  const visibleCustomFieldDefs = orgVisibleCustomFieldDefs.filter(
    (d) => visibleCustomFieldKeys === null || visibleCustomFieldKeys.includes(d.field_key),
  );
  function toggleCustomFieldColumn(fieldKey: string) {
    setVisibleCustomFieldKeys((prev) => {
      const current = prev ?? orgVisibleCustomFieldDefs.map((d) => d.field_key);
      return current.includes(fieldKey)
        ? current.filter((k) => k !== fieldKey)
        : [...current, fieldKey];
    });
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
        return inlinePicklistCell(
          a, "language", "apartment.language", language.labelFor(a.language),
        );
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
      (areaIds.length === 0 || (b.area_id != null && areaIds.includes(b.area_id))) &&
      // fixes23 §2: when report numbers are selected, only buildings that hold a
      // matching apartment remain choosable.
      (buildingIdsForReports === null || buildingIdsForReports.has(b.id)),
  );

  // Title + optional data columns + custom-picklist columns + optional
  // contact column + trailing filler.
  const colCount =
    2 +
    renderedFields.length +
    visibleCustomDefs.length +
    visibleCustomFieldDefs.length +
    (showContact ? 1 : 0);

  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const rangeText = t("pager.range", "{from}–{to} מתוך {total}")
    .replace("{from}", String(total === 0 ? 0 : (page - 1) * pageSize + 1))
    .replace("{to}", String(Math.min(page * pageSize, total)))
    .replace("{total}", String(total));

  if (loading) return <p className="text-gray-400">{t("action.loading", "טוען…")}</p>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{t("apartments", "דירות")}</h1>
        <div className="flex items-center gap-2">
          {/* fixes32 §6: always reachable while any filter narrows the list —
              mirrors the Contacts page (fixes29 §1). */}
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={clearAllFilters}
              className="rounded-md border border-gray-300 text-gray-600 px-4 py-1.5 text-sm font-medium hover:bg-gray-50"
            >
              ✕ {t("filter.clear_all", "נקה את כל הסינונים")}
            </button>
          )}
          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            className="rounded-md border border-gray-300 text-gray-600 px-4 py-1.5 text-sm font-medium hover:bg-gray-50"
          >
            {filtersOpen
              ? `▴ ${t("filter.hide_filters", "הסתר סינון")}`
              : `▾ ${t("filter.show_filters", "הצג סינון")}`}
            {!filtersOpen && activeFilterCount > 0 && (
              <span className="ms-1.5 inline-flex items-center justify-center rounded-full bg-status-magenta text-white text-xs px-1.5 py-0.5 leading-none">
                {activeFilterCount}
              </span>
            )}
          </button>
          {/* fixes38 §2.1: the columns toggle lives outside the filtersOpen
              block so collapsing filters never hides it. */}
          <button
            type="button"
            onClick={() => setFieldsOpen((v) => !v)}
            className="rounded-md border border-gray-300 px-4 py-1.5 text-sm font-medium hover:bg-gray-50"
          >
            ⚙ {t("columns.fields_configure", "התאמת שדות")}
          </button>
          {!isShliach && (
            <>
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
            </>
          )}
        </div>
      </div>

      {/* fixes38 §2.1: the columns panel is deliberately OUTSIDE the
          filtersOpen fragment below, so collapsing filters never hides it. */}
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
          <p className="text-xs text-gray-400">
            {t("columns.reorder_hint", "גרור עמודה פעילה כדי לשנות את סדר ההצגה.")}
          </p>
          {orgVisibleCustomDefs.length > 0 && (
            <p className="text-xs text-gray-400">
              {t(
                "columns.custom_picklists_hint",
                "עמודות רשימת בחירה מותאמות אישית — ניתן להסתיר כל אחת בנפרד.",
              )}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {/* fixes32-stillnotdone §1: active chips render FIRST, in their
                actual current (reordered) order — rendering every chip in
                the fixed FIELD_KEYS order regardless of drag state meant a
                successful drag changed the table but never visibly moved
                anything in this panel, reading as "nothing happened".
                fixes33 §5.2: fields an admin hid org-wide aren't offered.
                fixes38: pointer-events drag (see useChipReorder) — native
                HTML5 drag-and-drop never engages on many Windows trackpads. */}
            {[
              ...activeFields,
              ...FIELD_KEYS.filter((k) => !activeFields.includes(k)),
            ].filter(fieldVisible).map((k) => {
              const active = activeFields.includes(k);
              const activeIdx = activeFields.indexOf(k);
              return (
                <span key={k} className="inline-flex items-center gap-0.5">
                  <button
                    type="button"
                    {...fieldChipProps(k, active)}
                    onClick={withClickGuard(() => toggleField(k))}
                    className={`rounded-md border px-3 py-1.5 text-sm ${
                      active
                        ? "border-status-magenta bg-status-magenta/10 text-status-magenta cursor-grab active:cursor-grabbing"
                        : "border-gray-200 text-gray-600 hover:bg-gray-50"
                    } ${draggedField === k ? "opacity-40" : ""} ${
                      hoverField === k && draggedField && draggedField !== k
                        ? "ring-2 ring-status-magenta"
                        : ""
                    }`}
                  >
                    {active ? "⠿ " : ""}
                    {fieldLabels[k]}
                  </button>
                  {/* fixes38: guaranteed-reliable fallback for dragging (see
                      moveActiveField) — a click always works, unlike a drag
                      gesture on some trackpads. */}
                  {active && (
                    <span className="flex flex-col gap-0.5">
                      <button
                        type="button"
                        disabled={activeIdx === 0}
                        onClick={() => moveActiveField(k, -1)}
                        title={t("action.move_up", "העלה")}
                        className="flex items-center justify-center w-7 h-7 rounded text-sm leading-none text-gray-400 hover:text-status-magenta hover:bg-gray-50 active:bg-gray-100 disabled:opacity-20"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        disabled={activeIdx === activeFields.length - 1}
                        onClick={() => moveActiveField(k, 1)}
                        title={t("action.move_down", "הורד")}
                        className="flex items-center justify-center w-7 h-7 rounded text-sm leading-none text-gray-400 hover:text-status-magenta hover:bg-gray-50 active:bg-gray-100 disabled:opacity-20"
                      >
                        ▼
                      </button>
                    </span>
                  )}
                </span>
              );
            })}
            {/* fixes33 §3.1: one show/hide toggle per admin-added apartment.*
                picklist — a personal preference, separate from whether the
                field is hidden org-wide (Manage Fields, fixes33 §5.2). */}
            {orgVisibleCustomDefs.map((d) => {
              const active = visibleCustomKeys === null || visibleCustomKeys.includes(d.field_key);
              return (
                <button
                  key={d.field_key}
                  type="button"
                  onClick={() => toggleCustomField(d.field_key)}
                  className={`rounded-md border px-3 py-1.5 text-sm ${
                    active
                      ? "border-status-magenta bg-status-magenta/10 text-status-magenta"
                      : "border-gray-200 text-gray-600 hover:bg-gray-50"
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
              const active =
                visibleCustomFieldKeys === null || visibleCustomFieldKeys.includes(d.field_key);
              return (
                <button
                  key={d.field_key}
                  type="button"
                  onClick={() => toggleCustomFieldColumn(d.field_key)}
                  className={`rounded-md border px-3 py-1.5 text-sm ${
                    active
                      ? "border-status-magenta bg-status-magenta/10 text-status-magenta"
                      : "border-gray-200 text-gray-600 hover:bg-gray-50"
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

      {/* fixes32 §6: both filter rows unmount while the toggle is off; the
          persisted filter state is untouched, so it keeps filtering the list
          — the exact fixes29 §1 pattern from the Contacts page. */}
      {filtersOpen && (<>
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
        {/* fixes23 §2: multi-select searchable report-number filter.
            fixes33 §5.2: hidden org-wide → no filter control either. */}
        {reportNumbers.length > 0 && fieldVisible("report_number") && (
          <MultiSelectSearchFilter
            className="w-48"
            allLabel={t("filter.all_report_numbers", "כל מספרי הדוח")}
            options={reportNumbers.map((rn) => ({ id: rn.id, label: rn.name }))}
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
            options={jewish.options.map((o) => ({ id: o.value, label: jewish.display(o) }))}
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
            options={mezuzah.options.map((o) => ({ id: o.value, label: mezuzah.display(o) }))}
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
          options={language.options.map((o) => ({ id: o.value, label: language.display(o) }))}
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
              options={opts.map((o) => ({ id: o.value, label: customPicklists.display(o) }))}
              value={customFilters[d.field_key] ?? []}
              onChange={(vals) => {
                setCustomFilters((prev) => ({ ...prev, [d.field_key]: vals }));
                setPage(1);
              }}
            />
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
        {/* fixes33 §3.2: hands the current filter state to the reports page. */}
        <button
          type="button"
          onClick={goToFilteredReport}
          disabled={total === 0}
          className="rounded-md border border-status-magenta text-status-magenta px-3 py-2 font-medium hover:bg-status-magenta/10 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          📄 {t("apt.create_report_from_filters", "צור דוח מהתוצאות המסוננות")}
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
              {renderedFields.map((k) => (
                <th key={k} className="px-3 py-1.5 font-medium w-px whitespace-nowrap">
                  {fieldLabels[k]}
                </th>
              ))}
              {/* fixes32 §6 / fixes33 §3.1: one column per admin-added
                  apartment.* picklist the column-selector panel has left on. */}
              {visibleCustomDefs.map((d) => (
                <th key={d.field_key} className="px-3 py-1.5 font-medium w-px whitespace-nowrap">
                  {customDefLabel(d)}
                </th>
              ))}
              {/* fixes35 §3: one column per non-select apartment custom field
                  the column-selector panel has left on. */}
              {visibleCustomFieldDefs.map((d) => (
                <th key={d.field_key} className="px-3 py-1.5 font-medium w-px whitespace-nowrap">
                  {(lang === "en" ? d.english_label || d.hebrew_label : d.hebrew_label) ||
                    d.field_key}
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
                      <ApartmentNameCell
                        a={a}
                        onSave={(v) => saveListField(a, { apartment_name: v })}
                      />
                    </td>
                    {renderedFields.map((k) => (
                      <td key={k} className="px-3 py-2 w-px whitespace-nowrap max-w-[14rem] truncate">
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
                          className="px-3 py-2 w-px whitespace-nowrap max-w-[14rem] truncate"
                        >
                          <InlineEdit<string | null>
                            value={value}
                            display={customPicklists.labelFor(d.field_key, value) || "—"}
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
                          className="px-3 py-2 w-px whitespace-nowrap max-w-[14rem] truncate"
                        >
                          <InlineEdit<string | number | boolean | null>
                            value={value}
                            display={<CustomFieldValueDisplay fieldType={d.field_type} value={value} />}
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
        className="rounded-md border border-status-magenta px-1.5 py-0.5 text-sm w-20 focus:outline-none"
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
        className="font-medium text-status-magenta hover:underline"
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
        className="text-xs text-gray-300 opacity-0 group-hover:opacity-100 hover:text-status-magenta"
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

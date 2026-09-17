"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { MultiSelectSearchFilter } from "@/components/ui/MultiSelectSearchFilter";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useCustomFieldDefs } from "@/lib/customFields";
import { useLocalization } from "@/lib/localization";
import { naturalCompare } from "@/lib/naturalSort";
import {
  drawPdfHeaders,
  loadHeaderLogo,
  prepareHebrewPdf,
  HEBREW_FONT,
  PDF_CONTENT_TOP,
} from "@/lib/pdfRtl";
import { displayPicklistValue, FIXED_APARTMENT_PICKLIST_KEYS } from "@/lib/picklists";
import { useDbPreference } from "@/lib/preferences";
import { useToast } from "@/lib/toast";
import { useSortableList } from "@/lib/useSortableList";
import {
  apartmentTitle,
  buildingDisplayName,
  type ApartmentListItem,
  type ApartmentPage,
  type PicklistField,
  type PicklistValue,
  type ReportNumber,
} from "@/lib/types";

/** PDF geometry (A4 portrait, points). */
const MARGIN = 40;
const CELL_PADDING = 4;

// fixes38 §4.2/§4.3/§4.4, expanded fixes40 §5: which logical columns can
// render, each with an optional custom subheading and a target width
// percentage. Persisted per-user via the existing DB-preference mechanism
// (no backend model needed — mirrors how Contacts/Apartments already
// persist column selections). fixes40 §5: the set now matches the
// Apartments page's own "Customize Fields" vocabulary exactly (its
// `FIELD_KEYS` plus the two always-on identity columns, floor/
// apartment_name) — "notes"/"resident" etc. use the same key names, not
// the report's old bespoke "apartment_notes" naming.
const REPORT_COLUMN_KEYS = [
  "floor",
  "apartment_name",
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
type ReportColumnKey = (typeof REPORT_COLUMN_KEYS)[number];

// fixes60 §7: a report column is now either one of the fixed ReportColumnKey
// values, or a dynamic apartment.* custom column addressed by a prefixed
// string key — "pl:<field_key>" for a custom picklist, "cf:<field_key>" for
// a non-select custom field (mirrors the Apartments page's own GridColumn
// prefix scheme, fixes60 §6). `columns`/`subheadings`/`widths` are widened
// to plain strings so they can hold either kind side by side.
interface ReportColumnConfig {
  columns: string[];
  subheadings: Record<string, string | undefined>;
  widths: Record<string, number | undefined>;
}

// fixes40 §5: only the original 6 are active by default (same widths,
// summing to 100, as before) — the other 7 new columns are available but
// opt-in, so an existing saved preference isn't suddenly overflowing past
// 100% width. A pre-fixes40 preference's old "apartment_notes" key is
// silently dropped by the membership filter below (renamed to "notes") —
// the same graceful-degradation the Apartments page itself already relies
// on for renamed/removed keys.
const DEFAULT_REPORT_COLUMNS: ReportColumnConfig = {
  columns: ["floor", "apartment_name", "jewish_status", "mezuzah_status", "language", "notes"],
  subheadings: {},
  widths: {
    floor: 10,
    apartment_name: 14,
    jewish_status: 17,
    mezuzah_status: 15,
    language: 14,
    notes: 30,
  },
};

/** fixes30 §3 / fixes33 §3.2: the page offers three source modes — the
 *  classic report-number selection, an arbitrary hand-picked set of
 *  apartments, or (deep-linked from the Apartments page's filtered list)
 *  whatever filter params arrived in the URL. */
type ReportMode = "reports" | "apartments" | "filters";

// fixes33 §3.2: the exact param names /api/apartments/list accepts, carried
// over verbatim from the Apartments page's current filter state.
const FILTER_PARAM_KEYS = [
  "area_ids", "building_ids", "report_number_ids",
  "jewish_status", "mezuzah_status", "language", "picklist", "q",
] as const;

// fixes39 §4: the source-mode + picked report-numbers/apartments — the one
// input on this page that was pure component state (lost on navigation)
// before the permanent Save button. `mode` here is the user's last plain
// (non-deep-linked) choice; a URL deep-link always overrides it at render
// time (see the `mode` derivation below), never overwrites it.
interface ReportSelection {
  mode: ReportMode;
  selectedIds: number[];
  selectedAptIds: number[];
}
const DEFAULT_REPORT_SELECTION: ReportSelection = {
  mode: "reports",
  selectedIds: [],
  selectedAptIds: [],
};

export default function CreateReportsPage() {
  return (
    <Suspense fallback={<p className="text-muted-foreground">…</p>}>
      <CreateReportsInner />
    </Suspense>
  );
}

function CreateReportsInner() {
  const { loading, user, isAdmin, refresh } = useAuth();
  const { t, lang } = useLocalization();
  const { error: toastError, success } = useToast();
  const searchParams = useSearchParams();
  // fixes33 §3.2: the `from` marker — not just "any filter param present" —
  // decides this, since an apartments-page visit with every filter cleared
  // (viewing all apartments) still needs to land in "filters" mode; its
  // query string otherwise carries no params at all and would be
  // indistinguishable from a plain, non-deep-linked visit to this page.
  const hasFilterParams = searchParams.get("from") === "apartments-filtered";
  const filterParams = new URLSearchParams();
  for (const key of FILTER_PARAM_KEYS) {
    for (const v of searchParams.getAll(key)) filterParams.append(key, v);
  }
  // fixes39 §4: the source-mode/selection inputs are persisted the same way
  // the column config already was (fixes38 §4.4) — `mode` still defers to a
  // URL deep-link (the persisted value is never overwritten by one, so it's
  // there again on the next plain visit).
  const [selection, setSelection] = useDbPreference<ReportSelection>(
    "reports.selection", DEFAULT_REPORT_SELECTION,
  );
  const mode: ReportMode = hasFilterParams ? "filters" : selection.mode;
  function setMode(m: ReportMode) {
    setSelection((prev) => ({ ...prev, mode: m }));
  }
  const selectedIds = selection.selectedIds;
  function setSelectedIds(ids: number[]) {
    setSelection((prev) => ({ ...prev, selectedIds: ids }));
  }
  const selectedAptIds = selection.selectedAptIds;
  function setSelectedAptIds(ids: number[]) {
    setSelection((prev) => ({ ...prev, selectedAptIds: ids }));
  }
  const [reportNumbers, setReportNumbers] = useState<ReportNumber[]>([]);
  // fixes30 §3: the direct-selection option pool.
  const [apartmentOptions, setApartmentOptions] = useState<ApartmentListItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [noData, setNoData] = useState(false);
  // fixes38 §4.1: report description moved here from the global Settings
  // page — still the same org-wide `report_notes` column, just edited from
  // the report page itself now.
  const [reportNotes, setReportNotes] = useState("");
  const [notesDirty, setNotesDirty] = useState(false);
  const [savingReport, setSavingReport] = useState(false);
  // fixes38 §4.2/§4.4: column selection/subheadings/widths, persisted per user.
  const [reportColumns, setReportColumns] = useDbPreference<ReportColumnConfig>(
    "reports.apartmentColumns", DEFAULT_REPORT_COLUMNS,
  );
  // fixes60 §7: any admin-added apartment.* custom picklist/field is
  // selectable here too, same source + org-scoping as the Apartments page's
  // own "Customize Fields" panel (fixes32 §6 / fixes35 §3) — org-wide
  // Manage Fields hiding is deliberately NOT applied here (a report column
  // choice is independent of what shows in the live grid).
  const [customPicklistDefs, setCustomPicklistDefs] = useState<PicklistField[]>([]);
  const customFieldDefs = useCustomFieldDefs("apartment").filter((d) => d.field_type !== "select");
  useEffect(() => {
    if (loading) return;
    apiFetch<PicklistField[]>("/api/picklists")
      .then((defs) =>
        setCustomPicklistDefs(
          defs.filter(
            (d) => d.entity_type === "apartment" && !FIXED_APARTMENT_PICKLIST_KEYS.includes(d.field_key),
          ),
        ),
      )
      .catch(() => setCustomPicklistDefs([]));
  }, [loading]);

  useEffect(() => {
    if (!notesDirty) setReportNotes(user?.organization?.report_notes ?? "");
  }, [user?.organization?.report_notes, notesDirty]);

  // fixes39 §4: one permanent, explicit Save button for every input on this
  // page — report notes (unchanged endpoint), the column config and the
  // mode/selection (both already persisted via useDbPreference's own
  // 400ms-debounced background write, same as Contacts/Apartments' column
  // preferences) get an immediate, non-debounced write here too so a click
  // is a real guarantee, not just "probably saved by now".
  async function saveReportPage() {
    setSavingReport(true);
    try {
      if (isAdmin) {
        await apiFetch("/api/organizations/me", {
          method: "PUT",
          body: JSON.stringify({ report_notes: reportNotes.trim() || null }),
        });
        await refresh();
        setNotesDirty(false);
      }
      await Promise.all([
        apiFetch("/api/preferences", {
          method: "PUT",
          body: JSON.stringify({ key: "reports.apartmentColumns", value: reportColumns }),
        }),
        apiFetch("/api/preferences", {
          method: "PUT",
          body: JSON.stringify({ key: "reports.selection", value: selection }),
        }),
      ]);
      success(t("msg.saved", "נשמר בהצלחה"));
    } catch (err) {
      toastError(err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"));
    } finally {
      setSavingReport(false);
    }
  }

  // fixes60 §7: the fixed keys plus every dynamic apartment.* custom
  // picklist/field, prefixed — see the ReportColumnConfig comment above.
  const allColumnKeys: string[] = [
    ...REPORT_COLUMN_KEYS,
    ...customPicklistDefs.map((d) => `pl:${d.field_key}`),
    ...customFieldDefs.map((d) => `cf:${d.field_key}`),
  ];

  // fixes40 §5: which columns are active, in their user-chosen (now
  // reorderable) order — was fixed-logical-order-only ("the spec asks only
  // for inclusion, not reordering") before this round.
  const activeReportColumns = reportColumns.columns.filter((k) => allColumnKeys.includes(k));
  const columnLabels: Record<ReportColumnKey, string> = {
    floor: t("reports.floor", "קומה"),
    apartment_name: t("reports.apartment_name", "מספר דירה"),
    resident: t("apartments.name", "שם דייר"),
    building: t("apartments.building_id", "בניין"),
    area: t("buildings.area_id", "אזור"),
    report_number: t("apartments.report_number_id", "מספר דוח"),
    notes: t("reports.apartment_notes", "הערות"),
    phone: t("apartments.phone", "טלפון"),
    email: t("apartments.email", "אימייל"),
    jewish_status: t("reports.jewish_status", "מצב יהדות"),
    mezuzah_status: t("reports.mezuzah_status", "מזוזה"),
    language: t("reports.language", "שפה"),
    campaign_status: t("picklist.apartment.campaign_status", "סטטוס קמפיין"),
  };
  // fixes60 §7: label lookup spanning both the fixed dictionary above and
  // the dynamic pl:/cf: prefixed custom columns.
  function columnLabel(k: string): string {
    if ((REPORT_COLUMN_KEYS as readonly string[]).includes(k)) {
      return columnLabels[k as ReportColumnKey];
    }
    if (k.startsWith("pl:")) {
      const fieldKey = k.slice(3);
      const d = customPicklistDefs.find((def) => def.field_key === fieldKey);
      return (d && (lang === "en" ? d.english_label || d.label : d.label)) || fieldKey;
    }
    if (k.startsWith("cf:")) {
      const fieldKey = k.slice(3);
      const d = customFieldDefs.find((def) => def.field_key === fieldKey);
      return (d && (lang === "en" ? d.english_label || d.hebrew_label : d.hebrew_label)) || fieldKey;
    }
    return k;
  }
  const totalReportWidth = activeReportColumns.reduce(
    (sum, k) => sum + (reportColumns.widths[k] ?? 0), 0,
  );
  // fixes38 §4.3: sum of active column widths must not exceed 100%.
  const widthOverLimit = totalReportWidth > 100;

  function toggleReportColumn(k: string) {
    setReportColumns((prev) => ({
      ...prev,
      columns: prev.columns.includes(k)
        ? prev.columns.filter((c) => c !== k)
        : [...prev.columns, k],
    }));
  }

  // fixes40 §5: SortableJS's container holds every chip (active + inactive
  // — same pattern the Apartments page's own Customize Fields panel uses,
  // see useSortableList's doc comment) — recompute the active order from
  // the container's resulting DOM order directly.
  function reorderReportColumns(orderedKeys: string[]) {
    setReportColumns((prev) => {
      const activeSet = new Set(prev.columns);
      const reordered = orderedKeys.filter((k) => activeSet.has(k));
      return reordered.length > 0 ? { ...prev, columns: reordered } : prev;
    });
  }

  function moveActiveReportColumn(key: string, delta: -1 | 1) {
    setReportColumns((prev) => {
      const idx = prev.columns.indexOf(key);
      const to = idx + delta;
      if (idx === -1 || to < 0 || to >= prev.columns.length) return prev;
      const next = [...prev.columns];
      [next[idx], next[to]] = [next[to], next[idx]];
      return { ...prev, columns: next };
    });
  }

  function setReportSubheading(k: string, value: string) {
    setReportColumns((prev) => ({
      ...prev,
      subheadings: { ...prev.subheadings, [k]: value },
    }));
  }

  function setReportWidth(k: string, value: number) {
    setReportColumns((prev) => ({
      ...prev,
      widths: { ...prev.widths, [k]: value },
    }));
  }

  // fixes40 §5: SortableJS-backed reorder for the column chip panel,
  // mobile-first — identical mechanism to Apartments' Customize Fields.
  const { containerRef: reportColumnsSortableRef, withClickGuard: withColumnClickGuard } =
    useSortableList<HTMLDivElement>(reorderReportColumns);

  useEffect(() => {
    if (loading) return;
    apiFetch<ReportNumber[]>("/api/report-numbers")
      .then(setReportNumbers)
      .catch(() => setReportNumbers([]));
  }, [loading]);

  /** Page through /api/apartments/list (active versions, role-scoped, floor
   *  order) with the given extra params until every row is in. */
  async function fetchAllPages(
    build: (params: URLSearchParams) => void,
  ): Promise<ApartmentListItem[]> {
    const all: ApartmentListItem[] = [];
    for (let page = 1; ; page += 1) {
      const params = new URLSearchParams();
      build(params);
      params.set("sort", "floor");
      params.set("dir", "asc");
      params.set("page", String(page));
      params.set("page_size", "100");
      const res = await apiFetch<ApartmentPage>(`/api/apartments/list?${params}`);
      all.push(...res.items);
      if (all.length >= res.total || res.items.length === 0) break;
    }
    return all;
  }

  // fixes30 §3: the apartment picker's options load once, on first use.
  useEffect(() => {
    if (loading || mode !== "apartments" || apartmentOptions !== null) return;
    fetchAllPages(() => {})
      .then(setApartmentOptions)
      .catch(() => setApartmentOptions([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, mode, apartmentOptions]);

  async function generatePdf() {
    const nothingSelected =
      mode === "reports"
        ? selectedIds.length === 0
        : mode === "apartments"
          ? selectedAptIds.length === 0
          : false; // "filters": the URL's filter params drive the query, nothing to pick
    // fixes38 §4.2/§4.3: no columns selected, or the widths exceed 100%.
    if (nothingSelected || busy || activeReportColumns.length === 0 || widthOverLimit) return;
    setBusy(true);
    setNoData(false);
    try {
      const rows =
        mode === "reports"
          ? await fetchAllPages((params) =>
              selectedIds.forEach((id) =>
                params.append("report_number_ids", String(id)),
              ),
            )
          : mode === "apartments"
            ? await fetchAllPages((params) =>
                selectedAptIds.forEach((id) =>
                  params.append("apartment_ids", String(id)),
                ),
              )
            : await fetchAllPages((params) => {
                for (const [k, v] of filterParams.entries()) params.append(k, v);
              });
      if (rows.length === 0) {
        setNoData(true);
        return;
      }

      // Picklist labels are fetched here (not via usePicklist) so a fast
      // click right after page load can't produce raw technical values.
      // fixes26 §1: the org logo rides along for the per-page header.
      // fixes40 §5: campaign_status joins the other 3 fixed apartment
      // picklists now that it's a selectable report column.
      const [jewish, mezuzah, language, campaign, headerLogo] = await Promise.all([
        apiFetch<PicklistValue[]>("/api/picklists/apartment.Jewish_status"),
        apiFetch<PicklistValue[]>("/api/picklists/apartment.mezuzah_status"),
        apiFetch<PicklistValue[]>("/api/picklists/apartment.language"),
        apiFetch<PicklistValue[]>("/api/picklists/apartment.campaign_status"),
        loadHeaderLogo(user?.organization?.logo_url),
      ]);
      const labelFor = (opts: PicklistValue[], value: string | null): string => {
        if (value == null) return "";
        const o = opts.find((opt) => opt.value === value);
        return o ? displayPicklistValue(o, lang) : value;
      };
      // fixes60 §7: label options for whichever custom picklists are
      // actually selected on this report — fetched once here for the same
      // "no raw technical value on a fast click" reason as the 4 fixed ones.
      const activeCustomPlKeys = activeReportColumns
        .filter((k) => k.startsWith("pl:"))
        .map((k) => k.slice(3));
      const customPlEntries = await Promise.all(
        activeCustomPlKeys.map(
          async (fieldKey): Promise<[string, PicklistValue[]]> => [
            fieldKey,
            await apiFetch<PicklistValue[]>(`/api/picklists/${fieldKey}`),
          ],
        ),
      );
      const customPlLabelMaps: Record<string, PicklistValue[]> = Object.fromEntries(customPlEntries);

      const { jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      // Hebrew font + logical-order bidi on every text call (lib/pdfRtl.ts) —
      // all strings below are plain logical text.
      await prepareHebrewPdf(doc);
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const bottom = pageH - MARGIN;

      // fixes38 §4.2 / fixes40 §5: only the user's selected columns render,
      // in their own (now reorderable) order; a subheading (if set) renders
      // as a second line via "\n" — jspdf-autotable wraps multi-line
      // header/body strings natively. fixes60 §7: pl:/cf: prefixed keys
      // resolve against the custom picklist/field defs instead of the
      // fixed switch below.
      const rowValueFor = (a: ApartmentListItem, k: string): string => {
        if (k.startsWith("pl:")) {
          const fieldKey = k.slice(3);
          return labelFor(customPlLabelMaps[fieldKey] ?? [], a.picklist_values?.[fieldKey] ?? null);
        }
        if (k.startsWith("cf:")) {
          const fieldKey = k.slice(3);
          const def = customFieldDefs.find((d) => d.field_key === fieldKey);
          const value = a.custom_field_values?.[fieldKey] ?? null;
          if (!def) return "";
          if (def.field_type === "boolean") return value ? "✓" : "";
          return value == null || value === "" ? "" : String(value);
        }
        switch (k as ReportColumnKey) {
          case "floor":
            return a.floor ?? "";
          case "apartment_name":
            return a.apartment_name ?? "";
          case "resident":
            return a.name ?? "";
          case "building":
            return buildingDisplayName({
              id: a.building_id,
              building_name: a.building_name,
              building_address: a.building_address,
            });
          case "area":
            return a.area_name ?? "";
          case "report_number":
            return a.report_number_name ?? "";
          case "notes":
            return a.apartment_notes ?? "";
          case "phone":
            return a.phone ?? "";
          case "email":
            return a.email ?? "";
          case "jewish_status":
            return labelFor(jewish, a.jewish_status);
          case "mezuzah_status":
            return labelFor(mezuzah, a.mezuzah_status);
          case "language":
            // fixes51 §2.2: multi-select — comma-separated labels.
            return a.language.map((v) => labelFor(language, v)).join(", ");
          case "campaign_status":
            return labelFor(campaign, a.campaign_status);
          default:
            return "";
        }
      };
      // fixes38 §4.2: width % of the usable page width, per active column.
      const usableWidth = pageW - MARGIN * 2;
      const logicalWidths = activeReportColumns.map(
        (k) => (usableWidth * (reportColumns.widths[k] ?? 0)) / 100,
      );

      // Visual order is the reverse of the logical (RTL) column order —
      // autotable lays columns out left-to-right, so קומה must come last to
      // land rightmost.
      // fixes64 §3: the subheading is now a real second header ROW (not a
      // second line inside the label's own cell) — it needs its own row to
      // get a distinct (smaller) font size and to repeat on every page the
      // same way the label row already does.
      const logicalLabels = activeReportColumns.map((k) => columnLabel(k));
      const logicalSubheadings = activeReportColumns.map(
        (k) => reportColumns.subheadings[k]?.trim() ?? "",
      );
      const hasSubheadingRow = logicalSubheadings.some(Boolean);
      const labelsRow = [...logicalLabels].reverse();
      const subheadingsRow = [...logicalSubheadings].reverse();
      const visualWidths = [...logicalWidths].reverse();
      const columnStyles = Object.fromEntries(
        visualWidths.map((w, i) => [i, { cellWidth: w }]),
      );

      // fixes26 §1: every page carries the org header — content starts below it.
      let y = PDF_CONTENT_TOP;
      doc.setFont(HEBREW_FONT, "bold");
      doc.setFontSize(18);
      doc.text(t("reports.pdf_title", "דוח ריכוז דירות"), pageW - MARGIN, y + 8, {
        align: "right",
      });
      // fixes52 §4: a prominent divider under the report's own title —
      // distinct from drawPdfHeaders' pale org-branding hairline.
      doc.setDrawColor(31, 41, 55);
      doc.setLineWidth(1.2);
      doc.line(MARGIN, y + 16, pageW - MARGIN, y + 16);
      doc.setLineWidth(0.2);
      y += 34;

      // fixes33 §7.1 / fixes38 §4.1: the report description, once, at the
      // very top of the document — before the first report/building section.
      const trimmedNotes = reportNotes.trim();
      if (trimmedNotes) {
        doc.setFont(HEBREW_FONT, "normal");
        doc.setFontSize(10);
        const lines = doc.splitTextToSize(trimmedNotes, usableWidth) as string[];
        for (const line of lines) {
          doc.text(line, pageW - MARGIN, y, { align: "right" });
          y += 13;
        }
        y += 10;
      }

      // fixes61 §6: shrink a column's header font just enough that its
      // longest unbreakable word still fits the column width, instead of
      // letting autotable wrap it into single-character vertical text when
      // the user drags a column very narrow.
      const fitHeaderFontSize = (
        label: string,
        availableWidth: number,
        baseFontSize: number,
        minFontSize = 6,
      ): number => {
        const words = label.split(/[\s\n]+/).filter(Boolean);
        if (words.length === 0) return baseFontSize;
        doc.setFont(HEBREW_FONT, "bold");
        let size = baseFontSize;
        while (size > minFontSize) {
          doc.setFontSize(size);
          const widest = Math.max(...words.map((w) => doc.getTextWidth(w)));
          if (widest <= availableWidth) break;
          size -= 0.5;
        }
        return size;
      };

      // One table per building, headed by the building's cleaned
      // "street + number" display string (shared by both modes).
      const renderBuildingTables = (group: ApartmentListItem[]) => {
        const byBuilding = new Map<string, ApartmentListItem[]>();
        for (const a of group) {
          const key = buildingDisplayName({
            id: a.building_id,
            building_name: a.building_name,
            building_address: a.building_address,
          });
          const list = byBuilding.get(key) ?? [];
          list.push(a);
          byBuilding.set(key, list);
        }
        // fixes52 §6: natural sort — "רחוב 10" must not sort before "רחוב 2".
        const buildingKeys = [...byBuilding.keys()].sort(naturalCompare);

        for (const buildingKey of buildingKeys) {
          const apts = byBuilding.get(buildingKey)!;
          // fixes60 §8: a small building (under 4 apartments) gets a
          // compact inline header and tighter spacing instead of the full
          // section break a large building gets — proportionate to size.
          const compact = apts.length < 4;
          if (y + (compact ? 40 : 60) > bottom) {
            doc.addPage();
            y = PDF_CONTENT_TOP;
          }
          doc.setFont(HEBREW_FONT, "bold");
          doc.setFontSize(compact ? 10 : 12);
          doc.text(buildingKey, pageW - MARGIN, y + (compact ? 3 : 4), { align: "right" });
          y += compact ? 8 : 12;

          const body = apts.map((a) => activeReportColumns.map((k) => rowValueFor(a, k)).reverse());
          const baseFontSize = compact ? 9 : 10;
          const cellPad = compact ? 3 : CELL_PADDING;

          autoTable(doc, {
            startY: y,
            // top must clear the per-page org header on flowed pages (fixes26 §1).
            margin: { left: MARGIN, right: MARGIN, top: PDF_CONTENT_TOP, bottom: MARGIN },
            // Explicit total width — with 'auto' this autotable version logs a
            // spurious "content width could not fit page" warning.
            tableWidth: logicalWidths.reduce((a, b) => a + b, 0),
            // fixes61 §5: always pass the real head so autotable repeats it
            // on every physical page of ITS OWN internal pagination too.
            // Previously this was `[]` whenever a building's table started
            // on the same page the last one ended on (to avoid two header
            // bars close together) — but that meant a `head: []` table had
            // nothing to repeat if it later overflowed onto a new page,
            // leaving that page with no header at all. A header directly
            // above a new building's own rows is normal table convention,
            // not a duplicate — so it's always shown now. fixes64 §3: the
            // subheading row (when any column has one) rides along as the
            // head's 2nd row, so it repeats on every page exactly like the
            // label row above it.
            head: hasSubheadingRow ? [labelsRow, subheadingsRow] : [labelsRow],
            body,
            theme: "grid",
            styles: {
              font: HEBREW_FONT,
              fontSize: baseFontSize,
              halign: "right",
              valign: "top",
              cellPadding: cellPad,
            },
            headStyles: {
              fontStyle: "bold",
              // fixes64 §3: light grey (was a dark slate background with
              // white text).
              fillColor: [229, 231, 235],
              textColor: [31, 41, 55],
              halign: "right",
            },
            // fixes43 §2: every 2nd body row (Row 2, Row 4, …) gets a light
            // grey background so it reads distinctly from Row 1 — jspdf-
            // autotable's built-in zebra-stripe mechanism.
            alternateRowStyles: { fillColor: [245, 245, 245] },
            columnStyles,
            // fixes61 §6: shrink just the header cell's font (never the body's)
            // when its column is too narrow for the label's longest word,
            // instead of letting it wrap into single-character vertical text.
            // fixes64 §3: the subheading row starts from a smaller base size
            // than the label row, on top of that same narrow-column shrink.
            didParseCell: (data) => {
              if (data.section !== "head") return;
              const isSubheadingRow = hasSubheadingRow && data.row.index === 1;
              const label =
                (isSubheadingRow ? subheadingsRow : labelsRow)[data.column.index] ?? "";
              const availableWidth = visualWidths[data.column.index] - cellPad * 2;
              data.cell.styles.fontSize = fitHeaderFontSize(
                label,
                availableWidth,
                isSubheadingRow ? Math.max(baseFontSize - 2, 6) : baseFontSize,
              );
            },
          });
          y =
            (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable
              .finalY + (compact ? 8 : 16);
        }
      };

      // fixes61 §4: per-report page ranges — [startPage, endPage] of physical
      // pages each report number occupies — so the footer can count "page 1
      // of N" scoped to that one report instead of the whole batch document.
      const reportPageRanges: { label: string; startPage: number; endPage: number }[] = [];

      if (mode === "reports") {
        // Group by report number (picker order = name order), then by building.
        const byReport = new Map<number, ApartmentListItem[]>();
        for (const a of rows) {
          if (a.report_number_id == null) continue;
          const group = byReport.get(a.report_number_id) ?? [];
          group.push(a);
          byReport.set(a.report_number_id, group);
        }
        const orderedReports = reportNumbers.filter((rn) => byReport.has(rn.id));

        orderedReports.forEach((rn, index) => {
          // fixes33 §7.2: every distinct report number starts on its own
          // page — not just when its content would overflow — except the
          // first, which continues right after the title/notes block.
          if (index > 0) {
            doc.addPage();
            y = PDF_CONTENT_TOP;
          } else if (y + 48 > bottom) {
            doc.addPage();
            y = PDF_CONTENT_TOP;
          }
          const startPage = doc.getCurrentPageInfo().pageNumber;
          doc.setFont(HEBREW_FONT, "bold");
          doc.setFontSize(14);
          doc.text(
            `${t("apartments.report_number_id", "מספר דוח")}: ${rn.name}`,
            pageW - MARGIN,
            y + 6,
            { align: "right" },
          );
          y += 22;
          renderBuildingTables(byReport.get(rn.id)!);
          y += 6;
          reportPageRanges.push({
            label: rn.name,
            startPage,
            endPage: doc.getCurrentPageInfo().pageNumber,
          });
        });
      } else {
        // fixes30 §3: hand-picked apartments — building groups only, and rows
        // without a report number are included too.
        renderBuildingTables(rows);
      }

      // fixes26 §1: stamp the org name + logo header onto every page.
      drawPdfHeaders(doc, MARGIN, user?.organization?.name ?? "", headerLogo);

      const totalPages = doc.getNumberOfPages();
      const drawFooter = (p: number, label: string, page: number, total: number) => {
        doc.setPage(p);
        doc.setFont(HEBREW_FONT, "normal");
        doc.setFontSize(8);
        doc.setTextColor(120, 120, 120);
        doc.text(
          t("reports.pdf_footer", "דוח #{id} · עמוד {page} מתוך {total}")
            .replace("{id}", label)
            .replace("{page}", String(page))
            .replace("{total}", String(total)),
          pageW / 2,
          pageH - 16,
          { align: "center" },
        );
        doc.setTextColor(0, 0, 0);
      };

      if (mode === "reports" && reportPageRanges.length > 0) {
        // fixes61 §4: page numbers reset per report id ("Report #100 - Page
        // 1 of 2") instead of counting across the whole multi-report batch.
        for (const range of reportPageRanges) {
          const totalInReport = range.endPage - range.startPage + 1;
          for (let p = range.startPage; p <= range.endPage; p += 1) {
            drawFooter(p, range.label, p - range.startPage + 1, totalInReport);
          }
        }
      } else {
        // fixes60 §8: hand-picked-apartments mode has no report id to scope
        // to — a single counter across the whole document, as before.
        const reportShortId = String(Date.now()).slice(-6);
        for (let p = 1; p <= totalPages; p += 1) {
          drawFooter(p, reportShortId, p, totalPages);
        }
      }

      doc.save(`apartments-report-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (err) {
      toastError(
        err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"),
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-muted-foreground">{t("action.loading", "טוען…")}</p>;

  const nothingSelected =
    mode === "reports"
      ? selectedIds.length === 0
      : mode === "apartments"
        ? selectedAptIds.length === 0
        : false;

  return (
    <div className="space-y-5 max-w-4xl">
      {/* fixes39 §4: one permanent, explicit Save button for every input on
          this page (notes, column config, source-mode/selection) — visible
          confirmation instead of relying on an invisible background
          autosave, or on remembering to click Generate PDF first. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{t("reports.create_reports", "יצירת דוחות")}</h1>
        <Button type="button" size="sm" onClick={saveReportPage} disabled={savingReport}>
          {savingReport ? t("action.saving", "שומר…") : t("action.save", "שמור")}
        </Button>
      </div>

      {/* fixes38 §4.1: report description moved here from the global Settings
          page — admin-only edit, same org-wide report_notes field. */}
      {isAdmin && (
        <div className="bg-card rounded-xl shadow-sm p-5 space-y-2">
          <span className="block text-sm font-medium">
            {t("settings.report_notes", "הערות לדוח")}
          </span>
          <textarea
            className="w-full rounded-md border border-input px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            rows={3}
            value={reportNotes}
            onChange={(e) => {
              setReportNotes(e.target.value);
              setNotesDirty(true);
            }}
            placeholder={t(
              "settings.report_notes_hint",
              "טקסט חופשי שיופיע בראש כל דוח שמופק (הבהרה, כותרת, הערת שוליים...)",
            )}
          />
        </div>
      )}

      {/* fixes38 §4.2/§4.3/§4.4, fixes40 §5: column selection + reorder +
          custom subheadings + width percentages, persisted per user. The
          selection/reorder panel is now the exact chip pattern the
          Apartments page's own "Customize Fields" panel uses (fixes39 §3's
          SortableJS + ▲/▼ fallback), over the same expanded column set. */}
      {/* fixes42 §2: Row 2 — this card is mostly explanatory/helper text
          (reorder hint, width total, over-100% validation) wrapped around
          the controls, so it gets a light grey background to visually set
          it apart from the other cards on the page. */}
      <div className="bg-muted rounded-xl shadow-sm p-5 space-y-3">
        <h2 className="text-sm font-semibold">
          {t("reports.column_config_title", "עמודות הדוח")}
        </h2>
        <p className="text-xs text-muted-foreground">
          {t("columns.reorder_hint", "גרור עמודה פעילה כדי לשנות את סדר ההצגה.")}
        </p>
        <div ref={reportColumnsSortableRef} className="flex flex-wrap gap-2">
          {activeReportColumns.map((k) => {
            const activeIdx = activeReportColumns.indexOf(k);
            return (
              <span key={k} data-sort-key={k} className="inline-flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={withColumnClickGuard(() => toggleReportColumn(k))}
                  className="rounded-md border px-3 py-1.5 text-sm border-primary bg-primary/10 text-primary cursor-grab active:cursor-grabbing"
                >
                  ⠿ {columnLabel(k)}
                </button>
                <span className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    disabled={activeIdx === 0}
                    onClick={() => moveActiveReportColumn(k, -1)}
                    title={t("action.move_up", "העלה")}
                    className="flex items-center justify-center w-7 h-7 rounded text-sm leading-none text-muted-foreground hover:text-primary hover:bg-accent active:bg-muted disabled:opacity-20"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    disabled={activeIdx === activeReportColumns.length - 1}
                    onClick={() => moveActiveReportColumn(k, 1)}
                    title={t("action.move_down", "הורד")}
                    className="flex items-center justify-center w-7 h-7 rounded text-sm leading-none text-muted-foreground hover:text-primary hover:bg-accent active:bg-muted disabled:opacity-20"
                  >
                    ▼
                  </button>
                </span>
              </span>
            );
          })}
          {allColumnKeys.filter((k) => !activeReportColumns.includes(k)).map((k) => (
            <button
              key={k}
              type="button"
              data-sort-key={k}
              data-sortable-disabled=""
              onClick={() => toggleReportColumn(k)}
              className="rounded-md border px-3 py-1.5 text-sm border-border text-muted-foreground hover:bg-accent"
            >
              {columnLabel(k)}
            </button>
          ))}
        </div>

        {/* fixes40 §5: subheading + width-% detail, one row per *active*
            column, in the chip panel's live order — a report-specific
            concept the Apartments page has no equivalent of. */}
        <div className="overflow-x-auto pt-2">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground text-start">
              <tr>
                <th className="py-1 pe-3 font-medium">{t("columns.title", "עמודות מוצגות")}</th>
                <th className="py-1 pe-3 font-medium">
                  {t("reports.column_subheading", "כותרת משנה")}
                </th>
                <th className="py-1 font-medium">{t("reports.column_width", "רוחב (%)")}</th>
              </tr>
            </thead>
            <tbody>
              {activeReportColumns.map((k) => (
                <tr key={k} className="border-t border-border">
                  <td className="py-1.5 pe-3">{columnLabel(k)}</td>
                  <td className="py-1.5 pe-3">
                    <input
                      type="text"
                      className="w-full rounded-md border border-input px-2 py-1 text-sm"
                      value={reportColumns.subheadings[k] ?? ""}
                      onChange={(e) => setReportSubheading(k, e.target.value)}
                    />
                  </td>
                  <td className="py-1.5">
                    <input
                      type="number"
                      dir="ltr"
                      min={0}
                      max={100}
                      className="w-20 rounded-md border border-input px-2 py-1 text-sm"
                      value={reportColumns.widths[k] ?? 0}
                      onChange={(e) => setReportWidth(k, Number(e.target.value))}
                    />
                  </td>
                </tr>
              ))}
              {activeReportColumns.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-muted-foreground">
                    {t("reports.no_columns_selected", "לא נבחרו עמודות")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className={`text-sm ${widthOverLimit ? "text-status-darkred font-medium" : "text-muted-foreground"}`}>
          {t("reports.column_width_total", "סך הכל: {n}%").replace("{n}", String(totalReportWidth))}
        </p>
        {/* fixes38 §4.3: bilingual validation message via the usual t() mechanism. */}
        {widthOverLimit && (
          <p className="text-sm text-status-darkred">
            {t(
              "validation.report_width_over_100",
              "סך הרוחב של העמודות אינו יכול להיות יותר ממאה אחוז",
            )}
          </p>
        )}
      </div>

      <div className="bg-card rounded-xl shadow-sm p-5 space-y-4">
        {/* fixes33 §3.2: opened from the Apartments page's filtered list — the
            filters themselves drove navigation here, so there's nothing to
            pick; the reports/apartments radio picker doesn't apply. */}
        {mode === "filters" ? (
          <p className="text-sm text-muted-foreground">
            {t(
              "reports.mode_by_filters",
              "לפי סינון נוכחי",
            )}
            {" — "}
            {t(
              "reports.filters_mode_hint",
              "הדוח יופק מהדירות התואמות לסינון שהוגדר בעמוד הדירות.",
            )}
          </p>
        ) : (
          <>
        {/* fixes30 §3: source mode. */}
        <div className="flex flex-wrap items-center gap-4 text-sm">
          {(
            [
              ["reports", t("reports.mode_by_report", "לפי מספרי דוח")],
              ["apartments", t("reports.mode_by_apartments", "לפי בחירת דירות")],
            ] as [ReportMode, string][]
          ).map(([m, label]) => (
            <label key={m} className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="report-mode"
                className="accent-primary"
                checked={mode === m}
                onChange={() => {
                  setMode(m);
                  setNoData(false);
                }}
              />
              {label}
            </label>
          ))}
        </div>

        {mode === "reports" ? (
          <label className="block space-y-1">
            <span className="block text-sm font-medium">
              {t("reports.report_numbers", "מספרי דוחות")}
            </span>
            <MultiSelectSearchFilter
              className="w-full max-w-sm"
              allLabel={t("reports.select_reports_placeholder", "בחר מספר דוח אחד או יותר")}
              options={reportNumbers.map((rn) => ({ id: rn.id, label: rn.name }))}
              value={selectedIds}
              onChange={(ids) => {
                setSelectedIds(ids);
                setNoData(false);
              }}
              searchPlaceholder={t("filter.search_report_numbers", "חיפוש מספר דוח…")}
            />
          </label>
        ) : (
          <label className="block space-y-1">
            <span className="block text-sm font-medium">
              {t("apartments", "דירות")}
            </span>
            {apartmentOptions === null ? (
              <p className="text-sm text-muted-foreground">{t("action.loading", "טוען…")}</p>
            ) : (
              <MultiSelectSearchFilter
                className="w-full max-w-sm"
                allLabel={t(
                  "reports.select_apartments_placeholder",
                  "בחר דירה אחת או יותר",
                )}
                options={apartmentOptions.map((a) => ({
                  id: a.id,
                  label: `${apartmentTitle(a)} — ${buildingDisplayName({
                    id: a.building_id,
                    building_name: a.building_name,
                    building_address: a.building_address,
                  })}`,
                }))}
                value={selectedAptIds}
                onChange={(ids) => {
                  setSelectedAptIds(ids);
                  setNoData(false);
                }}
                searchPlaceholder={t("filter.search_apartments", "חיפוש דירה…")}
              />
            )}
          </label>
        )}
          </>
        )}

        {noData && (
          <p className="text-sm text-status-darkred">
            {t("reports.no_data", "לא נמצאו נתונים עבור הדוחות שנבחרו")}
          </p>
        )}

        <Button
          type="button"
          onClick={generatePdf}
          disabled={busy || nothingSelected || activeReportColumns.length === 0 || widthOverLimit}
        >
          {busy ? t("action.loading", "טוען…") : t("reports.generate_pdf", "הפק דוח PDF")}
        </Button>
      </div>
    </div>
  );
}

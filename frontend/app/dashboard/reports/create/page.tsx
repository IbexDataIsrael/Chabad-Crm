"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { MultiSelectSearchFilter } from "@/components/ui/MultiSelectSearchFilter";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import {
  drawPdfHeaders,
  loadHeaderLogo,
  prepareHebrewPdf,
  HEBREW_FONT,
  PDF_CONTENT_TOP,
} from "@/lib/pdfRtl";
import { displayPicklistValue } from "@/lib/picklists";
import { useDbPreference } from "@/lib/preferences";
import { useToast } from "@/lib/toast";
import {
  apartmentTitle,
  buildingDisplayName,
  type ApartmentListItem,
  type ApartmentPage,
  type PicklistValue,
  type ReportNumber,
} from "@/lib/types";

/** PDF geometry (A4 portrait, points). */
const MARGIN = 40;
const CELL_PADDING = 4;

// fixes38 §4.2/§4.3/§4.4: which of the 6 fixed logical columns render, each
// with an optional custom subheading and a target width percentage. Persisted
// per-user via the existing DB-preference mechanism (no backend model needed
// — mirrors how Contacts/Apartments already persist column selections).
const REPORT_COLUMN_KEYS = [
  "floor",
  "apartment_name",
  "jewish_status",
  "mezuzah_status",
  "language",
  "apartment_notes",
] as const;
type ReportColumnKey = (typeof REPORT_COLUMN_KEYS)[number];

interface ReportColumnConfig {
  columns: ReportColumnKey[];
  subheadings: Partial<Record<ReportColumnKey, string>>;
  widths: Partial<Record<ReportColumnKey, number>>;
}

// Default widths sum to 100 and roughly mirror the previous fixed pixel
// widths' proportions (50, 70, 85, 75, 70, 160 of 510pt total).
const DEFAULT_REPORT_COLUMNS: ReportColumnConfig = {
  columns: [...REPORT_COLUMN_KEYS],
  subheadings: {},
  widths: {
    floor: 10,
    apartment_name: 14,
    jewish_status: 17,
    mezuzah_status: 15,
    language: 14,
    apartment_notes: 30,
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
    <Suspense fallback={<p className="text-gray-400">…</p>}>
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

  // fixes38 §4.2: which of the 6 columns are active, in their fixed logical
  // order (the spec asks only for inclusion, not reordering).
  const activeReportColumns = REPORT_COLUMN_KEYS.filter((k) =>
    reportColumns.columns.includes(k),
  );
  const columnLabels: Record<ReportColumnKey, string> = {
    floor: t("reports.floor", "קומה"),
    apartment_name: t("reports.apartment_name", "מספר דירה"),
    jewish_status: t("reports.jewish_status", "מצב יהדות"),
    mezuzah_status: t("reports.mezuzah_status", "מזוזה"),
    language: t("reports.language", "שפה"),
    apartment_notes: t("reports.apartment_notes", "הערות"),
  };
  const totalReportWidth = activeReportColumns.reduce(
    (sum, k) => sum + (reportColumns.widths[k] ?? 0), 0,
  );
  // fixes38 §4.3: sum of active column widths must not exceed 100%.
  const widthOverLimit = totalReportWidth > 100;

  function toggleReportColumn(k: ReportColumnKey) {
    setReportColumns((prev) => ({
      ...prev,
      columns: prev.columns.includes(k)
        ? prev.columns.filter((c) => c !== k)
        : [...prev.columns, k],
    }));
  }

  function setReportSubheading(k: ReportColumnKey, value: string) {
    setReportColumns((prev) => ({
      ...prev,
      subheadings: { ...prev.subheadings, [k]: value },
    }));
  }

  function setReportWidth(k: ReportColumnKey, value: number) {
    setReportColumns((prev) => ({
      ...prev,
      widths: { ...prev.widths, [k]: value },
    }));
  }

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
      const [jewish, mezuzah, language, headerLogo] = await Promise.all([
        apiFetch<PicklistValue[]>("/api/picklists/apartment.Jewish_status"),
        apiFetch<PicklistValue[]>("/api/picklists/apartment.mezuzah_status"),
        apiFetch<PicklistValue[]>("/api/picklists/apartment.language"),
        loadHeaderLogo(user?.organization?.logo_url),
      ]);
      const labelFor = (opts: PicklistValue[], value: string | null): string => {
        if (value == null) return "";
        const o = opts.find((opt) => opt.value === value);
        return o ? displayPicklistValue(o, lang) : value;
      };

      const { jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      // Hebrew font + logical-order bidi on every text call (lib/pdfRtl.ts) —
      // all strings below are plain logical text.
      await prepareHebrewPdf(doc);
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const bottom = pageH - MARGIN;

      // fixes38 §4.2: only the user's selected columns render, in their fixed
      // logical order; a subheading (if set) renders as a second line via
      // "\n" — jspdf-autotable wraps multi-line header/body strings natively.
      const rowValueFor = (a: ApartmentListItem, k: ReportColumnKey): string => {
        switch (k) {
          case "floor":
            return a.floor ?? "";
          case "apartment_name":
            return a.apartment_name ?? "";
          case "jewish_status":
            return labelFor(jewish, a.jewish_status);
          case "mezuzah_status":
            return labelFor(mezuzah, a.mezuzah_status);
          case "language":
            return labelFor(language, a.language);
          case "apartment_notes":
            return a.apartment_notes ?? "";
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
      const logicalHeads = activeReportColumns.map((k) => {
        const subheading = reportColumns.subheadings[k]?.trim();
        return subheading ? `${columnLabels[k]}\n${subheading}` : columnLabels[k];
      });
      const head = [...logicalHeads].reverse();
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
        const buildingKeys = [...byBuilding.keys()].sort((a, b) =>
          a.localeCompare(b, "he"),
        );

        for (const buildingKey of buildingKeys) {
          if (y + 60 > bottom) {
            doc.addPage();
            y = PDF_CONTENT_TOP;
          }
          doc.setFont(HEBREW_FONT, "bold");
          doc.setFontSize(12);
          doc.text(buildingKey, pageW - MARGIN, y + 4, { align: "right" });
          y += 12;

          const body = byBuilding.get(buildingKey)!.map((a) =>
            activeReportColumns.map((k) => rowValueFor(a, k)).reverse(),
          );

          autoTable(doc, {
            startY: y,
            // top must clear the per-page org header on flowed pages (fixes26 §1).
            margin: { left: MARGIN, right: MARGIN, top: PDF_CONTENT_TOP, bottom: MARGIN },
            // Explicit total width — with 'auto' this autotable version logs a
            // spurious "content width could not fit page" warning.
            tableWidth: logicalWidths.reduce((a, b) => a + b, 0),
            head: [head],
            body,
            theme: "grid",
            styles: {
              font: HEBREW_FONT,
              fontSize: 10,
              halign: "right",
              valign: "top",
              cellPadding: CELL_PADDING,
            },
            headStyles: {
              fontStyle: "bold",
              fillColor: [55, 65, 81],
              textColor: 255,
              halign: "right",
            },
            columnStyles,
          });
          y =
            (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable
              .finalY + 16;
        }
      };

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
        });
      } else {
        // fixes30 §3: hand-picked apartments — building groups only, and rows
        // without a report number are included too.
        renderBuildingTables(rows);
      }

      // fixes26 §1: stamp the org name + logo header onto every page.
      drawPdfHeaders(doc, MARGIN, user?.organization?.name ?? "", headerLogo);

      doc.save(`apartments-report-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (err) {
      toastError(
        err instanceof Error ? err.message : t("msg.save_failed", "שמירה נכשלה"),
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-gray-400">{t("action.loading", "טוען…")}</p>;

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
        <button
          type="button"
          onClick={saveReportPage}
          disabled={savingReport}
          className="rounded-md bg-status-magenta text-white px-4 py-1.5 text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {savingReport ? t("action.saving", "שומר…") : t("action.save", "שמור")}
        </button>
      </div>

      {/* fixes38 §4.1: report description moved here from the global Settings
          page — admin-only edit, same org-wide report_notes field. */}
      {isAdmin && (
        <div className="bg-white rounded-xl shadow-sm p-5 space-y-2">
          <span className="block text-sm font-medium">
            {t("settings.report_notes", "הערות לדוח")}
          </span>
          <textarea
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-status-magenta focus:outline-none focus:ring-1 focus:ring-status-magenta"
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

      {/* fixes38 §4.2/§4.3/§4.4: column selection + custom subheadings + width
          percentages, persisted per user and reused on the next visit. */}
      <div className="bg-white rounded-xl shadow-sm p-5 space-y-3">
        <h2 className="text-sm font-semibold">
          {t("reports.column_config_title", "עמודות הדוח")}
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-gray-500 text-start">
              <tr>
                <th className="py-1 pe-3 font-medium">{t("columns.title", "עמודות מוצגות")}</th>
                <th className="py-1 pe-3 font-medium">
                  {t("reports.column_subheading", "כותרת משנה")}
                </th>
                <th className="py-1 font-medium">{t("reports.column_width", "רוחב (%)")}</th>
              </tr>
            </thead>
            <tbody>
              {REPORT_COLUMN_KEYS.map((k) => {
                const on = reportColumns.columns.includes(k);
                return (
                  <tr key={k} className="border-t border-gray-100">
                    <td className="py-1.5 pe-3">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          className="accent-status-magenta"
                          checked={on}
                          onChange={() => toggleReportColumn(k)}
                        />
                        {columnLabels[k]}
                      </label>
                    </td>
                    <td className="py-1.5 pe-3">
                      <input
                        type="text"
                        disabled={!on}
                        className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm disabled:bg-gray-50 disabled:text-gray-300"
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
                        disabled={!on}
                        className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm disabled:bg-gray-50 disabled:text-gray-300"
                        value={reportColumns.widths[k] ?? 0}
                        onChange={(e) => setReportWidth(k, Number(e.target.value))}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className={`text-sm ${widthOverLimit ? "text-status-darkred font-medium" : "text-gray-500"}`}>
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

      <div className="bg-white rounded-xl shadow-sm p-5 space-y-4">
        {/* fixes33 §3.2: opened from the Apartments page's filtered list — the
            filters themselves drove navigation here, so there's nothing to
            pick; the reports/apartments radio picker doesn't apply. */}
        {mode === "filters" ? (
          <p className="text-sm text-gray-600">
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
                className="accent-status-magenta"
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
              <p className="text-sm text-gray-400">{t("action.loading", "טוען…")}</p>
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

        <button
          type="button"
          onClick={generatePdf}
          disabled={busy || nothingSelected || activeReportColumns.length === 0 || widthOverLimit}
          className="rounded-md bg-status-magenta text-white px-5 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? t("action.loading", "טוען…") : t("reports.generate_pdf", "הפק דוח PDF")}
        </button>
      </div>
    </div>
  );
}

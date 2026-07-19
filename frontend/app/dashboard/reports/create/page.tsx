"use client";

import { useEffect, useState } from "react";

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
// Logical column order per the spec: floor, apartment number, Jewish status,
// mezuzah, language, notes. Notes takes the rest of the usable ~515pt.
const COLUMN_WIDTHS = [50, 70, 85, 75, 70, 160];

/** fixes30 §3: the page offers two source modes — the classic report-number
 *  selection, or an arbitrary hand-picked set of apartments. */
type ReportMode = "reports" | "apartments";

export default function CreateReportsPage() {
  const { loading, user } = useAuth();
  const { t, lang } = useLocalization();
  const { error: toastError } = useToast();
  const [mode, setMode] = useState<ReportMode>("reports");
  const [reportNumbers, setReportNumbers] = useState<ReportNumber[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  // fixes30 §3: the direct-selection option pool + chosen apartment ids.
  const [apartmentOptions, setApartmentOptions] = useState<ApartmentListItem[] | null>(null);
  const [selectedAptIds, setSelectedAptIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [noData, setNoData] = useState(false);

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
      mode === "reports" ? selectedIds.length === 0 : selectedAptIds.length === 0;
    if (nothingSelected || busy) return;
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
          : await fetchAllPages((params) =>
              selectedAptIds.forEach((id) =>
                params.append("apartment_ids", String(id)),
              ),
            );
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

      // Visual order is the reverse of the logical (RTL) column order —
      // autotable lays columns out left-to-right, so קומה must come last to
      // land rightmost.
      const logicalHeads = [
        t("reports.floor", "קומה"),
        t("reports.apartment_name", "מספר דירה"),
        t("reports.jewish_status", "מצב יהדות"),
        t("reports.mezuzah_status", "מזוזה"),
        t("reports.language", "שפה"),
        t("reports.apartment_notes", "הערות"),
      ];
      const head = [...logicalHeads].reverse();
      const visualWidths = [...COLUMN_WIDTHS].reverse();
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
            [
              a.floor ?? "",
              a.apartment_name ?? "",
              labelFor(jewish, a.jewish_status),
              labelFor(mezuzah, a.mezuzah_status),
              labelFor(language, a.language),
              a.apartment_notes ?? "",
            ].reverse(),
          );

          autoTable(doc, {
            startY: y,
            // top must clear the per-page org header on flowed pages (fixes26 §1).
            margin: { left: MARGIN, right: MARGIN, top: PDF_CONTENT_TOP, bottom: MARGIN },
            // Explicit total width — with 'auto' this autotable version logs a
            // spurious "content width could not fit page" warning.
            tableWidth: COLUMN_WIDTHS.reduce((a, b) => a + b, 0),
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

        for (const rn of orderedReports) {
          if (y + 48 > bottom) {
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
        }
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
    mode === "reports" ? selectedIds.length === 0 : selectedAptIds.length === 0;

  return (
    <div className="space-y-5 max-w-2xl">
      <h1 className="text-2xl font-bold">{t("reports.create_reports", "יצירת דוחות")}</h1>

      <div className="bg-white rounded-xl shadow-sm p-5 space-y-4">
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

        {noData && (
          <p className="text-sm text-status-darkred">
            {t("reports.no_data", "לא נמצאו נתונים עבור הדוחות שנבחרו")}
          </p>
        )}

        <button
          type="button"
          onClick={generatePdf}
          disabled={busy || nothingSelected}
          className="rounded-md bg-status-magenta text-white px-5 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? t("action.loading", "טוען…") : t("reports.generate_pdf", "הפק דוח PDF")}
        </button>
      </div>
    </div>
  );
}

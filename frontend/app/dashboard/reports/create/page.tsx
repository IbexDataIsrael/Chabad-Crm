"use client";

import { useEffect, useState } from "react";

import { MultiSelectSearchFilter } from "@/components/ui/MultiSelectSearchFilter";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLocalization } from "@/lib/localization";
import { HEBREW_FONT, prepareHebrewPdf } from "@/lib/pdfRtl";
import { displayPicklistValue } from "@/lib/picklists";
import { useToast } from "@/lib/toast";
import {
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

export default function CreateReportsPage() {
  const { loading } = useAuth();
  const { t, lang } = useLocalization();
  const { error: toastError } = useToast();
  const [reportNumbers, setReportNumbers] = useState<ReportNumber[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [noData, setNoData] = useState(false);

  useEffect(() => {
    if (loading) return;
    apiFetch<ReportNumber[]>("/api/report-numbers")
      .then(setReportNumbers)
      .catch(() => setReportNumbers([]));
  }, [loading]);

  /** Every active apartment linked to the selected report numbers, in the
   *  canonical floor order (the /list endpoint already restricts to
   *  is_display=true and applies role scoping). */
  async function fetchAllApartments(ids: number[]): Promise<ApartmentListItem[]> {
    const all: ApartmentListItem[] = [];
    for (let page = 1; ; page += 1) {
      const params = new URLSearchParams();
      ids.forEach((id) => params.append("report_number_ids", String(id)));
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

  async function generatePdf() {
    if (selectedIds.length === 0 || busy) return;
    setBusy(true);
    setNoData(false);
    try {
      const rows = await fetchAllApartments(selectedIds);
      if (rows.length === 0) {
        setNoData(true);
        return;
      }

      // Picklist labels are fetched here (not via usePicklist) so a fast
      // click right after page load can't produce raw technical values.
      const [jewish, mezuzah, language] = await Promise.all(
        [
          "apartment.Jewish_status",
          "apartment.mezuzah_status",
          "apartment.language",
        ].map((key) => apiFetch<PicklistValue[]>(`/api/picklists/${key}`)),
      );
      const labelFor = (opts: PicklistValue[], value: string | null): string => {
        if (value == null) return "";
        const o = opts.find((opt) => opt.value === value);
        return o ? displayPicklistValue(o, lang) : value;
      };

      // Group by report number (picker order = name order), then by the
      // building's cleaned "street + number" display string.
      const byReport = new Map<number, ApartmentListItem[]>();
      for (const a of rows) {
        if (a.report_number_id == null) continue;
        const group = byReport.get(a.report_number_id) ?? [];
        group.push(a);
        byReport.set(a.report_number_id, group);
      }
      const orderedReports = reportNumbers.filter((rn) => byReport.has(rn.id));

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

      let y = MARGIN;
      doc.setFont(HEBREW_FONT, "bold");
      doc.setFontSize(18);
      doc.text(t("reports.pdf_title", "דוח ריכוז דירות"), pageW - MARGIN, y + 8, {
        align: "right",
      });
      y += 34;

      for (const rn of orderedReports) {
        const group = byReport.get(rn.id)!;
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

        if (y + 48 > bottom) {
          doc.addPage();
          y = MARGIN;
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

        for (const buildingKey of buildingKeys) {
          if (y + 60 > bottom) {
            doc.addPage();
            y = MARGIN;
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
            margin: { left: MARGIN, right: MARGIN, top: MARGIN, bottom: MARGIN },
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
        y += 6;
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

  if (loading) return <p className="text-gray-400">{t("action.loading", "טוען…")}</p>;

  return (
    <div className="space-y-5 max-w-2xl">
      <h1 className="text-2xl font-bold">{t("reports.create_reports", "יצירת דוחות")}</h1>

      <div className="bg-white rounded-xl shadow-sm p-5 space-y-4">
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

        {noData && (
          <p className="text-sm text-status-darkred">
            {t("reports.no_data", "לא נמצאו נתונים עבור הדוחות שנבחרו")}
          </p>
        )}

        <button
          type="button"
          onClick={generatePdf}
          disabled={busy || selectedIds.length === 0}
          className="rounded-md bg-status-magenta text-white px-5 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? t("action.loading", "טוען…") : t("reports.generate_pdf", "הפק דוח PDF")}
        </button>
      </div>
    </div>
  );
}

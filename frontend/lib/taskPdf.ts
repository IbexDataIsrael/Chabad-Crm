import { apiFetch } from "@/lib/api";
import { naturalCompare } from "@/lib/naturalSort";
import {
  drawPdfHeaders,
  HEBREW_FONT,
  loadHeaderLogo,
  PDF_CONTENT_TOP,
  prepareHebrewPdf,
} from "@/lib/pdfRtl";
import { displayPicklistValue } from "@/lib/picklists";
import {
  DEFAULT_COLUMN_WIDTH,
  DEFAULT_TASK_SHEET_FIELDS,
  printableColumns,
  type TaskSheetColumn,
  type TaskSheetFieldsConfig,
} from "@/lib/taskSheetFields";
import { buildingDisplayName, type TaskPrintApartment, type TaskPrintData } from "@/lib/types";
import type { PicklistValue } from "@/lib/types";
import type { Lang } from "@/lib/localization";

/**
 * fixes65 §3: a printable task sheet — the field worksheet an activist
 * carries door to door and fills in by hand. Reuses the apartments report's
 * Hebrew PDF plumbing (lib/pdfRtl.ts: Alef font, logical-order bidi, org
 * header), laid out for plain black-and-white office printers: white cells,
 * solid black rules, no grey fills or zebra striping, tall rows to write in.
 *
 * Every page carries the task's signed QR (fixes66 §1). On an unassigned
 * (orphan) task it claims the task (quick registration binds it
 * automatically); on an assigned task the same link is the activist's door
 * into the system — they sign in and land on their task.
 */

const MARGIN = 36;
const QR_SIZE = 66;
const BLACK: [number, number, number] = [0, 0, 0];
const WHITE: [number, number, number] = [255, 255, 255];

type Translate = (key: string, fallback: string) => string;

export async function generateTaskPdf(opts: {
  data: TaskPrintData;
  orgName: string;
  orgLogoUrl: string | null | undefined;
  claimBaseUrl: string;
  t: Translate;
  lang: Lang;
  fields?: TaskSheetFieldsConfig;
  /** fixes74 §9: the columns this org may print (hidden fields excluded). */
  catalog: TaskSheetColumn[];
}): Promise<void> {
  const { data, orgName, orgLogoUrl, claimBaseUrl, t, lang, catalog } = opts;
  const fields = opts.fields ?? DEFAULT_TASK_SHEET_FIELDS;
  const { task } = data;
  // fixes74 §8: column/text direction follows the selected UI language —
  // Hebrew right-to-left, English left-to-right (it used to always be RTL).
  const rtl = lang !== "en";
  const align = rtl ? "right" : "left";
  const columns = printableColumns(fields, catalog);
  const customPicklistKeys = columns
    .filter((c) => c.key.startsWith("picklist:"))
    .map((c) => c.key.slice("picklist:".length));

  // fixes69 §Admin3a: whatever's already on file prints in the box instead of
  // a blank one — same "fetch labels imperatively, not via a hook" reasoning
  // as the apartments report's PDF (a fast click right after page load must
  // never print a raw technical value).
  const [
    { jsPDF },
    { default: autoTable },
    headerLogo,
    jewishOpts,
    mezuzahOpts,
    languageOpts,
    campaignOpts,
    ...customOpts
  ] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
    loadHeaderLogo(orgLogoUrl),
    apiFetch<PicklistValue[]>("/api/picklists/apartment.Jewish_status"),
    apiFetch<PicklistValue[]>("/api/picklists/apartment.mezuzah_status"),
    apiFetch<PicklistValue[]>("/api/picklists/apartment.language"),
    apiFetch<PicklistValue[]>("/api/picklists/apartment.campaign_status"),
    ...customPicklistKeys.map((k) =>
      apiFetch<PicklistValue[]>(`/api/picklists/${encodeURIComponent(k)}`).catch(() => []),
    ),
  ]);
  const customOptsByKey = new Map(customPicklistKeys.map((k, i) => [k, customOpts[i] ?? []]));
  const labelFor = (options: PicklistValue[], value: string | null): string => {
    if (value == null) return "";
    const o = options.find((opt) => opt.value === value);
    return o ? displayPicklistValue(o, lang) : value;
  };
  let qrDataUrl: string | null = null;
  const claimUrl = data.claim_token ? `${claimBaseUrl}/tasks/claim/${data.claim_token}` : null;
  if (claimUrl) {
    const QRCode = (await import("qrcode")).default;
    qrDataUrl = await QRCode.toDataURL(claimUrl, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 320,
      color: { dark: "#000000", light: "#ffffff" },
    });
  }

  const assigned = Boolean(task.volunteer_user_id);
  const qrCaption = assigned
    ? t("task_pdf.qr_caption_assigned", "סרקו את הקוד כדי להיכנס למערכת")
    : t("task_pdf.qr_caption", "סרקו את הקוד כדי לקחת את המשימה");
  const qrSubcaption = assigned
    ? t("task_pdf.qr_subcaption_assigned", "התחברו לחשבון שלכם והמשימה תיפתח לפניכם")
    : t("task_pdf.qr_subcaption", "הרשמה מהירה, והמשימה משויכת אליכם אוטומטית");

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  await prepareHebrewPdf(doc);
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  // Room at the bottom of every page for the QR strip (or just the footer).
  const bottomReserve = qrDataUrl ? QR_SIZE + 30 : 34;
  const right = pageW - MARGIN;
  // The "start" edge text anchors to: right in Hebrew, left in English.
  const start = rtl ? right : MARGIN;

  // --- Title block ---------------------------------------------------------
  let y = PDF_CONTENT_TOP;
  doc.setTextColor(...BLACK);
  doc.setFont(HEBREW_FONT, "bold");
  doc.setFontSize(18);
  doc.text(
    `${t("task_pdf.title", "דף משימה")} #${task.id} — ${task.campaign_name}`,
    start,
    y + 8,
    { align },
  );
  doc.setLineWidth(1.4);
  doc.setDrawColor(...BLACK);
  doc.line(MARGIN, y + 16, right, y + 16);
  y += 34;

  doc.setFontSize(11);
  const facts: [string, string][] = [
    [
      t("task.volunteer", "פעיל"),
      task.volunteer_user_id
        ? task.volunteer_name
        : t("task_pdf.unassigned", "טרם שויך — לסריקת הקוד בתחתית הדף"),
    ],
    [t("task.report_numbers", "מספרי דוח"), task.report_number_names.join(", ") || "—"],
    [t("task_pdf.apartment_count", "מספר דירות"), String(data.apartments.length)],
  ];
  for (const [label, value] of facts) {
    doc.setFont(HEBREW_FONT, "bold");
    doc.text(`${label}:`, start, y, { align });
    const labelW = doc.getTextWidth(`${label}: `);
    doc.setFont(HEBREW_FONT, "normal");
    doc.text(value, rtl ? right - labelW : MARGIN + labelW, y, { align });
    y += 16;
  }
  // Performer line — the office copies this into "who performed the work?".
  doc.setFont(HEBREW_FONT, "bold");
  const performedLabel = `${t("task_pdf.performed_by", "בוצע על ידי (שם מלא)")}:`;
  doc.text(performedLabel, start, y + 4, { align });
  doc.setLineWidth(0.8);
  const performedW = doc.getTextWidth(performedLabel) + 8;
  if (rtl) doc.line(MARGIN + 150, y + 6, right - performedW, y + 6);
  else doc.line(MARGIN + performedW, y + 6, right - 150, y + 6);
  y += 24;

  // --- One continuous table for the whole sheet -----------------------------
  // fixes69 §Admin3b: a separate autoTable() call per building repeated the
  // column header at every building's own start, not just once per physical
  // page (5x on one real printed page). One continuous table lets autotable
  // repeat the head on page breaks it manages itself; each building/report
  // group becomes a full-width divider row inside the same table's body
  // instead of a table of its own.
  // fixes69 §Admin3c/3d/3e: which columns print, their order and their
  // width are all admin-configurable now (lib/taskSheetFields.ts) instead of
  // a fixed 7-column layout.
  // fixes74 §9: any admin-chosen apartment/report column, in the chosen
  // order and relative widths (hidden fields never reach this list).
  const head = columns.map((c) => c.label);
  const usable = pageW - MARGIN * 2;
  const widthOf = (key: string) => {
    const w = fields.widths[key];
    return w != null && w > 0 ? w : DEFAULT_COLUMN_WIDTH;
  };
  const totalWidthPct = columns.reduce((sum, c) => sum + widthOf(c.key), 0) || 100;
  const logicalWidths = columns.map((c) => (widthOf(c.key) / totalWidthPct) * usable);
  const formatCustom = (v: string | number | boolean | null | undefined): string => {
    if (v == null || v === "") return "";
    if (typeof v === "boolean") return v ? "✓" : "";
    return String(v);
  };
  const rowValueFor = (a: TaskPrintApartment, key: string): string => {
    if (key.startsWith("picklist:")) {
      const fk = key.slice("picklist:".length);
      return labelFor(customOptsByKey.get(fk) ?? [], a.picklist_values?.[fk] ?? null);
    }
    if (key.startsWith("custom:")) {
      return formatCustom(a.custom_field_values?.[key.slice("custom:".length)]);
    }
    switch (key) {
      case "report_number":
        return a.report_number_name ?? "";
      case "building":
        return buildingDisplayName({
          id: a.building_id,
          building_name: a.building_name,
          building_address: a.building_address,
        });
      case "area":
        return a.area_name ?? "";
      case "floor":
        return a.floor ?? "";
      case "apartment_name":
        return a.apartment_name ?? "";
      case "name":
        return a.name ?? "";
      case "phone":
        return a.phone ?? "";
      case "email":
        return a.email ?? "";
      case "jewish_status":
        return labelFor(jewishOpts, a.jewish_status);
      case "mezuzah_status":
        return labelFor(mezuzahOpts, a.mezuzah_status);
      case "campaign_status":
        return labelFor(campaignOpts, a.campaign_status);
      case "language":
        return (a.language ?? []).map((v) => labelFor(languageOpts, v)).join(", ");
      case "notes":
        return a.apartment_notes ?? "";
      default:
        return "";
    }
  };
  // autotable lays columns out left-to-right: reverse only for Hebrew (§8).
  const toVisual = <T,>(cells: T[]): T[] => (rtl ? [...cells].reverse() : cells);
  const visualHead = toVisual(head);
  const visualWidths = toVisual(logicalWidths);
  const columnStyles = Object.fromEntries(visualWidths.map((w, i) => [i, { cellWidth: w }]));

  type Cell = string | { content: string; colSpan: number; styles?: Record<string, unknown> };
  const divider = (label: string): Cell[] => [
    {
      content: label,
      colSpan: head.length,
      styles: { fontStyle: "bold", fontSize: 12, halign: align, minCellHeight: 20 },
    },
  ];

  const byReport = new Map<string, TaskPrintApartment[]>();
  for (const a of data.apartments) {
    const key = a.report_number_name ?? "";
    byReport.set(key, [...(byReport.get(key) ?? []), a]);
  }
  const reportKeys = [...byReport.keys()].sort(naturalCompare);
  const multiReport = reportKeys.length > 1;

  const body: Cell[][] = [];
  for (const rk of reportKeys) {
    const byBuilding = new Map<string, TaskPrintApartment[]>();
    for (const a of byReport.get(rk)!) {
      const bk = buildingDisplayName({
        id: a.building_id,
        building_name: a.building_name,
        building_address: a.building_address,
      });
      byBuilding.set(bk, [...(byBuilding.get(bk) ?? []), a]);
    }
    for (const bk of [...byBuilding.keys()].sort(naturalCompare)) {
      const apts = byBuilding
        .get(bk)!
        .sort(
          (a, b) =>
            naturalCompare(a.floor ?? "", b.floor ?? "") ||
            naturalCompare(a.apartment_name ?? "", b.apartment_name ?? ""),
        );
      body.push(
        divider(multiReport ? `${bk}  (${t("apartments.report_number_id", "מספר דוח")} ${rk})` : bk),
      );
      for (const a of apts) {
        body.push(toVisual(columns.map((c) => rowValueFor(a, c.key))));
      }
    }
  }

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN, top: PDF_CONTENT_TOP, bottom: bottomReserve },
    tableWidth: usable,
    head: [visualHead],
    body,
    theme: "grid",
    styles: {
      font: HEBREW_FONT,
      fontSize: 10,
      halign: align,
      valign: "middle",
      cellPadding: 4,
      minCellHeight: 24,
      textColor: BLACK,
      fillColor: WHITE,
      lineColor: BLACK,
      lineWidth: 0.6,
    },
    headStyles: {
      fontStyle: "bold",
      fillColor: WHITE,
      textColor: BLACK,
      lineColor: BLACK,
      lineWidth: 1.1,
      minCellHeight: 18,
    },
    columnStyles,
  });

  // --- Per-page chrome: org header, QR strip, footer ----------------------------
  drawPdfHeaders(doc, MARGIN, orgName, headerLogo, rtl);
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p += 1) {
    doc.setPage(p);
    doc.setTextColor(...BLACK);
    if (qrDataUrl) {
      const qrY = pageH - QR_SIZE - 22;
      doc.addImage(qrDataUrl, "PNG", MARGIN, qrY, QR_SIZE, QR_SIZE);
      doc.setFont(HEBREW_FONT, "bold");
      doc.setFontSize(10);
      doc.text(
        qrCaption,
        MARGIN + QR_SIZE + 10,
        qrY + QR_SIZE / 2 - 2,
        { align: "left" },
      );
      doc.setFont(HEBREW_FONT, "normal");
      doc.setFontSize(8);
      doc.text(
        qrSubcaption,
        MARGIN + QR_SIZE + 10,
        qrY + QR_SIZE / 2 + 11,
        { align: "left" },
      );
    }
    doc.setFont(HEBREW_FONT, "normal");
    doc.setFontSize(8);
    doc.text(
      t("task_pdf.footer", "משימה #{id} · עמוד {page} מתוך {total}")
        .replace("{id}", String(task.id))
        .replace("{page}", String(p))
        .replace("{total}", String(total)),
      right,
      pageH - 14,
      { align: "right" },
    );
  }

  doc.save(`task-${task.id}-${new Date().toISOString().slice(0, 10)}.pdf`);
}

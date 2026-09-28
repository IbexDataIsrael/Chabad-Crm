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
}): Promise<void> {
  const { data, orgName, orgLogoUrl, claimBaseUrl, t, lang } = opts;
  const { task } = data;

  // fixes69 §Admin3a: whatever's already on file prints in the box instead of
  // a blank one — same "fetch labels imperatively, not via a hook" reasoning
  // as the apartments report's PDF (a fast click right after page load must
  // never print a raw technical value).
  const [{ jsPDF }, { default: autoTable }, headerLogo, jewishOpts, mezuzahOpts, languageOpts] =
    await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
      loadHeaderLogo(orgLogoUrl),
      apiFetch<PicklistValue[]>("/api/picklists/apartment.Jewish_status"),
      apiFetch<PicklistValue[]>("/api/picklists/apartment.mezuzah_status"),
      apiFetch<PicklistValue[]>("/api/picklists/apartment.language"),
    ]);
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

  // --- Title block ---------------------------------------------------------
  let y = PDF_CONTENT_TOP;
  doc.setTextColor(...BLACK);
  doc.setFont(HEBREW_FONT, "bold");
  doc.setFontSize(18);
  doc.text(
    `${t("task_pdf.title", "דף משימה")} #${task.id} — ${task.campaign_name}`,
    right,
    y + 8,
    { align: "right" },
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
    doc.text(`${label}:`, right, y, { align: "right" });
    const labelW = doc.getTextWidth(`${label}: `);
    doc.setFont(HEBREW_FONT, "normal");
    doc.text(value, right - labelW, y, { align: "right" });
    y += 16;
  }
  // Performer line — the office copies this into "who performed the work?".
  doc.setFont(HEBREW_FONT, "bold");
  const performedLabel = `${t("task_pdf.performed_by", "בוצע על ידי (שם מלא)")}:`;
  doc.text(performedLabel, right, y + 4, { align: "right" });
  doc.setLineWidth(0.8);
  doc.line(MARGIN + 150, y + 6, right - doc.getTextWidth(performedLabel) - 8, y + 6);
  y += 24;

  // --- One continuous table for the whole sheet -----------------------------
  // fixes69 §Admin3b: a separate autoTable() call per building repeated the
  // column header at every building's own start, not just once per physical
  // page (5x on one real printed page). One continuous table lets autotable
  // repeat the head on page breaks it manages itself; each building/report
  // group becomes a full-width divider row inside the same table's body
  // instead of a table of its own.
  const head = [
    t("reports.floor", "קומה"),
    t("reports.apartment_name", "מספר דירה"),
    t("apartments.name", "שם דייר"),
    t("reports.jewish_status", "מצב יהדות"),
    t("reports.mezuzah_status", "מזוזה"),
    t("reports.language", "שפה"),
    t("reports.apartment_notes", "הערות"),
  ];
  const usable = pageW - MARGIN * 2;
  const logicalWidths = [0.08, 0.1, 0.16, 0.14, 0.1, 0.1, 0.32].map((f) => f * usable);
  // autotable lays columns out left-to-right: reverse for RTL.
  const visualHead = [...head].reverse();
  const visualWidths = [...logicalWidths].reverse();
  const columnStyles = Object.fromEntries(visualWidths.map((w, i) => [i, { cellWidth: w }]));

  type Cell = string | { content: string; colSpan: number; styles?: Record<string, unknown> };
  const divider = (label: string): Cell[] => [
    {
      content: label,
      colSpan: head.length,
      styles: { fontStyle: "bold", fontSize: 12, halign: "right", minCellHeight: 20 },
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
        body.push(
          [
            a.floor ?? "",
            a.apartment_name ?? "",
            a.name ?? "",
            labelFor(jewishOpts, a.jewish_status),
            labelFor(mezuzahOpts, a.mezuzah_status),
            a.language.map((v) => labelFor(languageOpts, v)).join(", "),
            a.apartment_notes ?? "",
          ].reverse(),
        );
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
      halign: "right",
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
  drawPdfHeaders(doc, MARGIN, orgName, headerLogo);
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

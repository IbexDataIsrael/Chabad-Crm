import type { jsPDF } from "jspdf";

/**
 * Hebrew/RTL support for client-side PDF generation (fixes24).
 *
 * jsPDF ships a Unicode bidi engine, but its `postProcessText` hook runs it
 * in *visual* input mode by default (`isInputVisual: true`), which garbles
 * logical Hebrew and reverses embedded Latin/digit runs. The engine does the
 * right thing when told the input is *logical*: proper UBA reordering, LTR
 * runs (numbers, phones, Latin words) kept intact, brackets mirrored.
 *
 * `prepareHebrewPdf` registers the bundled Hebrew font and patches the
 * document's `text` method to inject those engine options into every call —
 * including the ones jspdf-autotable makes internally, which accept no
 * options of their own. Callers then pass plain logical strings everywhere
 * (and let autotable wrap cell text itself: wrap points are computed on the
 * logical string, so multi-line Hebrew keeps its reading order).
 */

export const HEBREW_FONT = "Alef";

/** Vertical space reserved for the per-page header (fixes26 §1) — content and
 *  autotable pages must start at/below this. */
export const PDF_CONTENT_TOP = 64;

export interface PdfHeaderLogo {
  dataUrl: string; // PNG re-encode (canvas), safe for jsPDF.addImage
  width: number;
  height: number;
}

/** Fetch the org logo and re-encode it as PNG via canvas so jsPDF gets a
 *  format it always understands (Cloudinary/local logos may be webp/gif).
 *  Best-effort: any failure returns null and the header renders name-only. */
export async function loadHeaderLogo(
  url: string | null | undefined,
): Promise<PdfHeaderLogo | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blobUrl = URL.createObjectURL(await res.blob());
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = blobUrl;
      });
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d")?.drawImage(img, 0, 0);
      return {
        dataUrl: canvas.toDataURL("image/png"),
        width: img.naturalWidth,
        height: img.naturalHeight,
      };
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  } catch {
    return null;
  }
}

/** Draw the organization header (name right / RTL, logo left, hairline) on
 *  every page of the finished document (fixes26 §1). Call after layout so no
 *  page is missed. */
export function drawPdfHeaders(
  doc: jsPDF,
  margin: number,
  orgName: string,
  logo: PdfHeaderLogo | null,
  /** fixes74 §8: an English PDF mirrors the header (name left, logo right). */
  rtl = true,
): void {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    drawPdfCredits(doc, pageW, pageH);
    if (orgName) {
      doc.setFont(HEBREW_FONT, "bold");
      doc.setFontSize(12);
      doc.setTextColor(55, 65, 81);
      doc.text(orgName, rtl ? pageW - margin : margin, 34, { align: rtl ? "right" : "left" });
      doc.setTextColor(0);
    }
    if (logo && logo.width > 0 && logo.height > 0) {
      // Scale into a 26pt-high band, capped at 100pt wide.
      let h = 26;
      let w = (logo.width / logo.height) * h;
      if (w > 100) {
        h = (100 / w) * h;
        w = 100;
      }
      doc.addImage(logo.dataUrl, "PNG", rtl ? margin : pageW - margin - w, 30 - h / 2, w, h);
    }
    doc.setDrawColor(209, 213, 219);
    doc.line(margin, 48, pageW - margin, 48);
  }
  doc.setPage(pages);
}

/** fixes67: fixed credits on every page of every PDF — a dedication centered
 *  at the very top (above the org header) and the builder credit at the very
 *  bottom (below every generator's own page-number footer). Deliberately not
 *  localized: the same fixed text in both UI languages. */
const PDF_DEDICATION = `לעילוי נשמת הרה"ג ר' אברהם יצחק שלוסברג זצ"ל`;
const PDF_BUILT_BY = "Built by zvi.naiman@gmail.com";

function drawPdfCredits(doc: jsPDF, pageW: number, pageH: number): void {
  doc.setFont(HEBREW_FONT, "normal");
  doc.setTextColor(110, 110, 110);
  doc.setFontSize(8);
  doc.text(PDF_DEDICATION, pageW / 2, 14, { align: "center" });
  doc.setFontSize(6.5);
  doc.text(PDF_BUILT_BY, pageW / 2, pageH - 6, { align: "center" });
  doc.setTextColor(0);
}

// Bidi-engine flags consumed by jsPDF's postProcessText hook (they ride on
// the regular text options object): logical input → visual LTR-canvas output.
const BIDI_OPTIONS = {
  isInputVisual: false,
  isOutputVisual: true,
  isOutputRtl: false,
  isSymmetricSwapping: true,
};

// The TTFs are fetched once per session and cached as base64.
let fontCache: { normal: string; bold: string } | null = null;

async function fetchFontBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`font fetch failed: ${url}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000; // avoid call-stack limits on String.fromCharCode
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Register the bundled Hebrew font (Alef, OFL — public/fonts/) and enable
 *  logical-order bidi handling on every `doc.text` call. */
export async function prepareHebrewPdf(doc: jsPDF): Promise<void> {
  if (!fontCache) {
    const [normal, bold] = await Promise.all([
      fetchFontBase64("/fonts/Alef-Regular.ttf"),
      fetchFontBase64("/fonts/Alef-Bold.ttf"),
    ]);
    fontCache = { normal, bold };
  }
  doc.addFileToVFS("Alef-Regular.ttf", fontCache.normal);
  doc.addFont("Alef-Regular.ttf", HEBREW_FONT, "normal");
  doc.addFileToVFS("Alef-Bold.ttf", fontCache.bold);
  doc.addFont("Alef-Bold.ttf", HEBREW_FONT, "bold");
  doc.setFont(HEBREW_FONT, "normal");

  const original = doc.text.bind(doc);
  doc.text = ((
    text: string | string[],
    x: number,
    y: number,
    options?: unknown,
    transform?: unknown,
  ) => {
    // Leave jsPDF's legacy positional-argument form alone.
    if (options != null && typeof options !== "object") {
      return original(text, x, y, options as never, transform as never);
    }
    return original(
      text,
      x,
      y,
      { ...(options as object), ...BIDI_OPTIONS } as never,
      transform as never,
    );
  }) as typeof doc.text;
}

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

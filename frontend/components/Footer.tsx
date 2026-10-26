/**
 * Site-wide footer credit. Plain (server) component — no hooks, shows on every
 * page. The logo is served from /public/logo.png. fixes67: the dedication
 * line (fixed Hebrew text in both UI languages — same as on every PDF, see
 * lib/pdfRtl.ts).
 */
export function Footer() {
  return (
    <footer className="border-t border-white/5 bg-transparent">
      <div className="max-w-6xl mx-auto px-4 py-4 flex flex-col items-center gap-1.5 text-sm text-muted-foreground/70">
        <p lang="he" dir="rtl" className="text-center font-medium text-foreground/80">
          לעילוי נשמת הרה&quot;ג ר&apos; אברהם יצחק שלוסברג זצ&quot;ל
        </p>
        <div className="flex items-center justify-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" className="h-6 w-6 rounded object-contain" />
          <span>
            Built by{" "}
            <a
              href="mailto:zvi.naiman@gmail.com"
              className="font-medium text-primary hover:underline"
            >
              zvi.naiman@gmail.com
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
}

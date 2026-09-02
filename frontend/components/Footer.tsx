/**
 * Site-wide footer credit. Plain (server) component — no hooks, shows on every
 * page. The logo is served from /public/logo.png.
 */
export function Footer() {
  return (
    <footer className="border-t border-border bg-card">
      <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
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
    </footer>
  );
}
